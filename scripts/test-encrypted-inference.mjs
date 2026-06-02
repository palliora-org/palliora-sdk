/**
 * test-encrypted-inference.mjs
 *
 * Submits an inference compute request where the payload is threshold-encrypted
 * before being sent inline (DAInput::Inline) on-chain.
 *
 * Encryption flow (mirrors testChat.ts):
 *   1. testCrypt(tauParams, aggKey)  →  { encoded: cyphtxt, ikm }
 *      `cyphtxt` is the BLS12-381 silent-threshold wrapper around the session key.
 *      `ikm`     is the raw session key material.
 *   2. gen_stretched_key(ikm)        →  symmetric key (ChaCha20Poly1305)
 *   3. encrypt(payload, symKey)      →  { ciphertext, nonce }
 *   4. `ciphertext` bytes become the DAInput::Inline payload.
 *   5. The cipher suite (SilentThreshold + ChaCha20Poly1305) is recorded in the
 *      contract's `cipher` field so guardians know how to unwrap the session key.
 *   6. A second testCrypt call derives an independent session key for result_cipher
 *      so the encrypted result can be decrypted locally.
 *
 * The guardian group is created automatically via createGuardianGroupAndWatch,
 * which populates AGG_KEY, GROUP_PK, TAU_PARAMS, and selectedGuardians from
 * the on-chain DaccGuardianGroup event.
 *
 * Optional environment variables:
 *   PALLIORA_WS         – WebSocket endpoint (falls back to SDK default)
 */

import {
  configure,
  getKeyring,
  getGuardianAddress,
  createAgreement,
  createGuardianGroupAndWatch,
  testCrypt,
  encrypt,
  gen_stretched_key,
  hexToUint8Array,
  toAtomicPaliAmount,
} from "../dist/index.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Strip an optional 0x prefix from a hex string. */
function stripHex(h) {
  return h.startsWith("0x") ? h.slice(2) : h;
}

/**
 * Build a CipherSuiteEncrypted object for the on-chain Contract type given the
 * output of a testCrypt call and the 12-byte ChaCha20Poly1305 nonce.
 */
function buildEncryptedCipher(cyphtxtHex, groupPkHex, tauParamsHex, nonce) {
  return {
    Encrypted: {
      threshold: {
        SilentThreshold: {
          td_params: Array.from(hexToUint8Array(stripHex(cyphtxtHex))),
          pk_bytes: Array.from(hexToUint8Array(stripHex(groupPkHex))),
          tau_params: Array.from(hexToUint8Array(stripHex(tauParamsHex))),
        },
      },
      symmetric: {
        ChaCha20Poly1305: { nonce: Array.from(nonce) },
      },
    },
  };
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  // --- 1. Resolve signer ---------------------------------------------------
  const keyring = await getKeyring();
  const account = keyring.getPairs()[0];
  if (!account) throw new Error("No signer account in keyring");
  console.log("Signer:", account.address);

  // --- 2. Create guardian group and retrieve group parameters --------------
  const selectedGuardians = (await getGuardianAddress()).slice(0, 3);
  if (selectedGuardians.length < 3) throw new Error("Need at least 3 guardians available on-chain");

  const groupInfo = await createGuardianGroupAndWatch(account, selectedGuardians, 8);
  const { aggKey: AGG_KEY, groupPk: GROUP_PK, tauParams: TAU_PARAMS, guardians } = groupInfo;
  console.log("Group created:", groupInfo);

  // --- 4. Build the inference payload to encrypt ----------------------------
  const inferencePayload = {
    model: "gemma3:12b",
    messages: [
      { role: "user", content: "hola" },
      { role: "assistant", content: "¡Hola! ¿En qué puedo ayudarte hoy?" },
      { role: "user", content: "hehe you speak espanol" },
      {
        role: "assistant",
        content:
          "Sí, hablo español con suficiente fluidez para conversar y responder preguntas. " +
          "Pero no sé si soy perfecto... ¿Quieres hablar un poco o necesitas ayuda con algo en particular?",
      },
      { role: "user", content: "noice" },
    ],
    stream: false,
  };

  const payloadBytes = new TextEncoder().encode(JSON.stringify(inferencePayload));

  // --- 5. Threshold-encrypt the input payload -------------------------------
  // testCrypt runs the BLS12-381 silent-threshold KEM and returns:
  //   encoded – the threshold ciphertext wrapping the session key (hex)
  //   ikm     – the raw session key material (hex)
  const { encoded: inputCyphtxt, ikm: inputIkm } = testCrypt(
    stripHex(TAU_PARAMS),
    stripHex(AGG_KEY),
  );

  const inputSymKey = gen_stretched_key(hexToUint8Array(stripHex(inputIkm)));
  const { ciphertext: inputCiphertext, nonce: inputNonce } = encrypt(
    payloadBytes,
    inputSymKey,
  );

  console.log("\n[Input encryption]");
  console.log("  IKM (hex):", inputIkm);
  console.log("  Symmetric key (hex):", Buffer.from(inputSymKey).toString("hex"));
  console.log("  Nonce (hex):", Buffer.from(inputNonce).toString("hex"));
  console.log("  Ciphertext length:", inputCiphertext.length, "bytes");

  // --- 6. Derive an independent session key for the result cipher -----------
  // A fresh testCrypt call produces a new enc_key so the result can be
  // decrypted independently of the input session key.
  const { encoded: resultCyphtxt, ikm: resultIkm } = testCrypt(
    stripHex(TAU_PARAMS),
    stripHex(AGG_KEY),
  );

  // Generate a random 12-byte nonce that the node will use when encrypting
  // the result back to us; we store it here so we can decrypt later.
  const resultNonce = new Uint8Array(12);
  globalThis.crypto.getRandomValues(resultNonce);

  const resultSymKey = gen_stretched_key(hexToUint8Array(stripHex(resultIkm)));

  console.log("\n[Result decryption material – keep these to decrypt the response]");
  console.log("  Result IKM (hex):", resultIkm);
  console.log("  Result nonce (hex):", Buffer.from(resultNonce).toString("hex"));
  console.log("  (use gen_stretched_key + decrypt with ChaCha20Poly1305)");

  // --- 7. Build the on-chain Contract ---------------------------------------
  const inputCipher = buildEncryptedCipher(
    inputCyphtxt,
    GROUP_PK,
    TAU_PARAMS,
    inputNonce,
  );

  const computeStep = {
    cipher: inputCipher,
    computer_indices: selectedGuardians.map((_, i) => i),
    fees: toAtomicPaliAmount("0.21"), // 0.21 PALI
    deadline: 0,
    confidentiality: { Trusted: { trust_index: 0 } },
    fee_function: null,
    program_env: null,
    // Encrypted payload delivered inline — DAInput::Inline
    input: { Inline: { data: Array.from(inputCiphertext) } },
    program: { NativeExecute: "Inference" },
    metadata: null,
  };

  const contract = {
    contract_type: "Active",
    guardians: selectedGuardians,
    pre_check: null,
    compute: computeStep,
    post_check: null,
    result_cipher: "Plaintext",
  };

  // --- 8. Submit and report -------------------------------------------------
  console.log("\nSubmitting encrypted inference agreement...");
  const result = await createAgreement(contract, account);

  console.log("\n[Transaction submitted]");
  console.log("  Block:", result.blockNumber);
  console.log("  Tx index:", result.index);
  console.log("  Hash:", result.hash);
  if (result.agreementId) {
    console.log("  Agreement ID:", result.agreementId);
  }

  process.exit(0);
}

main().catch((err) => {
  console.error("Encrypted inference test failed:", err);
  process.exit(1);
});
