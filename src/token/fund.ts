import { getApi, getKeyring, signAndSend } from "../chain";
import { assert, debugLog } from "../utils";
import { formatPaliAmount } from "../utils/token";

export async function fundAccount(account: any, amountBaseUnits: bigint, address?: string) {
  const addr = address ? address : account.address;
  const keyring = await getKeyring();
  const api = await getApi();

  assert(api, "API not initialized");

  debugLog(`\nFunding account: ${addr} with amount: ${formatPaliAmount(amountBaseUnits)}`);

  const tx = api.tx.balances.transferKeepAlive(addr, amountBaseUnits);
  const hash = await signAndSend(tx, keyring.getPairs()[0]);

  debugLog(`Fund transaction sent with hash: ${hash.hash}`);
}
