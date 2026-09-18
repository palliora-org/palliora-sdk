/**
 * Registers a container image as a `Dormant` contract — the "stored program"
 * half of the stored-program/stored-input pair.
 *
 * The image itself cannot live on-chain: the tarball is uploaded to the
 * configured storage provider, and the contract records the URL it landed at.
 * Ordering is forced by the auth service, which only hands out an upload URL
 * for a file hash it can find in an already-included agreement:
 *
 *   sha256(tar) → deterministic URL → Dormant contract → presigned URL → PUT
 *
 * The program goes in `compute.input`, not `compute.program`: a Dormant
 * contract registers an artifact rather than running one, and
 * `{ ContractId: { id } }` on a later contract reads that field.
 *
 * Usage:
 *   node scripts/test-store-program-contract.mjs [path/to/image.tar]
 */

import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import {
  configure,
  dataContract,
  disconnectApi,
  getApi,
  getGuardianAddress,
  getKeyring,
  storageRouter,
} from "../dist/index.js";

const DEFAULT_TAR = "/Users/ujjwal/palliora-cli/greet-image.tar";
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

export async function storeProgramContract(tarPath = DEFAULT_TAR) {
  configure({
    ...(process.env.PALLIORA_WS ? { pallioraWs: process.env.PALLIORA_WS } : {}),
    debug: true,
  });

  const keyring = await getKeyring();
  const signer = keyring.getPairs()[0];
  assertCondition(!!signer, "No signer account in keyring");

  const guardians = await selectGuardians();

  const fileData = readFileSync(tarPath);
  const fileHash = createHash("sha256").update(fileData).digest("hex");
  const provider = storageRouter.getProvider();
  const url = provider.getDeterministicUrl(fileHash);

  console.log("program tar:", tarPath, `(${fileData.length} bytes)`);
  console.log("sha256:", fileHash);
  console.log("storage url:", url);

  // `fee` on a Dormant contract becomes its usage price. A zero offer is
  // accepted by the pallet but leaves the guardian with nothing to weigh, and
  // the agreement then sits unincluded rather than failing — so price it.
  const stored = await dataContract(
    {
      url,
      guardians,
      fee: { amount: USAGE_PRICE, computeRate: "0" },
      metadata: {
        name: "hello-world-inline",
        description:
          "Alpine container that greets the name in its first /input file. " +
          "docker save tarball, loaded as a local archive.",
        storeType: "Executable",
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

  // The URL is content-addressed, so identical bytes are already the right
  // bytes: re-uploading would rewrite the object with its own content. The
  // upload is what needs authorizing, and the auth service grants it against
  // the agreement just submitted — so it only runs when the object is absent.
  const existing = await fetch(url, { method: "HEAD" });
  if (existing.ok && Number(existing.headers.get("content-length")) === fileData.length) {
    console.log("tar already hosted at its content hash; skipping upload");
  } else {
    console.log("uploading tar to storage provider...");
    const uploadUrl = await provider.getUploadUrl(
      stored.hash,
      fileHash,
      stored.blockNumber,
      url,
    );
    await provider.upload(uploadUrl, new Uint8Array(fileData));
  }

  const hosted = await fetch(url, { method: "HEAD" });
  assertCondition(hosted.ok, `tar is not readable at ${url}: HTTP ${hosted.status}`);
  assertCondition(
    Number(hosted.headers.get("content-length")) === fileData.length,
    `hosted tar is ${hosted.headers.get("content-length")} bytes, expected ${fileData.length}`,
  );

  console.log("stored program contract test passed");
  console.log({
    programContractId: stored.agreementId,
    blockNumber: stored.blockNumber,
    extrinsicIndex: stored.index,
    url,
  });

  return { ...stored, url, fileHash };
}

storeProgramContract(process.argv[2])
  .then(async (result) => {
    console.log("\nPROGRAM_CONTRACT_ID=%s", result.agreementId);
    await disconnectApi();
    process.exit(0);
  })
  .catch(async (err) => {
    console.error("stored program contract test failed:", err);
    await disconnectApi().catch(() => {});
    process.exit(1);
  });
