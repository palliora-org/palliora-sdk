import { getKeyring, payoutStake } from "../dist/index.js";

function parseEras(raw) {
  const eras = raw
    .split(",")
    .map((part) => Number(part.trim()))
    .filter((value) => Number.isInteger(value) && value >= 0);

  if (eras.length === 0) {
    throw new Error("No valid eras were provided.");
  }

  return eras;
}

async function main() {
  const [eras, stashAddress] = [[0,1], "5DCR51AGuydb8Vd79sSBBYrvCKonpWF5Q4SN54LLo6az4Hxc"];

  const keyring = await getKeyring();
  const signer = keyring.getPairs()[0];

  if (!signer) {
    throw new Error("No signer account available in keyring.");
  }

  await payoutStake(signer, eras, stashAddress);

  console.log("payoutStake call completed", {
    signer: signer.address,
    stashAddress: stashAddress || signer.address,
    eras,
  });
}

main().catch((error) => {
  console.error("temp payout test failed:", error);
  process.exit(1);
});
