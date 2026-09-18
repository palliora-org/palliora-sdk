/**
 * Creates an executable contract from two artifacts already registered on-chain.
 *
 * Takes the contract IDs produced by `test-store-program-contract.mjs` and
 * `test-store-data-contract.mjs` and submits an `Active` agreement that names
 * neither an image nor a payload directly — both are `{ ContractId: { id } }`
 * references the orchestrator dereferences to the stored contracts'
 * `compute.input`.
 *
 * The fee floor is quoted rather than guessed: referencing a stored input
 * raises it by that contract's usage price, and `estimateMinFee` is the only
 * thing that knows the live chain parameters.
 *
 * Usage:
 *   node scripts/test-stored-contract-compute.mjs <programContractId> <inputContractId>
 *
 * Environment:
 *   COMPUTE_RATE   per-millisecond rate in PALI (default 0.00001)
 *   FEE_HEADROOM   multiple of the floor to offer, buying execution time (default 4)
 */

import {
  configure,
  disconnectApi,
  estimateMinFee,
  formatPaliAmount,
  fromAtomicPaliAmount,
  getApi,
  getGuardianAddress,
  getKeyring,
  storedCompute,
} from "../dist/index.js";

const COMPUTE_RATE = process.env.COMPUTE_RATE ?? "0.00001";
const FEE_HEADROOM = BigInt(process.env.FEE_HEADROOM ?? "4");

function assertCondition(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

// The named guardian must be live: an agreement naming an unresponsive guardian
// is never included and never errors (CHAIN-RULES.md "Two gates, not one").
async function selectGuardians() {
  const entries = await getGuardianAddress();
  assertCondition(entries.length >= 1, "No guardians available on-chain");

  const requested = process.env.PALLIORA_GUARDIAN;
  if (!requested) return [entries[0].address];

  const match = entries.find((g) => g.address === requested);
  assertCondition(
    !!match,
    `PALLIORA_GUARDIAN ${requested} is not a registered guardian; available: ${entries
      .map((g) => g.address)
      .join(", ")}`,
  );
  return [match.address];
}

async function requireDormant(api, contractId, label) {
  const onChain = (await api.query.compute.contracts(contractId)).toJSON();
  assertCondition(!!onChain, `${label} contract ${contractId} not found on chain`);
  assertCondition(
    String(onChain.contractType ?? onChain.contract_type).toLowerCase() === "dormant",
    `${label} contract ${contractId} is not Dormant: ${JSON.stringify(onChain)}`,
  );
  return onChain;
}

export async function storedContractCompute(programContractId, inputContractId) {
  assertCondition(
    !!programContractId && !!inputContractId,
    "usage: node scripts/test-stored-contract-compute.mjs <programContractId> <inputContractId>",
  );

  configure({
    ...(process.env.PALLIORA_WS ? { pallioraWs: process.env.PALLIORA_WS } : {}),
    debug: true,
  });

  const keyring = await getKeyring();
  const signer = keyring.getPairs()[0];
  assertCondition(!!signer, "No signer account in keyring");

  const api = await getApi();
  assertCondition(!!api, "Api not initialized");

  await requireDormant(api, programContractId, "program");
  await requireDormant(api, inputContractId, "input");

  const guardians = await selectGuardians();

  // Only the input reference is billed: its owner is paid the contract's usage
  // price at settlement, which is why the floor has to be quoted against it.
  const floor = await estimateMinFee({
    computeRate: COMPUTE_RATE,
    inputContractId,
  });
  const amount = fromAtomicPaliAmount(floor.minFee * FEE_HEADROOM);

  console.log("fee floor:", {
    resultFee: formatPaliAmount(floor.resultFee),
    inputFee: formatPaliAmount(floor.inputFee),
    thresholdDecryptionFee: formatPaliAmount(floor.thresholdDecryptionFee),
    offeredComponent: formatPaliAmount(floor.offeredComponent),
    minFee: formatPaliAmount(floor.minFee),
    offering: `${amount} PALI`,
  });

  const free = BigInt(
    (await api.query.system.account(signer.address)).data.free.toString(),
  );
  assertCondition(
    free >= floor.minFee * FEE_HEADROOM,
    `signer holds ${formatPaliAmount(free)} but must hold the full offer to submit`,
  );

  const result = await storedCompute(
    {
      guardians,
      programContractId,
      inputContractId,
      fee: { amount, computeRate: COMPUTE_RATE },
      // "Other": this contract registers no artifact of its own, it executes
      // two that are already registered. The pallet has no variant for a run.
      metadata: {
        name: "greet-stored-program",
        description:
          `Runs stored program ${programContractId} against stored input ${inputContractId}.`,
        storeType: "Other",
      },
      deadline: 0,
      trustIndex: 0,
    },
    signer,
  );

  assertCondition(!!result.hash, "storedCompute tx hash is missing");
  assertCondition(result.blockNumber !== undefined, "storedCompute blockNumber is missing");
  assertCondition(
    !!result.agreementId,
    "storedCompute did not emit AgreementCreated — guardians rejected the offer",
  );

  const onChain = (await api.query.compute.contracts(result.agreementId)).toJSON();
  assertCondition(
    String(onChain?.contractType ?? onChain?.contract_type).toLowerCase() === "active",
    `expected an Active contract, got ${JSON.stringify(onChain)}`,
  );

  console.log("stored contract compute test passed");
  console.log({
    contractId: result.agreementId,
    blockNumber: result.blockNumber,
    extrinsicIndex: result.index,
    hash: result.hash,
    programContractId,
    inputContractId,
  });

  return result;
}

storedContractCompute(process.argv[2], process.argv[3])
  .then(async (result) => {
    // The coordinates a guardian dispatches to its orchestrator with.
    console.log(
      "\nDISPATCH=%s",
      JSON.stringify({
        requestId: result.agreementId,
        blockHeight: result.blockNumber,
        extrinsicIndex: result.index,
      }),
    );
    await disconnectApi();
    process.exit(0);
  })
  .catch(async (err) => {
    console.error("stored contract compute test failed:", err);
    await disconnectApi().catch(() => {});
    process.exit(1);
  });
