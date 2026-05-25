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

  const api = await getApi();
  if (!api) throw new Error("Api not initialized");

  // Submit DA input first and use its block/index as ChainTransaction input reference.
  const inputPayload = JSON.stringify("ujjwal");
  const daTx = api.tx.dataAvailability.submitData(inputPayload);
  const daResult = await signAndSend(daTx, signer, DEFAULT_EMPTY_PAYLOAD);

  assertCondition(
    daResult.blockNumber !== undefined && daResult.index !== undefined,
    "Failed to submit DA input transaction",
  );

  const result = await simpleCompute({
    guardians: selected,
    inputBlockNumber: daResult.blockNumber,
    inputExtrinsicIndex: daResult.index,
    programUrl:
      "ujjwalpal/hello-world:test",
    fees: BigInt("2"),
    deadline: 0,
    trustIndex: 0,
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

export async function testInlineProgramComputeIntegration() {
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
  const inputPayload = JSON.stringify({ prompt: "integration-test-inline-program" });
  const daTx = api.tx.dataAvailability.submitData(inputPayload);
  const daResult = await signAndSend(daTx, signer, DEFAULT_EMPTY_PAYLOAD);

  assertCondition(
    daResult.blockNumber !== undefined && daResult.index !== undefined,
    "Failed to submit DA input transaction",
  );

  // Use Docker 'hello-world' image name as inline program bytes.
  const inlineProgramData = Array.from(new TextEncoder().encode("ujjwalpal/hello-world:test"));
  const inlineInputData = Array.from(new TextEncoder().encode("ujjwal"));

  const plaintextCipher = "Plaintext";
  const computeStep = {
    cipher: plaintextCipher,
    computer_indices: guardianAddresses.map((_, i) => i),
    fees: BigInt("2"),
    deadline: 0,
    confidentiality: {
      Trusted: {
        trust_index: 0,
      },
    },
    fee_function: null,
    input: {
      Inline: {
        data: inlineInputData,
      },
    },
    program: {
      Url: {
        url: inlineProgramData,
      },
    },
  };

  const contract = {
    contract_type: "Active",
    guardians: guardianAddresses,
    pre_check: null,
    compute: computeStep,
    post_check: null,
    result_cipher: plaintextCipher,
  };

  const tx = api.tx.compute.agreement(contract);
  const result = await signAndSend(tx, signer, {
    compute: { da_type: 1, agreement, verification: 0, compute: 1 },
  });

  assertCondition(!!result.hash, "inline program compute tx hash is missing");
  assertCondition(
    result.blockNumber !== undefined,
    "inline program compute blockNumber is missing",
  );

  console.log("inline program compute integration test passed");
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
  await testInlineProgramComputeIntegration();
}

main().catch((err) => {
  console.error("simpleCompute integration test failed:", err);
  process.exit(1);
});
