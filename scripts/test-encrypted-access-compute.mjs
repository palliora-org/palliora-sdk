/**
 * End-to-end test of access to a threshold-encrypted `Dormant` contract.
 *
 * `test-stored-access-compute.mjs` proves the reference-and-payment half: a contract can point
 * at published artefacts and the publisher gets paid. Both artefacts there are plaintext, so
 * the orchestrator simply reads them.
 *
 * This script encrypts the data. The greeting subject is registered under
 * `ThresholdHybrid`/`SilentThreshold`, so its bytes are ciphertext and the key that opens them
 * exists nowhere on chain — only the guardian group can reconstruct it. Reaching that data
 * therefore takes three contracts instead of two:
 *
 *   1. publish   `encryptedDataContract` → a Dormant contract holding ciphertext.
 *                `agreement` records blake2_256(tdParams ‖ tauParams ‖ pkBytes) for it.
 *   2. access    `accessContract` → an Active contract with program
 *                `{ NativeExecute: "ContractAccess" }`, restating (1)'s cipher as its own.
 *                Guardians run their ordinary threshold round over that cipher and hand the
 *                key to the orchestrator, which wraps it to the requester and submits it.
 *   3. use       `storedCompute` naming the grant in `programEnv`. The orchestrator finds the
 *                grant's result, unwraps the key, and opens (1)'s ciphertext for the container.
 *
 * Four things are asserted that the plaintext path cannot reach:
 *
 *   a. The grant's result is *not* the key in the clear. It decrypts, with the recipient's own
 *      key, to exactly the symmetric key the publisher encrypted under.
 *   b. The pallet rejects an access request that restates parameters not belonging to the
 *      contract it references (`ThresholdCommitmentMismatch`).
 *   c. With the grant, the container reads the decrypted greeting subject.
 *   d. Without it, the run fails rather than handing the container ciphertext.
 *
 * Usage:
 *   STATIC_RESPONSE_KEY=0x… node scripts/test-encrypted-access-compute.mjs ["mr. who"]
 *
 * Environment:
 *   PALLIORA_WS          chain endpoint (default ws://127.0.0.1:9947)
 *   STATIC_RESPONSE_KEY  64-byte hex ed25519 key. Required, and must be the orchestrator's:
 *                        the grant is wrapped to its public half by ECDH, so only a node
 *                        holding the private half can unwrap it.
 *   GUARDIAN_GROUP_FILE  path to a saved GuardianGroupInfo (default ./.guardian-group.json).
 *                        A group is created and saved there when the file is absent.
 *   PROGRAM_IMAGE        image the program contract registers
 *   USAGE_PRICE, COMPUTE_RATE, FEE_HEADROOM, RESULT_BLOCKS  as in test-stored-access-compute
 *   SKIP_NEGATIVE        set to skip assertions (b) and (d)
 */

import { existsSync, readFileSync, writeFileSync } from "node:fs";
import {
  CryptoType,
  accessContract,
  buildAccessGrantEnv,
  createGuardianGroupAndWatch,
  dataContract,
  decrypt,
  disconnectApi,
  encryptedDataContract,
  estimateMinFee,
  formatPaliAmount,
  fromAtomicPaliAmount,
  gen_shared_key,
  getApi,
  getGuardianAddress,
  getKeyring,
  init,
  pairFromPrivateKeyHex,
  storedCompute,
  utilCrypto,
} from "../dist/index.js";

const PALLIORA_WS = process.env.PALLIORA_WS ?? "ws://127.0.0.1:9947";
const PROGRAM_IMAGE = process.env.PROGRAM_IMAGE ?? "ujjwalpal/hello-world:test";
const GROUP_FILE = process.env.GUARDIAN_GROUP_FILE ?? ".guardian-group.json";
const USAGE_PRICE = process.env.USAGE_PRICE ?? "0.05";
const COMPUTE_RATE = process.env.COMPUTE_RATE ?? "0.00001";
const FEE_HEADROOM = BigInt(process.env.FEE_HEADROOM ?? "4");
const RESULT_BLOCKS = Number(process.env.RESULT_BLOCKS ?? "40");
const SKIP_NEGATIVE = !!process.env.SKIP_NEGATIVE;
const DEFAULT_SUBJECT = "mr. who";

