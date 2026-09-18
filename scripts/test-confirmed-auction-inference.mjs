/**
 * test-confirmed-auction-inference.mjs
 *
 * Fetches a confirmed (resolved) cost-estimation auction that guardian
 * TARGET_GUARDIAN is part of, then submits an encrypted, single-shot ("Active")
 * inference compute contract — not the Dormant+invoke "subscription" pattern used
 * by encryptedInferenceSubscription — carrying the estimate's result as the
 * contract's fee terms and its estimateId as oracle_quote_id.
 *
 * Locating a "confirmed auction by guardian" (see cost_estimation/API.md, updated
 * 2026-08-21 to add `auctionId` on POST /estimate and GET /estimates/:id, plus
 * GET /auctions/:id and GET /guardians/:address/auctions?resolved=true):
 *   `estimatedCost` only ever comes back attached to an *estimate* (not an
 *   auction), so this script still originates its own estimate for COMPUTE_MODE
 *   (needed to get a usable estimatedCost for the fee terms below) rather than
 *   trawling TARGET_GUARDIAN's resolved-auction history via
 *   listResolvedGuardianAuctions, which only carries {auctionId, winner.rate} —
 *   no estimatedCost. Once that estimate resolves, its `auctionId` is used to
 *   fetch the confirmed auction directly via getAuction (GET /auctions/:id,
 *   `resolved: true` once settled) rather than only inferring completion from
 *   the estimate's own status, and TARGET_GUARDIAN's presence in that auction's
 *   guardian list is verified there.
 *
 * Fee mapping: EstimateResult.auctionedRate/estimatedCost are already atomic
 * on-chain bigints (per costEstimation/types.ts and API.md), unlike the SDK's
 * Fee/buildFee helper, which expects human PALI amounts and calls
 * toAtomicPaliAmount (parseUnits) internally. This script assigns the atomic
 * values straight into the compute step's fees/compute_rate fields rather than
 * going through Fee/buildFee, to avoid re-scaling an already-atomic value.
 *
 * Encryption flow, and the wait-for-result/decrypt tail, mirror
 * test-encrypted-inference.mjs (see that file for the step-by-step breakdown of
 * testCrypt / gen_stretched_key / encrypt / gen_shared_key).
 *
 * GUARDIAN_NODE_PUB: the result_cipher's node-side key is NOT discoverable
 * on-chain or via the SDK. Tracing compute-core/orchestrator/src/chain.ts shows
 * the executing guardian encrypts its result using `gen_shared_key(staticKey,
 * recipientPublicKey)`, where `staticKey` comes from that guardian process's own
 * STATIC_RESPONSE_KEY env var — an operational secret held by whichever guardian
 * operator's orchestrator happens to process this contract, distinct from the
 * on-chain `staking.guardians(address).pubKey`. So unlike
 * test-encrypted-inference.mjs (which hardcodes a `nodePub` presumably valid for
 * whatever devnet it was last run against), this script requires the public
 * counterpart to be supplied explicitly via GUARDIAN_NODE_PUB rather than
 * guessing — a wrong value would fail decryption silently with no indication why.
 *
 * Required environment:
 *   PALLIORA_WS         – WebSocket endpoint (falls back to SDK default)
 *   COST_ESTIMATOR_URL   – cost-estimation service base URL (falls back to
 *                          http://localhost:4141)
 *   GUARDIAN_NODE_PUB    – hex-encoded 32-byte public key of the guardian
 *                          expected to process this contract (see above)
 */

import {
  init,
  getApi,
  getKeyring,
  getEncKeyring,
  createGuardianGroupAndWatch,
  createAgreement,
  startEstimate,
  getEstimateResult,
  getAuction,
  testCrypt,
  encrypt,
  decrypt,
  gen_stretched_key,
  gen_shared_key,
  hexToUint8Array,
  signAndSend,
  scanForBlockEvent,
  fetchAndDecodeExtrinsic,
  DEFAULT_COMPUTE_PAYLOAD,
} from "../dist/index.js";

