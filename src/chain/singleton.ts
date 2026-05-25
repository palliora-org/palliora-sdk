/**
 * Module providing singleton access to Polkadot API, WebSocket provider, and keyring.
 *
 * This module ensures that only one instance of the WsProvider, ApiPromise and Keyring
 * are created and reused across the application. It exposes a class-based wrapper
 * (RpcApi) for managed connect/disconnect flows and convenience functions for directly
 * obtaining the singleton instances.
 *
 * Notes:
 * - The API is created with custom RPC, types and signed extensions provided by
 *   {@link API_RPC}, {@link API_TYPES} and {@link API_EXTENSIONS}.
 * - In non-test environments, the module attaches fatal handlers to the API that call
 *   `process.exit(0)` on error/disconnect to allow an external supervisor to restart
 *   the process.
 * - The keyring is created for `sr25519` keys. The convenience getter populates a
 *   default development account derived from the well-known dev URI `//Bob`
 *   (named "Bob default"). This is a development-only seed and MUST NOT be used
 *   in production.
 */
import { ApiPromise, Keyring, WsProvider } from "@polkadot/api";
import { API_EXTENSIONS, API_RPC, API_TYPES } from "./spec";
import { provider } from "./wsProvider";
import { waitReady } from "@polkadot/wasm-crypto";

// Create singleton instances
let wsProvider: WsProvider | null = null;
let api: ApiPromise | null = null;
let keyring: Keyring | null = null;
// Separate keyring instance intended for encryption-related keys/usages.
let encKeyring: Keyring | null = null;
let apiListenersAttached = false;
let apiTeardownInProgress = false;

/**
 * getApi()
 *
 * Returns the singleton {@link ApiPromise} instance, creating it if necessary.
 *
 * @remarks
 * - If no underlying `provider` is configured (the module-level `provider`
 *   imported from "./wsProvider"), this function returns `undefined`.
 * - When creating the API, the configured `rpc`, `types` and `signedExtensions`
 *   are applied.
 * - In non-test environments, top-level API `error` and `disconnected` events
 *   cause the process to exit so that an external supervisor can restart the
 *   process.
 *
 * @param cb - Optional callback function to attach to the "disconnected" event.
 *
 * @returns The singleton {@link ApiPromise} instance (or `undefined` if no provider).
 */
export async function getApi(cb?: () => void) {
  if (!provider) return;

  if (!api) {
    api = await ApiPromise.create({
      provider,
      rpc: API_RPC,
      types: API_TYPES,
      signedExtensions: API_EXTENSIONS,
    });
  }
  const isNode = typeof process !== "undefined" && typeof process.exit === "function";
  const isTest = typeof process !== "undefined" && process.env?.NODE_ENV === "test";
  if (isNode && !isTest && api && !apiListenersAttached) {
    apiListenersAttached = true;
    api.on("error", (err) => {
      if (apiTeardownInProgress) return;
      apiTeardownInProgress = true;
      apiListenersAttached = false;

      const currentApi = api;
      api = null;

      void currentApi?.disconnect().catch((disconnectErr) => {
        apiTeardownInProgress = false;
        console.error("api disconnect after error failed:", disconnectErr);
      });
    });
    api.on("disconnected", () => {
      api = null;
      apiListenersAttached = false;
      apiTeardownInProgress = false;
      if (cb) cb();
    });
  }
  return api;
}

/**
 * getKeyring()
 *
 * Returns the singleton {@link Keyring} instance, creating it if necessary.
 *
 * @remarks
 * - Ensures {@link waitReady} has resolved before constructing the keyring so
 *   that WASM crypto is initialized.
 * - The keyring is created with `type: "sr25519"`.
 * - The function also adds a default development account from the dev seed URI
 *   `//Bob` and labels it "Bob default".
 *
 * @important
 * The seed URI `//Bob` is a well-known development seed. It is convenient for
 * local testing but is insecure for any real funds or production use. Replace
 * or remove this default account when deploying to production.
 *
 * @returns The singleton {@link Keyring} instance.
 */
export async function getKeyring() {
  if (!keyring) {
    await waitReady();
    keyring = new Keyring({ type: "sr25519" });
    keyring.addFromUri('//Bob', { name: 'Bob default' });
  }
  return keyring;
}

/**
 * getEncKeyring()
 *
 * Returns the singleton encryption-focused {@link Keyring} instance, creating it
 * if necessary.
 *
 * @remarks
 * - Ensures {@link waitReady} has resolved before constructing the keyring so
 *   that WASM crypto is initialized.
 * - The keyring is created with `type: "sr25519"` and a development default
 *   account derived from the dev seed URI `//Bob` is added and labeled
 *   "Bob default (enc)".
 *
 * @important
 * The seed URI `//Bob` is a well-known development seed and MUST NOT be used
 * in production for real funds. Replace or remove this default when deploying
 * to production.
 *
 * @returns The singleton {@link Keyring} instance used for encryption keys.
 */
export async function getEncKeyring() {
  if (!encKeyring) {
    await waitReady();
    encKeyring = new Keyring({ type: "ed25519" });
    encKeyring.addFromUri('//Bob', { name: 'Bob default (enc)' });
  }
  return encKeyring;
}