function assertCondition(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

function toBytes(value) {
  if (typeof value === "string") {
    return value.startsWith("0x")
      ? Buffer.from(value.slice(2), "hex")
      : Buffer.from(value, "utf8");
  }
  if (Array.isArray(value)) return Buffer.from(value.map(Number));
  throw new Error(`cannot decode bytes from ${JSON.stringify(value)}`);
}

/**
 * The guardian group to encrypt to.
 *
 * A group has no on-chain storage (CHAIN-RULES §4.3), so its parameters are recoverable only
 * from the `daccGuardianGroupInfo` extrinsic that created it. The file is the record.
 */
async function loadOrCreateGroup(signer) {
  if (existsSync(GROUP_FILE)) {
    const info = JSON.parse(readFileSync(GROUP_FILE, "utf8"));
    console.log(`using saved guardian group ${info.groupId} over ${info.guardians.length} guardians`);
    return info;
  }

  const entries = await getGuardianAddress();
  assertCondition(entries.length >= 3, `a threshold group needs 3 guardians, chain reports ${entries.length}`);
  const guardians = entries.slice(0, 3).map((g) => g.address);

  console.log("no saved group; creating one over:", guardians);
  const info = await createGuardianGroupAndWatch(signer, guardians, 30);
  writeFileSync(GROUP_FILE, JSON.stringify(info, null, 2));
  console.log(`created guardian group ${info.groupId}, saved to ${GROUP_FILE}`);
  return info;
}

/** Waits for the `compute.result` extrinsic that settles `contractId`. */
function waitForResult(api, contractId, maxBlocks) {
  const wanted = contractId.toLowerCase();

  return new Promise((resolve, reject) => {
    let scanned = 0;
    let done = false;
    let unsubscribe;

    const finish = (fn, value) => {
      if (done) return;
      done = true;
      Promise.resolve(unsubscribe).then((u) => u?.());
      fn(value);
    };

    const subscription = api.rpc.chain.subscribeNewHeads(async (header) => {
      if (done) return;
      const blockNumber = header.number.toNumber();
      if (++scanned > maxBlocks) {
        finish(reject, new Error(`no compute.result for ${contractId} within ${maxBlocks} blocks`));
        return;
      }

      try {
        const blockHash = await api.rpc.chain.getBlockHash(blockNumber);
        const { block } = await api.rpc.chain.getBlock(blockHash);

        for (let index = 0; index < block.extrinsics.length; index++) {
          const human = block.extrinsics[index].toHuman();
          const method = human?.method ?? {};
          if (String(method.section).toLowerCase() !== "compute") continue;
          if (String(method.method).toLowerCase() !== "result") continue;

          const args = method.args ?? {};
          const requestId = String(args.request_id ?? args.requestId ?? "").toLowerCase();
          if (requestId !== wanted) continue;

          finish(resolve, {
            blockNumber,
            extrinsicIndex: index,
            executionOutcome: String(args.execution_outcome ?? args.executionOutcome ?? ""),
            compute: args.contract?.compute ?? {},
          });
          return;
        }
      } catch (err) {
        console.warn(`scan of block ${blockNumber} failed: ${err.message}`);
      }
    });

    subscription.then((u) => {
      unsubscribe = u;
      if (done) u();
    }, (err) => finish(reject, err));
  });
}

/** Reads the granted key out of a grant's result, undoing the orchestrator's wrapping. */
function unwrapGrant(resultCompute, recipientSecret) {
  const inline = resultCompute?.input?.Inline;
  assertCondition(!!inline, `grant result is not Inline: ${JSON.stringify(resultCompute?.input)}`);
  const wrapped = toBytes(inline.data);

  const hybrid = resultCompute?.cipher?.AsymmetricHybrid;
  assertCondition(
    !!hybrid,
    `grant result was not wrapped — cipher is ${JSON.stringify(resultCompute?.cipher)}. ` +
      "The key would have been published in the clear.",
  );

  const ed = hybrid.asymmetricParams?.Ed25519 ?? hybrid.asymmetric_params?.Ed25519;
  const recipientPublicKey = toBytes(ed.recipientPublicKey ?? ed.recipient_public_key);
  const nonce = toBytes(
    (hybrid.symmetricParams ?? hybrid.symmetric_params).ChaCha20Poly1305.nonce,
  );

  const sharedKey = gen_shared_key(recipientSecret, Uint8Array.from(recipientPublicKey));
  const plaintext = decrypt(Uint8Array.from(wrapped), sharedKey, Uint8Array.from(nonce));
  assertCondition(plaintext != null, "failed to unwrap the granted key with the recipient key");

  const text = Buffer.from(plaintext).toString("utf8").trim();
  return { wrapped, key: Buffer.from(text.replace(/^0x/, ""), "hex") };
}

export async function encryptedAccessCompute(subject = DEFAULT_SUBJECT) {
  const staticResponseKey = process.env.STATIC_RESPONSE_KEY;
  assertCondition(
    !!staticResponseKey,
    "STATIC_RESPONSE_KEY is required and must match the orchestrator's: the grant is wrapped " +
      "to its public half, so only a node holding the private half can unwrap it.",
  );

  init({ pallioraWs: PALLIORA_WS, debug: false });

  const api = await getApi();
  assertCondition(!!api, "Api not initialized");

  const keyring = await getKeyring();
  const publisher = keyring.getPairs()[0];
  assertCondition(!!publisher, "No signer account in keyring");

  const consumer = process.env.CONSUMER_SEED
    ? keyring.addFromUri(process.env.CONSUMER_SEED, { name: "consumer" })
    : publisher;

  // The grant is addressed to the orchestrator's own key, which is also what unwraps it here.
  // A real deployment would address each requester separately; ECDH between the node's static
  // key and any recipient means this node can open every grant it issues.
  const responsePair = pairFromPrivateKeyHex(
    staticResponseKey.replace(/^0x/, ""),
    CryptoType.ED25519,
  );
  const recipientPublicKey = responsePair.publicKey;
  const recipientSecret = responsePair.secretKey.subarray(0, 32);

  const group = await loadOrCreateGroup(publisher);

  console.log({
    endpoint: PALLIORA_WS,
    publisher: publisher.address,
    consumer: consumer.address,
    groupId: group.groupId,
    guardians: group.guardians,
    recipientPublicKey: `0x${Buffer.from(recipientPublicKey).toString("hex")}`,
    subject,
  });

  // ── 1. Publish the greeting subject, threshold-encrypted ──────────────
  const encrypted = await encryptedDataContract(
    {
      data: subject,
      guardianInfo: group,
      guardians: group.guardians,
      fee: { amount: USAGE_PRICE, computeRate: "0" },
      metadata: {
        name: "greeting-subject-encrypted",
        description: "Threshold-encrypted name the greeting program is run against.",
        storeType: "Dataset",
      },
    },
    publisher,
  );
  assertCondition(!!encrypted.agreementId, "encrypted Dormant contract did not emit AgreementCreated");

  const dataContractId = encrypted.agreementId;
  const onChainData = (await api.query.compute.contracts(dataContractId)).toJSON();
  assertCondition(
    String(onChainData?.contractType ?? onChainData?.contract_type).toLowerCase() === "dormant",
    `expected a Dormant contract, got ${JSON.stringify(onChainData)}`,
  );

  // The commitment is the pallet's record of which parameters this contract was registered
  // with — the whole basis on which an access request is later judged.
  const threshold = encrypted.cipher.ThresholdHybrid.thresholdParams.SilentThreshold;
  const expectedCommitment = utilCrypto.blake2AsHex(
    Uint8Array.from([
      ...threshold.tdParams,
      ...threshold.tauParams,
      ...threshold.pkBytes,
    ]),
    256,
  );
  const storedCommitment = (
    await api.query.compute.thresholdCommitments(dataContractId)
  ).toJSON();
  assertCondition(
    storedCommitment === expectedCommitment,
    `threshold commitment mismatch: chain has ${storedCommitment}, expected ${expectedCommitment}`,
  );

  console.log(
    `published encrypted data: contract=${dataContractId} block=${encrypted.blockNumber} ` +
      `commitment=${storedCommitment}`,
  );

  // The program needs no secrecy, so it is registered in the clear — this test is about the
  // encrypted input.
  const program = await dataContract(
    {
      data: PROGRAM_IMAGE,
      guardians: group.guardians,
      fee: { amount: USAGE_PRICE, computeRate: "0" },
      metadata: {
        name: "hello-greet-program",
        description: `Container that greets the name in its first /input file: ${PROGRAM_IMAGE}.`,
        storeType: "Executable",
      },
    },
    publisher,
  );
  assertCondition(!!program.agreementId, "program Dormant contract did not emit AgreementCreated");
  console.log(`published program: contract=${program.agreementId} block=${program.blockNumber}`);

  // ── 2. Request access ─────────────────────────────────────────────────
  const accessFloor = await estimateMinFee({
    computeRate: COMPUTE_RATE,
    inputContractId: dataContractId,
  });
  const accessOffer = accessFloor.minFee * FEE_HEADROOM;

  console.log("access fee floor:", {
    inputFee: formatPaliAmount(accessFloor.inputFee),
    minFee: formatPaliAmount(accessFloor.minFee),
    offering: `${fromAtomicPaliAmount(accessOffer)} PALI`,
  });

  const grant = await accessContract(
    {
      dataContractId,
      cipher: encrypted.cipher,
      recipientPublicKey,
      guardians: group.guardians,
      fee: { amount: fromAtomicPaliAmount(accessOffer), computeRate: COMPUTE_RATE },
      metadata: {
        name: "greeting-subject-access",
        description: `Requests the key protecting ${dataContractId}.`,
        storeType: "Other",
      },
    },
    consumer,
  );
  assertCondition(
    !!grant.agreementId,
    "accessContract did not emit AgreementCreated — the guardians rejected the offer, or the " +
      "pallet rejected the restated threshold parameters",
  );
  console.log(`access request submitted: contract=${grant.agreementId} block=${grant.blockNumber}`);
  console.log("waiting for the guardian set to derive the key and the orchestrator to wrap it...");

  const grantResult = await waitForResult(api, grant.agreementId, RESULT_BLOCKS);
  assertCondition(
    grantResult.executionOutcome === "Success",
    `the access grant failed: ${grantResult.executionOutcome} — ` +
      `payload was ${JSON.stringify(toBytes(grantResult.compute?.input?.Inline?.data ?? "0x").toString("utf8"))}`,
  );

  // (a) The grant must not be the key in the clear, and must unwrap to the publisher's key.
  const { wrapped, key: grantedKey } = unwrapGrant(grantResult.compute, recipientSecret);
  const publisherKey = Buffer.from(encrypted.sharedKey);
  assertCondition(
    !wrapped.equals(publisherKey),
    "the grant carried the symmetric key verbatim — it was published in the clear on chain",
  );
  assertCondition(
    grantedKey.equals(publisherKey),
    `the granted key does not match the key the data was encrypted under:\n` +
      `  granted:   0x${grantedKey.toString("hex")}\n` +
      `  published: 0x${publisherKey.toString("hex")}`,
  );

  console.log("grant verified:", {
    block: grantResult.blockNumber,
    extrinsicIndex: grantResult.extrinsicIndex,
    wrappedBytes: wrapped.length,
    keyMatchesPublisher: true,
  });

  // ── 2b. The pallet rejects a restatement that is not the referenced contract's ──
  if (!SKIP_NEGATIVE) {
    const tampered = JSON.parse(JSON.stringify(encrypted.cipher));
    const params = tampered.ThresholdHybrid.thresholdParams.SilentThreshold;
    params.tdParams[0] = params.tdParams[0] ^ 0xff;

    const rejected = await accessContract(
      {
        dataContractId,
        cipher: tampered,
        recipientPublicKey,
        guardians: group.guardians,
        fee: { amount: fromAtomicPaliAmount(accessOffer), computeRate: COMPUTE_RATE },
        metadata: {
          name: "greeting-subject-access-tampered",
          description: "Restates parameters that do not belong to the referenced contract.",
          storeType: "Other",
        },
      },
      consumer,
    ).catch((err) => ({ error: err }));

    assertCondition(
      !rejected.agreementId,
      "the pallet accepted an access request whose restated threshold parameters do not match " +
        "the referenced contract's commitment — the mismatch gate is not working",
    );
    console.log("tampered access request correctly rejected (ThresholdCommitmentMismatch)");
  }

  // ── 3. Use the data, naming the grant ─────────────────────────────────
  const computeFloor = await estimateMinFee({
    computeRate: COMPUTE_RATE,
    inputContractId: dataContractId,
  });
  const computeOffer = computeFloor.minFee * FEE_HEADROOM;

  const run = await storedCompute(
    {
      guardians: group.guardians,
      programContractId: program.agreementId,
      inputContractId: dataContractId,
      fee: { amount: fromAtomicPaliAmount(computeOffer), computeRate: COMPUTE_RATE },
      programEnv: buildAccessGrantEnv({
        contractId: grant.agreementId,
        blockNumber: grantResult.blockNumber,
        extrinsicIndex: grantResult.extrinsicIndex,
      }),
      metadata: {
        name: "greet-via-encrypted-access",
        description: `Runs ${program.agreementId} against encrypted ${dataContractId}.`,
        storeType: "Other",
      },
      deadline: 0,
      trustIndex: 0,
    },
    consumer,
  );
  assertCondition(!!run.agreementId, "storedCompute did not emit AgreementCreated");
  console.log(`compute submitted with grant: contract=${run.agreementId} block=${run.blockNumber}`);

  const runResult = await waitForResult(api, run.agreementId, RESULT_BLOCKS);
  const output = toBytes(runResult.compute?.input?.Inline?.data ?? "0x").toString("utf8");

  console.log("compute result:", { outcome: runResult.executionOutcome, block: runResult.blockNumber });
  console.log("output:\n" + output);

  // (c) Only a run where the grant unwrapped and the ciphertext opened can print this.
  assertCondition(
    runResult.executionOutcome === "Success",
    `the compute failed: ${runResult.executionOutcome} — output was: ${output}`,
  );
  const expectedGreeting = `Hello ${subject}!`;
  assertCondition(
    output.includes(expectedGreeting),
    `output does not contain ${JSON.stringify(expectedGreeting)} — the encrypted input did not ` +
      `open. Output was:\n${output}`,
  );

  // ── 3b. Without a grant the data stays shut ───────────────────────────
  if (!SKIP_NEGATIVE) {
    const ungranted = await storedCompute(
      {
        guardians: group.guardians,
        programContractId: program.agreementId,
        inputContractId: dataContractId,
        fee: { amount: fromAtomicPaliAmount(computeOffer), computeRate: COMPUTE_RATE },
        metadata: {
          name: "greet-without-access",
          description: "References the encrypted contract while naming no grant.",
          storeType: "Other",
        },
        deadline: 0,
        trustIndex: 0,
      },
      consumer,
    );
    assertCondition(!!ungranted.agreementId, "ungranted storedCompute did not emit AgreementCreated");

    const ungrantedResult = await waitForResult(api, ungranted.agreementId, RESULT_BLOCKS);
    const ungrantedOutput = toBytes(
      ungrantedResult.compute?.input?.Inline?.data ?? "0x",
    ).toString("utf8");

    assertCondition(
      ungrantedResult.executionOutcome !== "Success" &&
        !ungrantedOutput.includes(expectedGreeting),
      "a contract naming no access grant still decrypted the data — the grant is not actually " +
        `required. Outcome ${ungrantedResult.executionOutcome}, output: ${ungrantedOutput}`,
    );
    console.log(
      `ungranted compute correctly refused (${ungrantedResult.executionOutcome}): ` +
        ungrantedOutput.slice(0, 160),
    );
  }

  console.log("\nencrypted access compute test passed");
  console.log({
    encryptedDataContractId: dataContractId,
    programContractId: program.agreementId,
    accessGrantId: grant.agreementId,
    computeContractId: run.agreementId,
    grantedKey: `0x${grantedKey.toString("hex")}`,
  });

  return { dataContractId, grant, run };
}

encryptedAccessCompute(process.argv[2])
  .then(async () => {
    await disconnectApi();
    process.exit(0);
  })
  .catch(async (err) => {
    console.error("encrypted access compute test failed:", err);
    await disconnectApi().catch(() => {});
    process.exit(1);
  });