const TARGET_GUARDIAN = "5ELHQZbPaQgBJquGfJ6e4n6Bz8ntbDfDemGfLyEDpUrKUD5A";
const COMPUTE_MODE = "Trusted";
const AUCTION_POLL_INTERVAL_MS = 5000;
const AUCTION_POLL_TIMEOUT_MS = 60000;
const nodePub = new Uint8Array([
  59, 105, 230, 196, 8, 100, 70, 38, 130, 39, 111, 219, 186, 210, 57, 165,
  111, 140, 13, 131, 164, 215, 122, 37, 45, 249, 91, 214, 223, 246, 93, 208,
]);


// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Strip an optional 0x prefix from a hex string. */
function stripHex(h) {
  return h.startsWith("0x") ? h.slice(2) : h;
}

/**
 * Build a CipherSuite::ThresholdHybrid object for the on-chain Contract type given the
 * output of a testCrypt call and the 12-byte ChaCha20Poly1305 nonce.
 */
function buildEncryptedCipher(cyphtxtHex, groupPkHex, tauParamsHex, nonce) {
  return {
    ThresholdHybrid: {
      threshold_params: {
        SilentThreshold: {
          td_params: Array.from(hexToUint8Array(stripHex(cyphtxtHex))),
          pk_bytes: Array.from(hexToUint8Array(stripHex(groupPkHex))),
          tau_params: Array.from(hexToUint8Array(stripHex(tauParamsHex))),
        },
      },
      symmetric_params: {
        ChaCha20Poly1305: { nonce: Array.from(nonce) },
      },
    },
  };
}

function buildAsymmetricResultCipher(recipientEd25519PubKey, ephemeralPublicKey, nonce) {
  return {
    AsymmetricHybrid: {
      asymmetric_params: {
        Ed25519: {
          recipient_public_key: Array.from(recipientEd25519PubKey),
          ephemeral_public_key: Array.from(ephemeralPublicKey),
          kdf: "HkdfSha256",
          salt: null,
          info: null,
        },
      },
      symmetric_params: {
        ChaCha20Poly1305: { nonce: Array.from(nonce) },
      },
    },
  };
}

/**
 * Evicts genuinely orphaned transactions from `account` stuck in the node's pool by
 * resubmitting a cheap system.remark at the same nonce with a higher tip. Substrate's
 * tx pool keeps only the highest-priority extrinsic per (account, nonce), so a tipped
 * replacement displaces the stuck one instead of being rejected alongside it.
 *
 * Necessary on staging: the shared //Bob dev account (the SDK's hardcoded keyring
 * default) is used by other processes too, and has previously been left with a
 * stuck nonce, which surfaces as "1014: Priority is too low" on every subsequent
 * transaction from that account until cleared.
 *
 * Only evicts nonces strictly below `system_accountNextIndex` — the nonce our own
 * script's next transaction will actually be assigned, since nothing else in this
 * script overrides nonce. That RPC already accounts for every valid, contiguous
 * pending transaction from this account, so anything still sitting in the pool below
 * it is stale/superseded, not legitimately in flight. A pending nonce at or above it
 * is left alone: it could be our own script's (or another process's) transaction
 * that's simply still awaiting inclusion, and blindly evicting it — as an earlier
 * version of this function did, filtering on every pending nonce with no floor — is
 * exactly what once clobbered a real compute.agreement submission with a throwaway
 * system.remark.
 */
