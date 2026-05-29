import { getApi, signAndSend } from "../chain";
import { assert, debugLog } from "../utils";
import type { KeyringPair } from "@polkadot/keyring/types";

export async function withdrawStake(account: KeyringPair) {
  const api = await getApi();

  assert(api, "API not initialized");
  assert(account, "Account not initialized");

  const unstakeTx = api.tx.staking.withdrawUnbonded(0);
  const hash = await signAndSend(unstakeTx, account);

  debugLog(`Unstake transaction sent with hash: ${hash.hash}`);
}
