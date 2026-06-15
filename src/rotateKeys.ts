import { getApi, signAndSend } from "./chain";
import bs58 from 'bs58';
import { debugLog } from "./utils/helper";
import assert from "assert";
import type { KeyringPair } from "@polkadot/keyring/types";
import { provider } from "./config";

export async function rotateAndSetKeys(account: KeyringPair) {
  const api = await getApi();

  assert(api, "API not initialized");

  debugLog(`Rotating session keys for ${account.meta.name} on ${provider.endpoint}`);

  const newKeys = await api.rpc.author.rotateKeys();
  debugLog(`${account.meta.name} rotated keys on ${provider.endpoint}:`, newKeys?.toHex?.() ?? newKeys);

  const setKeysTx = api.tx.session.setKeys(newKeys, []);
  const hash = await signAndSend(setKeysTx, account);

  debugLog(`Rotate session transaction sent with hash: ${hash.hash}`);
}

export async function setWorker(account: KeyringPair) {
  const api = await getApi();

  assert(api, "API not initialized");

  const peerid = bs58.decode((await api.rpc.system.localPeerId()).toString());
  const setWorkerTx = api.tx.guardian.setWorker(peerid.slice(6, 38));
  const hash = await signAndSend(setWorkerTx, account);

  debugLog(`Set worker id transaction sent with hash: ${hash.hash}`);
}