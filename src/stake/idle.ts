import { getApi, signAndSend } from "../chain";
import { assert, debugLog } from "../utils";
import type { KeyringPair } from "@polkadot/keyring/types";

export async function joinIdleStaker(account: KeyringPair) {
  const api = await getApi();

  assert(api, "API not initialized");
  assert(account, "Account not initialized");

  const chillTx = api.tx.staking.chill();
  const hash = await signAndSend(chillTx, account);

  debugLog("Idle staker chill tx sent with hash:", hash.hash);
}
