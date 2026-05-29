import { getApi, signAndSend } from "../chain";
import { assert, debugLog } from "../utils";
import { formatPaliAmount } from "../utils/token";
import type { KeyringPair } from "@polkadot/keyring/types";

export async function reduceStake(account: KeyringPair, amountBaseUnits: bigint) {
  const api = await getApi();

  assert(api, "API not initialized");
  assert(account, "Account not initialized");

  debugLog("Using account:", account.address, "reducing:", formatPaliAmount(amountBaseUnits));

  const unstakeTx = api.tx.staking.unbond(amountBaseUnits);
  const hash = await signAndSend(unstakeTx, account);

  debugLog(`Unstake transaction sent with hash: ${hash.hash}`);
}
