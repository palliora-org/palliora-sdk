import bs58 from "bs58";
import {
  configure,
  inferenceCompute,
  fetchAndDecodeExtrinsic,
  scanForBlockEvent,
  getGuardianAddress,
  getKeyring,
  getApi,
} from "../dist/index.js";

async function main() {
  // Optional: override endpoint via env
  if (process.env.PALLIORA_WS) {
    configure({ pallioraWs: process.env.PALLIORA_WS, debug: true });
  } else {
    configure({ debug: true });
  }

  // Verify keyring is reachable
  const keyring = await getKeyring();
  const signer = keyring.getPairs()[0];
  if (!signer) throw new Error("No signer account in keyring");
  console.log("Signer:", signer.address);

  // Fetch active guardians with their on-chain addresses
  const guardianEntries = await getGuardianAddress();
  if (!guardianEntries.length) throw new Error("No guardians available on-chain");
  console.log("Guardians:", guardianEntries);

  const selected = guardianEntries.slice(0, 3).map((g) => g.address);
  const model = "gemma3:12b";
  const payload = {
    model,
    messages: [
      { role: "user", content: "hola" },
      { role: "assistant", content: "¡Hola! ¿En qué puedo ayudarte hoy?" },
      { role: "user", content: "hehe you speak espanol" },
      {
        role: "assistant",
        content:
          "Sí, hablo español con suficiente fluidez para conversar y responder preguntas. Pero no sé si soy perfecto... ¿Quieres hablar un poco o necesitas ayuda con algo en particular?",
      },
      { role: "user", content: "noice" },
    ],
    stream: false,
  };

  // Submit a simple inference request
  const result = await inferenceCompute({
    input: JSON.stringify(payload),
    guardians: selected,
    fees: 0.2,
    deadline: 0,
  }, signer);

  console.log("Inference result:", result);
  console.log("Block:", result.blockNumber, "| Tx index:", result.index, "| Hash:", result.hash);

  if (result.agreementId) {
    console.log("Agreement ID:", result.agreementId);
  }

  const api = await getApi();
  if (!api) throw new Error("Api not initialized");

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

  const text = Buffer.from(args.contract.compute.input.Inline.data.slice(2), 'hex');
  const resultText = new TextDecoder().decode(text);
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
  console.error("Inference test failed:", err);
  process.exit(1);
});
