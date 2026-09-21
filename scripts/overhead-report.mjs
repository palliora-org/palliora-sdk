/**
 * overhead-report.mjs
 *
 * Builds and signs each extrinsic type locally without submitting to the chain.
 * Measures tx.toU8a().length (full SCALE-encoded signed extrinsic, no length prefix)
 * and writes a comparison table to extrinsic-overhead-report.log.
 *
 * Usage:
 *   node scripts/overhead-report.mjs
 *   PALLIORA_WS=ws://... node scripts/overhead-report.mjs
 */

import { writeFileSync } from "fs";
import {
  init,
  getApi,
  getKeyring,
  getEncKeyring,
  getGuardianAddress,
  createGuardianGroupAndWatch,
  testCrypt,
  encrypt,
  gen_stretched_key,
  hexToUint8Array,
  toAtomicPaliAmount,
  DEFAULT_EMPTY_PAYLOAD,
  DEFAULT_COMPUTE_PAYLOAD,
} from "../dist/index.js";

// ── Inference payload (same as test-inference.mjs) ──────────────────────────
const INFERENCE_PAYLOAD = JSON.stringify({
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
});

// Shorter invoke payload (same as test-encrypted-inference-session.mjs)
const INVOKE_PAYLOAD = JSON.stringify({
  model: "gemma3:12b",
  messages: [{ role: "user", content: "what is 2 + 2?" }],
  stream: false,
});

function stripHex(h) {
  return h.startsWith("0x") ? h.slice(2) : h;
}

function buildThresholdCipher(tdParams, pkBytes, tauParams, nonce) {
  return {
    ThresholdHybrid: {
      threshold_params: {
        SilentThreshold: {
          td_params: Array.from(tdParams),
          pk_bytes: Array.from(pkBytes),
          tau_params: Array.from(tauParams),
        },
      },
      symmetric_params: {
        ChaCha20Poly1305: { nonce: Array.from(nonce) },
      },
    },
  };
}

function buildAsymmetricCipher(recipientPubKey, nonce) {
  // nodePub constant from test-encrypted-inference.mjs
  const nodePub = new Uint8Array([
    59, 105, 230, 196, 8, 100, 70, 38, 130, 39, 111, 219, 186, 210, 57, 165,
    111, 140, 13, 131, 164, 215, 122, 37, 45, 249, 91, 214, 223, 246, 93, 208,
  ]);
  return {
    AsymmetricHybrid: {
      asymmetric_params: {
        Ed25519: {
          recipient_public_key: Array.from(recipientPubKey),
          ephemeral_public_key: Array.from(nodePub),
          kdf: "HkdfSha256",
          salt: null,
          info: null,
        },
      },
      symmetric_params: {
        ChaCha20Poly1305: { nonce: Array.from(nonce) },
      },
    },
  };
}

// Signs tx in place and returns its SCALE-encoded byte length.
// nonce=0 is fine since we never submit.
async function measure(api, tx, signer, computeExtension, header) {
  await tx.signAsync(signer, {
    nonce: 0,
    blockHash: header.hash,
    genesisHash: api.genesisHash,
    runtimeVersion: api.runtimeVersion,
    tip: 0,
    ...computeExtension,
  });
  return tx.toU8a().length;
}

// BLS12-381 G2 compressed point size (96 bytes) - expected size of agg_key / pk_bytes.
const BLS_G2_SIZE = 96;

/**
 * Encrypt a plaintext using testCrypt for the KEM step.
 * Falls back to synthetic data when the chain's agg_key is empty (no DKG run yet):
 *   - td_params: BLS_G2_SIZE-byte placeholder (expected BLS KEM ciphertext size)
 *   - symmetric encryption: still real (produces accurate ciphertext + AEAD tag size)
 * Returns { tdParams, ciphertext, nonce, synthetic } where synthetic=true flags the fallback.
 */
