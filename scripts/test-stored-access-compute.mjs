/**
 * End-to-end test of the stored-artefact access path.
 *
 * `test-stored-program-compute.mjs` runs the hello-greet image by naming it
 * directly: the program is a `Url` in the contract and the input is a DA
 * extrinsic the same script submitted a moment earlier. Nothing is published,
 * so nothing is accessed.
 *
 * This script runs the same compute, but neither artefact is named by the
 * contract that executes them. Both are published first as `Dormant`
 * contracts — one holding the program reference, one holding the greeting
 * subject — and the `Active` contract reaches them with
 * `{ ContractId: { id } }`. That reference is the access: it is what the
 * orchestrator dereferences, and what settlement charges for.
 *
 *   publish program  ──┐
 *                      ├─→ Active contract ──→ guardian ──→ orchestrator
 *   publish data    ──┘     (two ContractId refs)            dereferences both
 *
 * Three things are asserted that the direct path cannot exercise:
 *
 *   1. The orchestrator dereferences a `ContractId` in `compute.program`
 *      (→ the image) and in `compute.input` (→ the greeting subject), and the
 *      container's stdout proves both resolved to the right artefact.
 *   2. Only the `input` reference is billed. The pallet records
 *      `SettlementInfo::input_contract_id` from `compute.input` alone, so the
 *      fee floor rises by the data contract's usage price and its owner is
 *      paid at settlement — the program contract's owner is not.
 *   3. A consumer other than the publisher can do all of this. Set
 *      `CONSUMER_SEED` to run the `Active` contract from a second account;
 *      the `InputFeePaid` assertion then shows value crossing between them.
 *
 * Usage:
 *   node scripts/test-stored-access-compute.mjs ["mr. who"]
 *
 * Environment:
 *   PALLIORA_WS      chain endpoint (default ws://127.0.0.1:9947)
 *   PROGRAM_IMAGE    image the program contract registers
 *                    (default ujjwalpal/hello-world:test)
 *   USAGE_PRICE      usage price each Dormant contract charges, in PALI
 *   COMPUTE_RATE     per-millisecond rate in PALI (default 0.00001)
 *   FEE_HEADROOM     multiple of the fee floor to offer (default 4)
 *   PALLIORA_GUARDIAN pin the agreement to one guardian account
 *   CONSUMER_SEED    seed URI for the account that runs the compute; defaults
 *                    to the publisher, which leaves assertion 3 trivially true
 *   RESULT_BLOCKS    blocks to wait for the result (default 40)
 */

import {
  init,
  dataContract,
  disconnectApi,
  estimateMinFee,
  formatPaliAmount,
  fromAtomicPaliAmount,
  getApi,
  getGuardianAddress,
  getKeyring,
  storedCompute,
} from "../dist/index.js";

const PALLIORA_WS = process.env.PALLIORA_WS ?? "ws://127.0.0.1:9947";
const PROGRAM_IMAGE = process.env.PROGRAM_IMAGE ?? "ujjwalpal/hello-world:test";
const USAGE_PRICE = process.env.USAGE_PRICE ?? "0.05";
const COMPUTE_RATE = process.env.COMPUTE_RATE ?? "0.00001";
const FEE_HEADROOM = BigInt(process.env.FEE_HEADROOM ?? "4");
const RESULT_BLOCKS = Number(process.env.RESULT_BLOCKS ?? "40");
const DEFAULT_GREETING_SUBJECT = "mr. who";

