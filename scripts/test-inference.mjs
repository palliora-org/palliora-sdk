import bs58 from "bs58";
import { configure, inferenceCompute, getGuardianAddress, getKeyring } from "../dist/index.js";

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

  const selected = guardianEntries.slice(0, 3);
  const guardianAddresses = selected.map((g) => g.address);
  const agreement = selected.map((g) => bs58.decode(g.peerid).subarray(6));
  const model = "llama3.2:latest";
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
    guardians: guardianAddresses,
    fees: 0,
    deadline: 0,
    opts: { compute: { da_type: 1, agreement, verification: 0, compute: 1 } },
  });

  console.log("Inference result:", result);
  console.log("Block:", result.blockNumber, "| Tx index:", result.index, "| Hash:", result.hash);

  if (result.agreementId) {
    console.log("Agreement ID:", result.agreementId);
  }

  process.exit(0);
}

main().catch((err) => {
  console.error("Inference test failed:", err);
  process.exit(1);
});