function encryptPayload(payloadBytes, tauParamsHex, aggKeyHex) {
  if (aggKeyHex.length > 0) {
    try {
      const { encoded: td, ikm } = testCrypt(tauParamsHex, aggKeyHex);
      const symKey = gen_stretched_key(hexToUint8Array(stripHex(ikm)));
      const { ciphertext, nonce } = encrypt(payloadBytes, symKey);
      const tdParams = hexToUint8Array(stripHex(td));
      return { tdParams, ciphertext, nonce, synthetic: false };
    } catch (e) {
      console.warn(`  [warn] testCrypt failed (${e.message}), using synthetic td_params`);
    }
  }

  // Fallback: synthetic td_params, real encryption with a random key.
  const tdParams = new Uint8Array(BLS_G2_SIZE); // G2-sized placeholder
  globalThis.crypto.getRandomValues(tdParams);
  const symKey = new Uint8Array(32);
  globalThis.crypto.getRandomValues(symKey);
  const { ciphertext, nonce } = encrypt(payloadBytes, symKey);
  return { tdParams, ciphertext, nonce, synthetic: true };
}

async function main() {
  init({
    pallioraWs: process.env.PALLIORA_WS ?? "wss://manas-rpc.palliora.org",
    debug: false,
  });

  const api = await getApi();
  if (!api) throw new Error("API not initialized");

  const keyring = await getKeyring();
  const encKeyring = await getEncKeyring();
  const signer = keyring.getPairs()[0];
  const encAccount = encKeyring.getPairs()[0];
  if (!signer) throw new Error("No signer in keyring");
  if (!encAccount) throw new Error("No encryption account in keyring");

  const guardianEntries = await getGuardianAddress();
  if (!guardianEntries.length) throw new Error("No guardians available on-chain");

  const g1 = guardianEntries.slice(0, 1).map((g) => g.address);
  const g3 = guardianEntries.slice(0, Math.min(3, guardianEntries.length)).map((g) => g.address);

  // Create a guardian group and watch for DKG output to get real-sized params.
  const groupInfo = await createGuardianGroupAndWatch(signer, g3, 18);
  const { aggKey: AGG_KEY, groupPk: GROUP_PK, tauParams: TAU_PARAMS } = groupInfo;
  const tauParamsBytes = hexToUint8Array(stripHex(TAU_PARAMS));
  const aggKeyBytes = hexToUint8Array(stripHex(AGG_KEY));
  const groupPkBytes = hexToUint8Array(stripHex(GROUP_PK));
  const tauParamsHex = stripHex(TAU_PARAMS);
  const aggKeyHex = stripHex(AGG_KEY);

  const header = await api.rpc.chain.getHeader();

  const inferenceBytes = new TextEncoder().encode(INFERENCE_PAYLOAD);
  const invokeBytes = new TextEncoder().encode(INVOKE_PAYLOAD);

  // Reusable compute extension opts
  const EXT_BASE = DEFAULT_COMPUTE_PAYLOAD; // { compute: { da_type: 0, verification: 0, compute: 0 } }
  const EXT_DA = DEFAULT_EMPTY_PAYLOAD;     // { compute: { da_type: 0, ..., agreement: [] } }
  const EXT_DORMANT = { compute: { da_type: 1, verification: 0, compute: 0 } };
  const EXT_ACTIVE = { compute: { da_type: 1, verification: 0, compute: 1 } };
  const EXT_SUBSCRIPTION = { compute: { da_type: 1, verification: 0, compute: 0 } };

  const rows = [];
  function record(label, size, meta = {}) {
    rows.push({ label, size, meta });
    console.log(`  ${String(size).padStart(6)} bytes  ${label}`);
  }

  console.log("\n[overhead-report] measuring extrinsic sizes (no submissions)\n");
  console.log(`  signer      : ${signer.address}`);
  console.log(`  guardians   : ${g3.join(", ")}`);
  console.log(`  tau_params  : ${tauParamsBytes.length} bytes  (live from chain)`);
  console.log(`  agg_key     : ${aggKeyBytes.length} bytes  (live from chain)`);
  console.log(`  prompt      : ${inferenceBytes.length} bytes\n`);

  // ── Base: token transfer ─────────────────────────────────────────────────
  {
    const tx = api.tx.balances.transferKeepAlive(signer.address, BigInt(1_000_000_000_000));
    record("Base: balances.transferKeepAlive", await measure(api, tx, signer, EXT_BASE, header));
  }

  // ── 1. DA submitData ─────────────────────────────────────────────────────
  {
    const payload = "x".repeat(100);
    const tx = api.tx.dataAvailability.submitData(payload);
    record("1. dataAvailability.submitData", await measure(api, tx, signer, EXT_DA, header), {
      note: "100-byte payload",
    });
  }

  // ── 2a. Dormant - Inline ─────────────────────────────────────────────────
  {
    const data = Array.from(new TextEncoder().encode("x".repeat(100)));
    const tx = api.tx.compute.agreement(
      {
        contract_type: "Dormant",
        guardians: g1,
        pre_check: null,
        compute: {
          cipher: "Plaintext",
          computer_indices: g1.map((_, i) => i),
          fees: toAtomicPaliAmount("0"),
          compute_rate: toAtomicPaliAmount("0"),
          deadline: 0,
          confidentiality: { Trusted: 0 },
          fee_function: null,
          program_env: null,
          input: { Inline: { data } },
          program: { NativeData: "DaFalse" },
          metadata: null,
        },
        post_check: null,
        result_cipher: "Plaintext",
      },
      null,
    );
    record("2a. Dormant compute.agreement - Inline input", await measure(api, tx, signer, EXT_DORMANT, header), {
      note: "100-byte inline data, 1 guardian",
    });
  }

  // ── 2b. Dormant - URL ────────────────────────────────────────────────────
  {
    const url = "https://storage.example.com/data/payload.json";
    const tx = api.tx.compute.agreement(
      {
        contract_type: "Dormant",
        guardians: g1,
        pre_check: null,
        compute: {
          cipher: "Plaintext",
          computer_indices: g1.map((_, i) => i),
          fees: toAtomicPaliAmount("0"),
          compute_rate: toAtomicPaliAmount("0"),
          deadline: 0,
          confidentiality: { Trusted: 0 },
          fee_function: null,
          program_env: null,
          input: { Url: { url: Array.from(new TextEncoder().encode(url)) } },
          program: { NativeData: "DaFalse" },
          metadata: null,
        },
        post_check: null,
        result_cipher: "Plaintext",
      },
      null,
    );
    record("2b. Dormant compute.agreement - URL input", await measure(api, tx, signer, EXT_DORMANT, header), {
      note: `${url.length}-char URL, 1 guardian`,
    });
  }

  // ── 3. Unencrypted inference ─────────────────────────────────────────────
  {
    const tx = api.tx.compute.agreement(
      {
        contract_type: "Active",
        guardians: g1,
        pre_check: null,
        compute: {
          cipher: "Plaintext",
          computer_indices: g1.map((_, i) => i),
          fees: toAtomicPaliAmount("0.05"),
          compute_rate: toAtomicPaliAmount("0.00002"),
          deadline: 0,
          confidentiality: { Trusted: 0 },
          fee_function: null,
          program_env: null,
          input: { Inline: { data: Array.from(inferenceBytes) } },
          program: { NativeExecute: "Inference" },
          metadata: null,
        },
        post_check: null,
        result_cipher: "Plaintext",
      },
      null,
    );
    record("3. Unencrypted inference compute.agreement (Active)", await measure(api, tx, signer, EXT_ACTIVE, header), {
      note: `${inferenceBytes.length}-byte prompt, 1 guardian`,
    });
  }

  // ── 4. Encrypted inference ───────────────────────────────────────────────
  let encTdParamsSize, encCiphertextSize, encSynthetic;
  {
    const { tdParams, ciphertext, nonce, synthetic } = encryptPayload(inferenceBytes, tauParamsHex, aggKeyHex);
    encTdParamsSize = tdParams.length;
    encCiphertextSize = ciphertext.length;
    encSynthetic = synthetic;

    const resultNonce = new Uint8Array(12);
    globalThis.crypto.getRandomValues(resultNonce);

    const inputCipher = buildThresholdCipher(tdParams, groupPkBytes, tauParamsBytes, nonce);
    const resultCipher = buildAsymmetricCipher(encAccount.publicKey, resultNonce);

    const tx = api.tx.compute.agreement(
      {
        contract_type: "Active",
        guardians: g3,
        pre_check: null,
        compute: {
          cipher: inputCipher,
          computer_indices: g3.map((_, i) => i),
          fees: toAtomicPaliAmount("0.51"),
          compute_rate: toAtomicPaliAmount("0.00001"),
          deadline: 0,
          confidentiality: { Trusted: 0 },
          fee_function: null,
          program_env: null,
          input: { Inline: { data: Array.from(ciphertext) } },
          program: { NativeExecute: "Inference" },
          metadata: null,
        },
        post_check: null,
        result_cipher: resultCipher,
      },
      null,
    );
    const tdNote = encSynthetic ? `td_params=${tdParams.length}b (synthetic G2 placeholder)` : `td_params=${tdParams.length}b`;
    record("4. Encrypted inference compute.agreement (Active, ThresholdHybrid)", await measure(api, tx, signer, EXT_ACTIVE, header), {
      note: `prompt=${inferenceBytes.length}b → enc=${ciphertext.length}b, ${tdNote}, tau=${tauParamsBytes.length}b, group_pk=${groupPkBytes.length}b, agg_key=${aggKeyBytes.length}b, 3 guardians`,
    });
  }

  // ── 5. Simple compute: DA submit + compute.agreement ────────────────────
  {
    const inputPayload = JSON.stringify("ujjwal");
    const daTx = api.tx.dataAvailability.submitData(inputPayload);
    const daSize = await measure(api, daTx, signer, EXT_DA, header);

    const programUrl = "ujjwalpal/hello-world:test";
    const computeTx = api.tx.compute.agreement(
      {
        contract_type: "Active",
        guardians: g1,
        pre_check: null,
        compute: {
          cipher: "Plaintext",
          computer_indices: g1.map((_, i) => i),
          fees: toAtomicPaliAmount("2"),
          compute_rate: toAtomicPaliAmount("0.00001"),
          deadline: 0,
          confidentiality: { Trusted: 0 },
          fee_function: null,
          program_env: null,
          input: null,
          program: { Url: { url: Array.from(new TextEncoder().encode(programUrl)) } },
          metadata: null,
        },
        post_check: null,
        result_cipher: "Plaintext",
      },
      null,
    );
    const agreementSize = await measure(api, computeTx, signer, EXT_ACTIVE, header);

    record("5a. Simple compute - dataAvailability.submitData (input data)", daSize, {
      note: `${inputPayload.length}-byte payload`,
    });
    record("5b. Simple compute - compute.agreement (URL program, null input)", agreementSize, {
      note: `url="${programUrl}" (${programUrl.length}b), 1 guardian`,
    });
    record("5.  Simple compute - combined (5a + 5b)", daSize + agreementSize);
  }

  // ── 6a. Subscription - agreement ────────────────────────────────────────
  let subAgreementSize;
  {
    const { tdParams, ciphertext, nonce, synthetic: subSynthetic } = encryptPayload(inferenceBytes, tauParamsHex, aggKeyHex);
    const resultNonce = new Uint8Array(12);
    globalThis.crypto.getRandomValues(resultNonce);

    const inputCipher = buildThresholdCipher(tdParams, groupPkBytes, tauParamsBytes, nonce);
    const resultCipher = buildAsymmetricCipher(encAccount.publicKey, resultNonce);

    const tx = api.tx.compute.agreement(
      {
        contract_type: "Subscription",
        guardians: g3,
        pre_check: null,
        compute: {
          cipher: inputCipher,
          computer_indices: g3.map((_, i) => i),
          fees: toAtomicPaliAmount("1.21"),
          compute_rate: toAtomicPaliAmount("0.00001"),
          deadline: 0,
          confidentiality: { Trusted: 0 },
          fee_function: null,
          program_env: null,
          input: { Inline: { data: Array.from(ciphertext) } },
          program: { NativeExecute: "Inference" },
          metadata: null,
        },
        post_check: null,
        result_cipher: resultCipher,
      },
      null,
    );
    subAgreementSize = await measure(api, tx, signer, EXT_SUBSCRIPTION, header);
    const subTdNote = subSynthetic ? `td_params=${tdParams.length}b (synthetic)` : `td_params=${tdParams.length}b`;
    record("6a. Subscription - compute.agreement", subAgreementSize, {
      note: `prompt=${inferenceBytes.length}b → enc=${ciphertext.length}b, ${subTdNote}, tau=${tauParamsBytes.length}b, group_pk=${groupPkBytes.length}b, agg_key=${aggKeyBytes.length}b, 3 guardians`,
    });
  }

  // ── 6b. Subscription - invoke ────────────────────────────────────────────
  {
    const { tdParams, ciphertext, nonce, synthetic } = encryptPayload(invokeBytes, tauParamsHex, aggKeyHex);

    const invokeCipher = buildThresholdCipher(tdParams, groupPkBytes, tauParamsBytes, nonce);
    const placeholderAgreementId = Array.from(new Uint8Array(32));

    const tx = api.tx["compute"]["invoke"](
      placeholderAgreementId,
      g3,
      invokeCipher,
      { Inline: { data: Array.from(ciphertext) } },
    );
    const invokeSize = await measure(api, tx, signer, EXT_BASE, header);

    record("6b. Subscription - compute.invoke", invokeSize, {
      note: `payload=${invokeBytes.length}b → enc=${ciphertext.length}b, td_params=${tdParams.length}b${synthetic ? " (synthetic)" : ""}, tau=${tauParamsBytes.length}b, group_pk=${groupPkBytes.length}b, agg_key=${aggKeyBytes.length}b, 3 guardians`,
    });
    record("6.  Subscription - combined (6a + 6b)", subAgreementSize + invokeSize);
  }

  // ── Write report ─────────────────────────────────────────────────────────
  const baseSize = rows[0].size;

  const lines = [
    "# Palliora Extrinsic Overhead Report",
    ``,
    `| | |`,
    `|---|---|`,
    `| **Generated** | ${new Date().toISOString()} |`,
    `| **Signer** | \`${signer.address}\` |`,
    `| **Guardians** | ${g3.map((g) => `\`${g}\``).join(", ")} |`,
    ``,
    "## Guardian Network Params",
    ``,
    `| Parameter | Size |`,
    `|---|---|`,
    `| tau_params (KZG) | ${tauParamsBytes.length} bytes |`,
    `| group_pk (BLS G1) | ${groupPkBytes.length} bytes |`,
    `| agg_key | ${aggKeyBytes.length} bytes |`,
    `| td_params (BLS KEM ciphertext) | ${encTdParamsSize} bytes _(${encSynthetic ? "synthetic G2 placeholder — agg_key empty on chain" : "from testCrypt on live params"})_ |`,
    ``,
    "## Payload Sizes",
    ``,
    `| | |`,
    `|---|---|`,
    `| Inference prompt | ${inferenceBytes.length} bytes |`,
    `| Encrypted prompt | ${encCiphertextSize} bytes _(ChaCha20Poly1305, +16 byte AEAD tag)_ |`,
    ``,
    "> `Size` = `tx.toU8a().length` — full SCALE-encoded signed extrinsic body.",
    "> On the wire, add 2 bytes for the compact-encoded length prefix.",
    "> Nonce fixed at 0; mortal era. No transactions submitted.",
    ``,
    "## Extrinsic Sizes",
    ``,
    `| Operation | Bytes | vs base | Notes |`,
    `|---|---:|---:|---|`,
    ...rows.map(({ label, size, meta }) => {
      const overhead = size - baseSize;
      const overheadStr = label.startsWith("Base") ? "—" : `+${overhead}`;
      const note = meta.note ?? "";
      return `| ${label} | ${size} | ${overheadStr} | ${note} |`;
    }),
    ``,
    "## Prerequisites",
    ``,
    `_Not included in sizes above:_`,
    ``,
    `- **4. Encrypted inference** — 1 x \`daccGuardianGroup\` (user) + 1 x \`daccGuardianGroupInfo\` (guardian)`,
    `- **6. Subscription (agreement)** — same guardian group prerequisite as #4`,
  ];

  const report = lines.join("\n");
  const outPath = new URL("../extrinsic-overhead-report.md", import.meta.url).pathname;
  writeFileSync(outPath, report + "\n");
  console.log(`\n${report}\n`);
  console.log(`Report written to: ${outPath}`);
  process.exit(0);
}

main().catch((err) => {
  console.error("overhead-report failed:", err);
  process.exit(1);
});
