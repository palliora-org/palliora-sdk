import { getApi, signAndSend } from "../chain";
import { assert, debugLog } from "../utils";
import { OnChainRef } from "./types";
import type { KeyringPair } from "@polkadot/keyring/types";

export async function runAgent(
  account: KeyringPair,
  agentRef: OnChainRef,
  nonce: Uint8Array,
  ciphertext: Uint8Array,
  tdParams: Uint8Array,
  pkBytes: Uint8Array,
  tauParams: Uint8Array,
  baseModel: OnChainRef,
  publicKey: Uint8Array,
  guardians: Uint8Array[],
  guardian?: Uint8Array,
  agreementId?: Uint8Array,
) {
  const agentRefTuple = [agentRef.blockNumber, agentRef.index];
  const baseModelTuple = [baseModel.blockNumber, baseModel.index];

  const api = await getApi();
  assert(api, "Failed to get API connection");

  const request = api.tx.dataAvailability.daccRunAgent(
    agentRefTuple,
    Array.from(nonce),
    Array.from(ciphertext),
    guardian ? Array.from(guardian) : null,
    Array.from(tdParams),
    Array.from(pkBytes),
    Array.from(tauParams),
    baseModelTuple,
    Array.from(publicKey),
    guardians.map((g) => Array.from(g)),
  );

  const opts = {
    compute: {
      da_type: 4,
      verification: 0,
      compute: 1,
      agreement: [agreementId]
    }
  };
  const hash = await signAndSend(request, account, opts);

  debugLog(`Run agent transaction sent with hash: ${hash.hash}`);

  return hash;
}
