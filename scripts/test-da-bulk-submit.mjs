import { randomBytes } from "crypto";
import {
  init,
  getApi,
  getKeyring,
  signAndSend,
  DEFAULT_EMPTY_PAYLOAD,
} from "../dist/index.js";

// --- configuration ---
const EXTRINSIC_COUNT = 4;
const DATA_SIZE_BYTES = 340 * 1024; // 240 KB per extrinsic
// ----------------------

function generateUniqueData() {
  // Encode half the target bytes as hex to yield exactly DATA_SIZE_BYTES characters
  return randomBytes(DATA_SIZE_BYTES / 2).toString("hex");
}

async function main() {
  init({
    pallioraWs: process.env.PALLIORA_WS ?? "wss://manas-rpc.palliora.org",
    debug: true,
  });

  const keyring = await getKeyring();
  const signer = keyring.getPairs()[0];
  if (!signer) throw new Error("No signer account in keyring");

  const api = await getApi();
  if (!api) throw new Error("API not initialized");

  const baseNonce = (
    await api.rpc.system.accountNextIndex(signer.address)
  ).toNumber();

  console.log(
    `Submitting ${EXTRINSIC_COUNT} DA extrinsics simultaneously ` +
      `(${DATA_SIZE_BYTES / 1024} KB each, base nonce: ${baseNonce})`,
  );

  const submissions = Array.from({ length: EXTRINSIC_COUNT }, (_, i) => {
    const data = generateUniqueData();
    const tx = api.tx.dataAvailability.submitData(data);
    const opts = { ...DEFAULT_EMPTY_PAYLOAD, nonce: baseNonce + i };
    return signAndSend(tx, signer, opts).then((result) => {
      console.log(
        `[${i}] included — block ${result.blockNumber}, index ${result.index}, hash ${result.hash}, blockHash ${(result.tx_result.status.isFinalized ? result.tx_result.status.asFinalized : result.tx_result.status.asInBlock).toHex()}`,
      );
      return result;
    });
  });

  const results = await Promise.all(submissions);

  console.log(`\nAll ${EXTRINSIC_COUNT} extrinsics included successfully.`);
  console.log(
    results.map((r, i) => ({
      extrinsic: i,
      blockNumber: r.blockNumber,
      index: r.index,
      hash: r.hash,
      blockHash: (r.tx_result.status.isFinalized ? r.tx_result.status.asFinalized : r.tx_result.status.asInBlock).toHex(),
    })),
  );

  process.exit(0);
}

main().catch((err) => {
  console.error("Bulk DA submit test failed:", err);
  process.exit(1);
});
