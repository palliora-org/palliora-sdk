import { DEFAULT_EMPTY_PAYLOAD, getApi, signAndSend } from "../chain";
import { encrypt, gen_stretched_key, testCrypt } from "../crypto";
import {
  assert,
  debugLog,
  Hex,
  hexToUint8Array,
  uint8ArrayToBase64,
} from "../utils";
import { OnChainRef, SubmitTEDataResult } from "./types";
import type { KeyringPair } from "@polkadot/keyring/types";

export async function submitData(account: KeyringPair, data: string) {
  const api = await getApi();

  assert(api, "API not initialized");

  debugLog(`\nSubmitting data with content length: ${data.length}`);

  const tx = api.tx.dataAvailability.submitData(data);
  const hash = await signAndSend(tx, account, DEFAULT_EMPTY_PAYLOAD);

  debugLog(`Data availability transaction sent with hash: ${hash.hash}`);
}

export async function submitTEData(
  account: KeyringPair,
  data: string,
  chosenGuardians: string[],
  tau_params: string,
  agg_key: string,
  group_pk: string,
): Promise<OnChainRef> {
  const { encoded: encryptedKey, ikm } = testCrypt(tau_params, agg_key);
  const td_params = uint8ArrayToBase64(hexToUint8Array(encryptedKey as Hex));
  const shared_key = gen_stretched_key(hexToUint8Array(ikm as Hex));

  const encoder = new TextEncoder();
  const dataUint8Array = encoder.encode(data);
  const { ciphertext, nonce } = encrypt(dataUint8Array, shared_key);

  const modelSubmit = JSON.stringify({
    nonce: uint8ArrayToBase64(nonce),
    ciphertext: uint8ArrayToBase64(ciphertext),
    td_params,
    group_pk: Array.from(new Uint8Array(hexToUint8Array(group_pk as Hex))),
    tau_params: Array.from(new Uint8Array(hexToUint8Array(tau_params as Hex))),
    chosen_guardians: chosenGuardians,
  });

  const api = await getApi();
  assert(api, "Failed to get API connection");

  const request = await api.tx.dataAvailability.submitData(modelSubmit);
  const hash = await signAndSend(request, account, DEFAULT_EMPTY_PAYLOAD);

  debugLog(`TE data availability transaction sent with hash: ${hash.hash}`);

  return hash;
}

/**
 * Identical to submitTEData but additionally returns the populated CipherSuite
 * so callers can pass it directly to registerDataAgreement without
 * re-deriving the cipher parameters.
 */
export async function submitTEDataWithCipher(
  account: KeyringPair,
  data: string,
  chosenGuardians: string[],
  tau_params: string,
  agg_key: string,
  group_pk: string,
): Promise<SubmitTEDataResult> {
  const { encoded: encryptedKey, ikm } = testCrypt(tau_params, agg_key);
  const shared_key = gen_stretched_key(hexToUint8Array(ikm as Hex));

  const encoder = new TextEncoder();
  const dataUint8Array = encoder.encode(data);
  const { ciphertext, nonce } = encrypt(dataUint8Array, shared_key);

  const ciphertextHex =
    "0x" +
    Array.from(ciphertext)
      .map((b) => b.toString(16).padStart(2, "0"))
      .join("");

  const api = await getApi();
  assert(api, "Failed to get API connection");

  const request = await api.tx.dataAvailability.submitData(ciphertextHex);
  const ref = await signAndSend(request, account, DEFAULT_EMPTY_PAYLOAD);

  debugLog(`TE data availability transaction sent with hash: ${ref.hash}`);

  return {
    ref,
    cipher: {
      Encrypted: {
        threshold: {
          SilentThreshold: {
            td_params: Array.from(hexToUint8Array(encryptedKey as Hex)),
            pk_bytes: Array.from(hexToUint8Array(group_pk as Hex)),
            tau_params: Array.from(hexToUint8Array(tau_params as Hex)),
          },
        },
        symmetric: {
          ChaCha20Poly1305: { nonce: Array.from(nonce) },
        },
      },
    },
  };
}
