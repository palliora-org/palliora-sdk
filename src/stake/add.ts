import { getApi, signAndSend } from "../chain";
import { assert, debugLog } from "../utils";
import { formatPaliAmount } from "../utils/token";

export async function addStake(account: any, amountBaseUnits: bigint) {
  const api = await getApi();

  assert(api, "API not initialized");
  assert(account, "Account not initialized");

  debugLog("Using account:", account.address, "adding:", formatPaliAmount(amountBaseUnits));

  const stakeTx = api.tx.staking.bondExtra(amountBaseUnits);
  const hash = await signAndSend(stakeTx, account);

  debugLog(`Stake transaction sent with hash: ${hash.hash}`);
}