async function evictStuckTransactions(api, account) {
  const pending = await api.rpc.author.pendingExtrinsics();
  const ownPendingNonces = pending
    .filter((ext) => ext.signer?.toString() === account.address)
    .map((ext) => ext.nonce.toNumber());

  if (ownPendingNonces.length === 0) return;

  const readyNonce = (await api.rpc.system.accountNextIndex(account.address)).toNumber();
  const gapNonces = ownPendingNonces.filter((nonce) => nonce < readyNonce);
  const leftAlone = ownPendingNonces.filter((nonce) => nonce >= readyNonce);

  if (leftAlone.length > 0) {
    console.log(
      `Leaving ${leftAlone.length} pending transaction(s) from ${account.address} alone ` +
        `(nonce(s) ${leftAlone.join(", ")}, ready nonce is ${readyNonce} — could be a ` +
        `legitimately in-flight transaction, not evicting)`,
    );
  }

  if (gapNonces.length === 0) return;

  console.log(
    `Evicting ${gapNonces.length} orphaned transaction(s) from ${account.address} at nonce(s):`,
    gapNonces,
  );
  // A tip derived from the current timestamp is cheap (atomic units, PALI_DECIMALS
  // = 18) yet always higher than a previous zero-tip (or earlier eviction attempt's)
  // priority, without needing to know the stuck tx's own tip.
  const tip = BigInt(Date.now());
  for (const nonce of gapNonces) {
    const remark = api.tx.system.remark("0x");
    await signAndSend(remark, account, { ...DEFAULT_COMPUTE_PAYLOAD, nonce, tip });
    console.log(`  Evicted nonce ${nonce}`);
  }
}

/**
 * Starts a fresh COMPUTE_MODE estimate, waits for it to resolve, then fetches the
 * confirmed auction backing it via getAuction and verifies guardianAddress was
 * part of it. See the header comment for why the estimate is self-originated
 * rather than discovered via listResolvedGuardianAuctions.
 */
