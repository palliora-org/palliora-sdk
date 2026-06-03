/**
 * test-encrypted-inference.mjs
 *
 * Submits an inference compute request where the payload is threshold-encrypted
 * before being sent inline (DAInput::Inline) on-chain.
 *
 * Encryption flow (mirrors testChat.ts):
 *   1. testCrypt(tauParams, aggKey)  →  { encoded: cyphtxt, ikm }
 *      `cyphtxt` is the BLS12-381 silent-threshold wrapper around the session key.
 *      `ikm`     is the raw session key material.
 *   2. gen_stretched_key(ikm)        →  symmetric key (ChaCha20Poly1305)
 *   3. encrypt(payload, symKey)      →  { ciphertext, nonce }
 *   4. `ciphertext` bytes become the DAInput::Inline payload.
 *   5. The cipher suite (SilentThreshold + ChaCha20Poly1305) is recorded in the
 *      contract's `cipher` field so guardians know how to unwrap the session key.
 *   6. A second testCrypt call derives an independent session key for result_cipher
 *      so the encrypted result can be decrypted locally.
 *
 * The guardian group is created automatically via createGuardianGroupAndWatch,
 * which populates AGG_KEY, GROUP_PK, TAU_PARAMS, and selectedGuardians from
 * the on-chain DaccGuardianGroup event.
 *
 * Optional environment variables:
 *   PALLIORA_WS         – WebSocket endpoint (falls back to SDK default)
 */

import {
  configure,
  compactFromU8aLim,
  decrypt,
  fetchAndDecodeExtrinsic,
  gen_shared_key,
  getEncKeyring,
  getApi,
  getKeyring,
  getGuardianAddress,
  createAgreement,
  createGuardianGroupAndWatch,
  scanForBlockEvent,
  testCrypt,
  encrypt,
  gen_stretched_key,
  hexToUint8Array,
  toAtomicPaliAmount,
} from "../dist/index.js";

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

