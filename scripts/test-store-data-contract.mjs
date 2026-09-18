/**
 * Registers a short string as a `Dormant` contract — the "stored input" half of
 * the stored-program/stored-input pair.
 *
 * Seven bytes do not warrant off-chain hosting, so the payload rides `Inline`
 * in the extrinsic itself. Placement is the same as for a stored program: the
 * artifact lives in `compute.input`, which is what `{ ContractId: { id } }`
 * resolves to.
 *
 * Unlike a program reference, an input reference *is* billed — settlement pays
 * this contract's owner the `fee` offered here — so it is given a non-zero
 * usage price to exercise that path.
 *
 * Usage:
 *   node scripts/test-store-data-contract.mjs ["mr. who"]
 */

import {
  init,
  dataContract,
  disconnectApi,
  getApi,
  getGuardianAddress,
  getKeyring,
} from "../dist/index.js";

const DEFAULT_PAYLOAD = "mr. who";
const USAGE_PRICE = "0.05";

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

export async function storeDataContract(payload = DEFAULT_PAYLOAD) {
  init({
    pallioraWs: process.env.PALLIORA_WS ?? "wss://manas-rpc.palliora.org",
    debug: true,
  });

  const keyring = await getKeyring();
  const signer = keyring.getPairs()[0];
  assertCondition(!!signer, "No signer account in keyring");

  const guardians = await selectGuardians();

  console.log("storing inline payload:", JSON.stringify(payload));

  const stored = await dataContract(
    {
      data: payload,
      guardians,
      fee: { amount: USAGE_PRICE, computeRate: "0" },
      metadata: {
        name: "greeting-subject",
        description: `Name the greeting program is run against: ${JSON.stringify(payload)}.`,
        storeType: "Dataset",
      },
    },
    signer,
  );

  assertCondition(!!stored.agreementId, "Dormant contract did not emit AgreementCreated");

  const api = await getApi();
  const onChain = (await api.query.compute.contracts(stored.agreementId)).toJSON();
  assertCondition(!!onChain, `contract ${stored.agreementId} not readable back from chain`);
  assertCondition(
    String(onChain.contractType ?? onChain.contract_type).toLowerCase() === "dormant",
    `expected a Dormant contract, got ${JSON.stringify(onChain)}`,
  );

  // A Dormant contract's offered fee becomes its usage price — what the
  // referencing contract's settlement pays this contract's owner.
  const usagePrice = BigInt(String(onChain.usagePrice ?? onChain.usage_price ?? 0));
  assertCondition(
    usagePrice > 0n,
    `expected a non-zero usage price, got ${usagePrice.toString()}`,
  );

  console.log("stored data contract test passed");
  console.log({
    inputContractId: stored.agreementId,
    blockNumber: stored.blockNumber,
    extrinsicIndex: stored.index,
    payload,
    usagePrice: usagePrice.toString(),
  });

  return stored;
}

storeDataContract(process.argv[2])
  .then(async (result) => {
    console.log("\nINPUT_CONTRACT_ID=%s", result.agreementId);
    await disconnectApi();
    process.exit(0);
  })
  .catch(async (err) => {
    console.error("stored data contract test failed:", err);
    await disconnectApi().catch(() => {});
    process.exit(1);
  });