async function fetchConfirmedAuctionForGuardian(guardianAddress) {
  console.log(
    `Starting a ${COMPUTE_MODE} estimate to find a confirmed auction for ${guardianAddress}...`,
  );
  const { estimateId, auctionId } = await startEstimate({ computeMode: COMPUTE_MODE });
  console.log("Estimate started:", estimateId, "| Auction:", auctionId);

  const deadline = Date.now() + AUCTION_POLL_TIMEOUT_MS;
  let status;
  for (;;) {
    status = await getEstimateResult(estimateId);
    if (status.status !== "pending") break;
    if (Date.now() > deadline) {
      throw new Error(
        `estimate ${estimateId} still pending after ${AUCTION_POLL_TIMEOUT_MS}ms`,
      );
    }
    await new Promise((resolve) => setTimeout(resolve, AUCTION_POLL_INTERVAL_MS));
  }

  if (status.status === "failed") {
    throw new Error(`estimate ${estimateId} failed: ${status.error}`);
  }

  const auction = await getAuction(auctionId);
  if (!auction.resolved) {
    throw new Error(
      `estimate ${estimateId} is completed but its auction ${auctionId} is not ` +
        `marked resolved yet — unexpected, since GET /estimates/:id only reaches ` +
        `"completed" after the auction resolves`,
    );
  }
  if (!auction.guardians.includes(guardianAddress)) {
    throw new Error(
      `guardian ${guardianAddress} was not eligible for the confirmed auction ` +
        `${auctionId} (eligible: ${auction.guardians.join(", ") || "none"})`,
    );
  }

  console.log("Confirmed auction fetched via getAuction:", {
    auctionId: auction.auctionId,
    resolved: auction.resolved,
    winner: auction.winner
      ? { guardian: auction.winner.guardian, rate: auction.winner.rate.toString() }
      : undefined,
  });
  console.log("Estimate result:", {
    estimateId,
    predictedDurationMs: status.result.predictedDurationMs,
    auctionedRate: status.result.auctionedRate.toString(),
    estimatedCost: status.result.estimatedCost.toString(),
  });

  return { estimateId, auction, result: status.result };
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  // Fail fast on missing required input, before any of the expensive on-chain work
  // below (guardian group creation, the actual submission) has a chance to run.
  init({
    pallioraWs: process.env.PALLIORA_WS ?? "wss://manas-rpc.palliora.org",
    costEstimatorUrl: process.env.COST_ESTIMATOR_URL ?? "http://localhost:4141",
    debug: true,
  });

  // --- 1. Resolve signer -----------------------------------------------------
  const keyring = await getKeyring();
  const encKeyring = await getEncKeyring();
  const account = keyring.getPairs()[0];
  const encAccount = encKeyring.getPairs()[0];
  if (!account) throw new Error("No signer account in keyring");
  if (!encAccount) throw new Error("No encryption account in keyring");
  console.log("Signer:", account.address, "| Encryption key:", encAccount.address);

  const api = await getApi();
  if (!api) throw new Error("Api not initialized");
  await evictStuckTransactions(api, account);

  // --- 2. Fetch the confirmed auction for the target guardian ----------------
  const { estimateId, result: estimateResult } =
    await fetchConfirmedAuctionForGuardian(TARGET_GUARDIAN);

  // --- 3. Build a guardian group that includes the target guardian -----------
  // The ThresholdHybrid cipher below needs an on-chain guardian group of exactly
  // 3 guardians; the target guardian is included so the compute request is
  // routed through it.
  //
  // Deliberately not using the SDK's getGuardianAddress() here: that resolves
  // guardians via the guardian_guardianList RPC + guardian.workerByKey (a
  // peer-id-based path), which returned an empty list against staging. The
  // cost-estimation service's own guardian discovery (guardian-store/src/chain.ts)
  // instead reads api.query.guardian.guardians() directly, which does return the
  // full roster there — so this script does the same.
  const onChainGuardians = (await api.query.guardian.guardians()).toHuman();
  if (!onChainGuardians.includes(TARGET_GUARDIAN)) {
    throw new Error(`guardian ${TARGET_GUARDIAN} has no on-chain guardian entry`);
  }
  const otherGuardians = onChainGuardians
    .filter((address) => address !== TARGET_GUARDIAN)
    .slice(0, 2);
  if (otherGuardians.length < 2) {
    throw new Error("Need at least 3 guardians on-chain to form a threshold group");
  }
  const selectedGuardians = [TARGET_GUARDIAN, ...otherGuardians];

  console.log("Creating guardian group:", selectedGuardians);
  const groupInfo = await createGuardianGroupAndWatch(account, selectedGuardians, 80);
  const { aggKey: AGG_KEY, groupPk: GROUP_PK, tauParams: TAU_PARAMS } = groupInfo;

  // --- 4. Threshold-encrypt the inference payload -----------------------------
  const inferencePayload = {
    model: "gemma3:12b",
    messages: [
      { role: "user", content: "hello from the confirmed-auction test script" },
    ],
    stream: false,
  };
  const payloadBytes = new TextEncoder().encode(JSON.stringify(inferencePayload));

  const { encoded: inputCyphtxt, ikm: inputIkm } = testCrypt(
    stripHex(TAU_PARAMS),
    stripHex(AGG_KEY),
  );
  const inputSymKey = gen_stretched_key(hexToUint8Array(stripHex(inputIkm)));
  const { ciphertext: inputCiphertext, nonce: inputNonce } = encrypt(
    payloadBytes,
    inputSymKey,
  );

  const resultNonce = new Uint8Array(12);
  globalThis.crypto.getRandomValues(resultNonce);

  const inputCipher = buildEncryptedCipher(inputCyphtxt, GROUP_PK, TAU_PARAMS, inputNonce);
  const resultCipher = buildAsymmetricResultCipher(
    encAccount.publicKey,
    nodePub,
    resultNonce,
  );

  // --- 5. Build the compute contract -------------------------------------------
  // fees/compute_rate come straight from the confirmed auction's estimate result
  // (already atomic — see header comment), not from Fee/buildFee.
  const computeStep = {
    cipher: inputCipher,
    computer_indices: selectedGuardians.map((_, i) => i),
    fees: estimateResult.estimatedCost,
    compute_rate: estimateResult.auctionedRate,
    deadline: 0,
    confidentiality: { Trusted: 0 },
    fee_function: null,
    program_env: null,
    input: { Inline: { data: Array.from(inputCiphertext) } },
    program: { NativeExecute: "Inference" },
    metadata: null,
  };

  const contract = {
    contract_type: "Active",
    guardians: selectedGuardians,
    pre_check: null,
    compute: computeStep,
    post_check: null,
    result_cipher: resultCipher,
  };

  // --- 6. Submit, pinning oracle_quote_id to the confirming estimate ----------
  console.log("\nSubmitting encrypted inference agreement with oracle_quote_id:", estimateId);
  const result = await createAgreement(contract, account, estimateId);

  console.log("\n[Transaction submitted]");
  console.log("  Block:", result.blockNumber);
  console.log("  Tx index:", result.index);
  console.log("  Hash:", result.hash);
  if (result.agreementId) {
    console.log("  Agreement ID:", result.agreementId);
  } else {
    throw new Error("Agreement id was not emitted by the submission transaction");
  }

  // --- 7. Wait for the compute result and decrypt it --------------------------
  // Mirrors test-encrypted-inference.mjs's wait/decrypt flow exactly.
  const selfKey = encAccount.encodePkcs8().slice(16, 48);
  const agreementId = result.agreementId;

  console.log("\nWaiting for compute result...");
  const match = await scanForBlockEvent(
    api,
    {
      predicate: async (block, _event, phase) => {
        if (!block || !phase.isApplyExtrinsic) {
          return false;
        }

        const extrinsic = block.block.extrinsics[phase.asApplyExtrinsic.toNumber()];
        if (
          extrinsic?.method?.section?.toLowerCase() !== "compute" ||
          extrinsic?.method?.method?.toLowerCase() !== "result"
        ) {
          return false;
        }

        const args = extrinsic.method.args;
        const emittedAgreementId =
          "0x" +
          Array.from(args[0])
            .map((byte) => ("0" + (byte & 0xff).toString(16)).slice(-2))
            .join("");

        return emittedAgreementId === agreementId;
      },
    },
    result.blockNumber + 1,
    0,
  );

  const resultExtrinsic = await fetchAndDecodeExtrinsic(
    match.blockNumber,
    match.extrinsicIndex ?? 0,
  );
  const resultArgs = resultExtrinsic.decoded.method.args;
  const emittedAgreementId = resultArgs.requestId ?? "0x";

  const resultCiphertext = Buffer.from(
    resultArgs.contract.compute.input.Inline.data.slice(2),
    "hex",
  );
  const resultNonceBytes = Buffer.from(
    resultArgs.contract.compute.cipher.AsymmetricHybrid.symmetricParams.ChaCha20Poly1305.nonce.slice(2),
    "hex",
  );
  const sharedKey = gen_shared_key(selfKey, nodePub);

  const decrypted = decrypt(resultCiphertext, sharedKey, resultNonceBytes);
  if (!decrypted) {
    throw new Error(
      "Failed to decrypt compute result — GUARDIAN_NODE_PUB likely doesn't match the " +
        "STATIC_RESPONSE_KEY of the guardian that actually processed this contract",
    );
  }

  const resultText = new TextDecoder().decode(decrypted);
  console.log(`\nReceived result for agreement ${emittedAgreementId}: ${resultText}`);

  try {
    const parsed = JSON.parse(resultText);
    console.log("\n[Decrypted JSON result]");
    console.log(JSON.stringify(parsed, null, 2));
  } catch {
    console.log("\n[Decrypted text result]");
  }

  process.exit(0);
}

main().catch((err) => {
  console.error("Confirmed-auction encrypted inference test failed:", err);
  process.exit(1);
});