function buildAsymmetricResultCipher(recipientEd25519PubKey, nonce) {
  return {
    AsymmetricHybrid: {
      asymmetric_params: {
        Ed25519: {
          // testChat uses x25519(recipient_priv, node_pub), so we provide recipient material
          // and pin node public key here for deterministic reverse decryption setup.
          recipient_public_key: Array.from(
            recipientEd25519PubKey,
          ),
          ephemeral_public_key: Array.from(nodePub),
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

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  // --- 1. Resolve signer ---------------------------------------------------
  const keyring = await getKeyring();
  const encKeyring = await getEncKeyring();
  const encAccount = encKeyring.getPairs()[0];
  const account = keyring.getPairs()[0];
  if (!encAccount) throw new Error("No encryption account in keyring");
  if (!account) throw new Error("No signer account in keyring");
  console.log(
    "Signer:",
    account.address,
    "| Encryption key:",
    encAccount.address,
  );

  // --- 2. Create guardian group and retrieve group parameters --------------
  const selectedGuardians = (await getGuardianAddress()).slice(0, 3).map((g) => g.address);
  if (selectedGuardians.length < 3) throw new Error("Need at least 3 guardians available on-chain");

  const groupInfo = await createGuardianGroupAndWatch(account, selectedGuardians, 8);
  const { aggKey: AGG_KEY, groupPk: GROUP_PK, tauParams: TAU_PARAMS, guardians } = groupInfo;

  // --- 4. Build the inference payload to encrypt ----------------------------
  const inferencePayload = {
    model: "gemma3:12b",
    messages: [
      { role: "user", content: "hola" },
      { role: "assistant", content: "¡Hola! ¿En qué puedo ayudarte hoy?" },
      { role: "user", content: "hehe you speak espanol" },
      {
        role: "assistant",
        content:
          "Sí, hablo español con suficiente fluidez para conversar y responder preguntas. " +
          "Pero no sé si soy perfecto... ¿Quieres hablar un poco o necesitas ayuda con algo en particular?",
      },
      { role: "user", content: "noice" },
    ],
    stream: false,
  };

  const payloadBytes = new TextEncoder().encode(JSON.stringify(inferencePayload));

  // --- 5. Threshold-encrypt the input payload -------------------------------
  // testCrypt runs the BLS12-381 silent-threshold KEM and returns:
  //   encoded – the threshold ciphertext wrapping the session key (hex)
  //   ikm     – the raw session key material (hex)
  const { encoded: inputCyphtxt, ikm: inputIkm } = testCrypt(
    stripHex(TAU_PARAMS),
    stripHex(AGG_KEY),
  );

  const inputSymKey = gen_stretched_key(hexToUint8Array(stripHex(inputIkm)));
  const { ciphertext: inputCiphertext, nonce: inputNonce } = encrypt(
    payloadBytes,
    inputSymKey,
  );

  console.log("\n[Input encryption]");
  console.log("  IKM (hex):", inputIkm);
  console.log("  Nonce (hex):", Buffer.from(inputNonce).toString("hex"));
  console.log("  Ciphertext length:", inputCiphertext.length, "bytes");

  // --- 6. Build result-cipher nonce/material for AsymmetricHybrid -----------
  const resultNonce = new Uint8Array(12);
  globalThis.crypto.getRandomValues(resultNonce);

  console.log("\n[Result decryption material - keep these to decrypt the response]");
  console.log("  Recipient enc pub (hex):", Buffer.from(encAccount.publicKey).toString("hex"));
  console.log("  Recipient mont pub (hex):", Buffer.from(encAccount.publicKey).toString("hex"));
  console.log("  Node pub (hex):", Buffer.from(nodePub).toString("hex"));
  console.log("  Result nonce (hex):", Buffer.from(resultNonce).toString("hex"));
  console.log("  (testChat-style: decrypt(ciphertext, gen_shared_key(self_key, node_pub), nonce))");

  // --- 7. Build the on-chain Contract ---------------------------------------
  const inputCipher = buildEncryptedCipher(
    inputCyphtxt,
    GROUP_PK,
    TAU_PARAMS,
    inputNonce,
  );
  const resultCipher = buildAsymmetricResultCipher(
    encAccount.publicKey,
    resultNonce,
  );

  const computeStep = {
    cipher: inputCipher,
    computer_indices: selectedGuardians.map((_, i) => i),
    fees: toAtomicPaliAmount("0.21"), // 0.21 PALI
    deadline: 0,
    confidentiality: { Trusted: 0 },
    fee_function: null,
    program_env: null,
    // Encrypted payload delivered inline — DAInput::Inline
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

  // --- 8. Submit and report -------------------------------------------------
  console.log("\nSubmitting encrypted inference agreement...");
  const result = await createAgreement(contract, account);

  console.log("\n[Transaction submitted]");
  console.log("  Block:", result.blockNumber);
  console.log("  Tx index:", result.index);
  console.log("  Hash:", result.hash);
  if (result.agreementId) {
    console.log("  Agreement ID:", result.agreementId);
  }

  if (!result.agreementId) {
    throw new Error(
      "Agreement id was not emitted by the submission transaction",
    );
  }

  const api = await getApi();
  if (!api) throw new Error("Api not initialized");

  const selfKey = encAccount.encodePkcs8().slice(16, 48);
  const agreementId = result.agreementId;
  let nextBlock = result.blockNumber + 1;

  console.log("\nWaiting for compute result...");
  const match = await scanForBlockEvent(
    api,
    {
      predicate: async (block, _event, phase) => {
        if (!block || !phase.isApplyExtrinsic) {
          return false;
        }

        const extrinsic =
          block.block.extrinsics[phase.asApplyExtrinsic.toNumber()];
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

  const block = await match.block();
  const resultExtrinsic = await fetchAndDecodeExtrinsic(
    match.blockNumber,
    match.extrinsicIndex ?? 0,
  );
  const args = resultExtrinsic.decoded.method.args;
  const emittedAgreementId = args.requestId ?? "0x";

  const ciphertext = Buffer.from(args.contract.compute.input.Inline.data.slice(2), 'hex');
  const nonce = Buffer.from(args.contract.compute.cipher.AsymmetricHybrid.symmetricParams.ChaCha20Poly1305.nonce.slice(2), 'hex');
  const sharedKey = gen_shared_key(selfKey, nodePub);

  const decrypted = decrypt(
    ciphertext,
    sharedKey,
    nonce,
  );

  if (!decrypted) {
    throw new Error("Failed to decrypt compute result");
  }

  const resultText = new TextDecoder().decode(decrypted);
  console.log(
    `\nReceived result for agreement ${emittedAgreementId}: ${resultText}`,
  );

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
  console.error("Encrypted inference test failed:", err);
  process.exit(1);
});
