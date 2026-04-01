import bs58 from "bs58";
import {
  configure,
  getApi,
  getGuardianAddress,
  getKeyring,
  signAndSend,
  simpleCompute,
  DEFAULT_EMPTY_PAYLOAD,
} from "../dist/index.js";

function assertCondition(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

export async function testSimpleComputeIntegration() {
  if (process.env.PALLIORA_WS) {
    configure({ pallioraWs: process.env.PALLIORA_WS, debug: true });
  } else {
    configure({ debug: true });
  }

  const keyring = await getKeyring();
  const signer = keyring.getPairs()[0];
  assertCondition(!!signer, "No signer account in keyring");

  const guardianEntries = await getGuardianAddress();
  assertCondition(
    guardianEntries.length >= 1,
    "No guardians available on-chain",
  );

  const selected = guardianEntries.slice(0, 3);
  assertCondition(selected.length > 0, "No guardians selected for compute");

  const guardianAddresses = selected.map((g) => g.address);
  const agreement = selected.map((g) => bs58.decode(g.peerid).subarray(6));

  const api = await getApi();
  if (!api) throw new Error("Api not initialized");

  // Submit DA input first and use its block/index as ChainTransaction input reference.
  const inputPayload = JSON.stringify({ prompt: "integration-test-simple-compute" });
  const daTx = api.tx.dataAvailability.submitData(inputPayload);
  const daResult = await signAndSend(daTx, signer, DEFAULT_EMPTY_PAYLOAD);

  assertCondition(
    daResult.blockNumber !== undefined && daResult.index !== undefined,
    "Failed to submit DA input transaction",
  );

  const result = await simpleCompute({
    guardians: guardianAddresses,
    inputBlockNumber: daResult.blockNumber,
    inputExtrinsicIndex: daResult.index,
    programUrl:
      process.env.SIMPLE_COMPUTE_PROGRAM_URL ||
      "https://example.com/program.wasm",
    fees: 0,
    deadline: 0,
    trustIndex: 0,
    opts: { compute: { da_type: 1, agreement, verification: 0, compute: 1 } },
  });

  assertCondition(!!result.hash, "simpleCompute tx hash is missing");
  assertCondition(
    result.blockNumber !== undefined,
    "simpleCompute blockNumber is missing",
  );

  console.log("simpleCompute integration test passed");
  console.log({
    daInput: {
      blockNumber: daResult.blockNumber,
      extrinsicIndex: daResult.index,
      hash: daResult.hash,
    },
    computeResult: result,
  });

  return result;
}

async function main() {
  await testSimpleComputeIntegration();
}

main().catch((err) => {
  console.error("simpleCompute integration test failed:", err);
  process.exit(1);
});