function assertCondition(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

/**
 * Guardian accounts to name in every contract this script submits.
 *
 * `getGuardianAddress` reports the guardians this node is *connected to* over
 * the guardian P2P protocol, which is empty until that mesh forms. The
 * registered set is on-chain regardless, and that is what `CheckCompute`
 * validates against (`Custom(148)`), so the on-chain list is the fallback.
 */
async function selectGuardians(api) {
  const connected = await getGuardianAddress().catch(() => []);
  const onChain = ((await api.query.guardian.guardians()).toJSON() ?? []);

  const available = connected.length > 0 ? connected.map((g) => g.address) : onChain;
  assertCondition(
    available.length >= 1,
    "No guardians available: neither the guardian RPC nor guardian.guardians reports any",
  );

  const requested = process.env.PALLIORA_GUARDIAN;
  if (!requested) return [available[0]];

  assertCondition(
    available.includes(requested),
    `PALLIORA_GUARDIAN ${requested} is not a registered guardian; available: ${available.join(", ")}`,
  );
  return [requested];
}

/**
 * Publishes one artefact as a `Dormant` contract and returns its id.
 *
 * The payload rides `Inline`, which is what `dataContract({ data })` produces:
 * both artefacts here are short strings — an image reference and a name — so
 * neither warrants off-chain hosting. The orchestrator resolves an inline
 * program to a registry image reference and an inline input to bytes on
 * `/input`, which is exactly the shape each one needs.
 */
async function publishArtefact(api, { payload, name, description, storeType, guardians }, publisher) {
  const stored = await dataContract(
    {
      data: payload,
      guardians,
      // A Dormant contract's `fee` becomes its usage price — what a contract
      // referencing it pays this contract's owner.
      fee: { amount: USAGE_PRICE, computeRate: "0" },
      metadata: { name, description, storeType },
    },
    publisher,
  );

  assertCondition(
    !!stored.agreementId,
    `${name}: Dormant contract did not emit AgreementCreated — the guardian did not accept it`,
  );

  const onChain = (await api.query.compute.contracts(stored.agreementId)).toJSON();
  assertCondition(!!onChain, `${name}: contract ${stored.agreementId} not readable back from chain`);
  assertCondition(
    String(onChain.contractType ?? onChain.contract_type).toLowerCase() === "dormant",
    `${name}: expected a Dormant contract, got ${JSON.stringify(onChain)}`,
  );

  const usagePrice = BigInt(String(onChain.usagePrice ?? onChain.usage_price ?? 0));
  assertCondition(
    usagePrice > 0n,
    `${name}: expected a non-zero usage price, got ${usagePrice.toString()}`,
  );
  assertCondition(
    String(onChain.owner) === publisher.address,
    `${name}: expected owner ${publisher.address}, got ${onChain.owner}`,
  );

  console.log(
    `published ${name}: contract=${stored.agreementId} block=${stored.blockNumber} ` +
      `usagePrice=${formatPaliAmount(usagePrice)}`,
  );

  return { contractId: stored.agreementId, usagePrice, ...stored };
}

/** The bytes a `compute.result` extrinsic carries back, as UTF-8. */
function decodeResultPayload(resultArgs) {
  const inline = resultArgs?.contract?.compute?.input?.Inline;
  assertCondition(
    !!inline,
    `compute.result did not carry an Inline payload: ${JSON.stringify(resultArgs?.contract?.compute?.input)}`,
  );

  const data = inline.data;
  if (typeof data === "string") {
    return data.startsWith("0x")
      ? Buffer.from(data.slice(2), "hex").toString("utf8")
      : data;
  }
  if (Array.isArray(data)) {
    return Buffer.from(data.map(Number)).toString("utf8");
  }
  throw new Error(`unrecognised Inline result payload: ${JSON.stringify(data)}`);
}

/**
 * Waits for the node operator's `compute.result` for `contractId`.
 *
 * The result payload is not in an event — `result_relay` carries it in the
 * extrinsic, as `contract.compute.input.Inline.data` of the `Dormant` contract
 * it wraps the output in. So the block is scanned for the extrinsic itself,
 * and the `compute` events of that block are collected alongside it to show
 * how the contract settled.
 */
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
        finish(
          reject,
          new Error(
            `no compute.result for ${contractId} within ${maxBlocks} blocks. ` +
              "Check the orchestrator log: the guardian dispatches to it, and it is " +
              "what submits the result back through result_relay.",
          ),
        );
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

          const at = await api.at(blockHash);
          const events = await at.query.system.events();
          const computeEvents = events
            .filter((record) => record.event.section.toLowerCase() === "compute")
            .map((record) => ({
              method: record.event.method,
              data: record.event.data.toHuman(),
            }));

          finish(resolve, {
            blockNumber,
            extrinsicIndex: index,
            executionOutcome: String(args.execution_outcome ?? args.executionOutcome ?? ""),
            computeDurationMs: String(args.compute_duration_ms ?? args.computeDurationMs ?? ""),
            submitor: String(args.submitor ?? ""),
            output: decodeResultPayload(args),
            computeEvents,
          });
          return;
        }
      } catch (err) {
        // A single unreadable block should not abort the wait; the next header
        // retries. Only exhausting `maxBlocks` is fatal.
        console.warn(`scan of block ${blockNumber} failed: ${err.message}`);
      }
    });

    subscription.then((u) => {
      unsubscribe = u;
      if (done) u();
    }, (err) => finish(reject, err));
  });
}

