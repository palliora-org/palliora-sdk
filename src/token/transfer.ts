import { getApi, signAndSend } from "../chain";
import { assert, debugLog } from "../utils";
import { formatPaliAmount } from "../utils/token";
import type { KeyringPair } from "@polkadot/keyring/types";

export async function transfer(account: KeyringPair, amountBaseUnits: bigint, address: string) {
  const api = await getApi();

  assert(api, "API not initialized");

  debugLog(`\nTransferring funds to account: ${address} with amount: ${formatPaliAmount(amountBaseUnits)}`);

  const tx = api.tx.balances.transferKeepAlive(address, amountBaseUnits);
  const hash = await signAndSend(tx, account);

  debugLog(`Transfer transaction sent with hash: ${hash.hash}`);
}