export async function storedAccessCompute(greetingSubject = DEFAULT_GREETING_SUBJECT) {
  init({ pallioraWs: PALLIORA_WS, debug: true });

  const api = await getApi();
  assertCondition(!!api, "Api not initialized");

  const keyring = await getKeyring();
  const publisher = keyring.getPairs()[0];
  assertCondition(!!publisher, "No signer account in keyring");

  const consumer = process.env.CONSUMER_SEED
    ? keyring.addFromUri(process.env.CONSUMER_SEED, { name: "consumer" })
    : publisher;

  const guardians = await selectGuardians(api);

  console.log({
    endpoint: PALLIORA_WS,
    publisher: publisher.address,
    consumer: consumer.address,
    sameAccount: consumer.address === publisher.address,
    guardians,
    programImage: PROGRAM_IMAGE,
    greetingSubject,
  });

  if (consumer.address === publisher.address) {
    console.warn(
      "CONSUMER_SEED is unset: publisher and consumer are the same account, " +
        "so the input fee is paid back to the payer and proves nothing about cross-account access.",
    );
  }

  // ── Publish: two Dormant contracts, owned by the publisher ────────────
  const program = await publishArtefact(
    api,
    {
      payload: PROGRAM_IMAGE,
      name: "hello-greet-program",
      description:
        `Container that greets the name in its first /input file: ${PROGRAM_IMAGE}.`,
      storeType: "Executable",
      guardians,
    },
    publisher,
  );

  const input = await publishArtefact(
    api,
    {
      payload: greetingSubject,
      name: "greeting-subject",
      description: `Name the greeting program is run against: ${JSON.stringify(greetingSubject)}.`,
      storeType: "Dataset",
      guardians,
    },
    publisher,
  );

  // ── Access: an Active contract that names neither artefact directly ──
  //
  // Only the input reference is billed, so the floor is quoted against that
  // contract alone — the program reference costs the consumer nothing.
  const floor = await estimateMinFee({
    computeRate: COMPUTE_RATE,
    inputContractId: input.contractId,
  });
  assertCondition(
    floor.inputFee === input.usagePrice,
    `fee floor's input fee ${floor.inputFee} does not match the data contract's ` +
      `usage price ${input.usagePrice} — the reference is not being priced`,
  );

  const offer = floor.minFee * FEE_HEADROOM;
  const amount = fromAtomicPaliAmount(offer);

  console.log("fee floor:", {
    resultFee: formatPaliAmount(floor.resultFee),
    inputFee: formatPaliAmount(floor.inputFee),
    thresholdDecryptionFee: formatPaliAmount(floor.thresholdDecryptionFee),
    offeredComponent: formatPaliAmount(floor.offeredComponent),
    minFee: formatPaliAmount(floor.minFee),
    offering: `${amount} PALI`,
  });

  const consumerFree = BigInt(
    (await api.query.system.account(consumer.address)).data.free.toString(),
  );
  assertCondition(
    consumerFree >= offer,
    `consumer ${consumer.address} holds ${formatPaliAmount(consumerFree)} but must hold ` +
      `the full offer (${amount} PALI) to submit`,
  );

  const publisherBefore = BigInt(
    (await api.query.system.account(publisher.address)).data.free.toString(),
  );

  const compute = await storedCompute(
    {
      guardians,
      programContractId: program.contractId,
      inputContractId: input.contractId,
      fee: { amount, computeRate: COMPUTE_RATE },
      // "Other": this contract registers no artefact of its own, it executes
      // two that are already registered.
      metadata: {
        name: "greet-via-stored-access",
        description:
          `Runs stored program ${program.contractId} against stored input ${input.contractId}.`,
        storeType: "Other",
      },
      deadline: 0,
      trustIndex: 0,
    },
    consumer,
  );

  assertCondition(
    !!compute.agreementId,
    "storedCompute did not emit AgreementCreated — the guardian rejected the offer",
  );

  const activeOnChain = (await api.query.compute.contracts(compute.agreementId)).toJSON();
  assertCondition(
    String(activeOnChain?.contractType ?? activeOnChain?.contract_type).toLowerCase() === "active",
    `expected an Active contract, got ${JSON.stringify(activeOnChain)}`,
  );

  console.log(
    `access contract submitted: contract=${compute.agreementId} ` +
      `block=${compute.blockNumber} extrinsicIndex=${compute.index}`,
  );
  console.log("waiting for the orchestrator to dereference both artefacts and run...");

  // ── Use: the orchestrator's output, submitted back on-chain ──────────
  const result = await waitForResult(api, compute.agreementId, RESULT_BLOCKS);

  console.log("compute.result:", {
    blockNumber: result.blockNumber,
    extrinsicIndex: result.extrinsicIndex,
    executionOutcome: result.executionOutcome,
    computeDurationMs: result.computeDurationMs,
    submitor: result.submitor,
  });
  console.log("output:\n" + result.output);
  console.log("compute events:", JSON.stringify(result.computeEvents, null, 2));

  assertCondition(
    result.executionOutcome === "Success",
    `execution did not succeed: ${result.executionOutcome} — output was: ${result.output}`,
  );

  // The program contract supplied the image and the input contract supplied
  // the name: only a run where both references resolved can print this line.
  const expectedGreeting = `Hello ${greetingSubject}!`;
  assertCondition(
    result.output.includes(expectedGreeting),
    `output does not contain ${JSON.stringify(expectedGreeting)} — ` +
      `one of the two ContractId references did not resolve. Output was:\n${result.output}`,
  );

  // Settlement pays the input contract's owner its usage price. The program
  // reference is not in `SettlementInfo`, so it is not paid for.
  const inputFeePaid = result.computeEvents.find((event) => event.method === "InputFeePaid");
  assertCondition(
    !!inputFeePaid,
    `no InputFeePaid event: the data contract's owner was not paid for the access. ` +
      `Events were: ${JSON.stringify(result.computeEvents)}`,
  );
  assertCondition(
    String(inputFeePaid.data[0]) === publisher.address,
    `InputFeePaid went to ${inputFeePaid.data[0]}, expected the publisher ${publisher.address}`,
  );

  const publisherAfter = BigInt(
    (await api.query.system.account(publisher.address)).data.free.toString(),
  );

  console.log("stored access compute test passed");
  console.log({
    programContractId: program.contractId,
    inputContractId: input.contractId,
    accessContractId: compute.agreementId,
    inputFeePaidTo: String(inputFeePaid.data[0]),
    inputFeeAmount: String(inputFeePaid.data[1]),
    publisherBalanceDelta: formatPaliAmount(publisherAfter - publisherBefore),
  });

  return { program, input, compute, result };
}

storedAccessCompute(process.argv[2])
  .then(async () => {
    await disconnectApi();
    process.exit(0);
  })
  .catch(async (err) => {
    console.error("stored access compute test failed:", err);
    await disconnectApi().catch(() => {});
    process.exit(1);
  });
