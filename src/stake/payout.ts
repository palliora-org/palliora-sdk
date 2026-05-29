import { getApi, signAndSend } from "../chain";
import { assert, debugLog } from "../utils";
import type { KeyringPair } from "@polkadot/keyring/types";

export async function payoutStake(account: KeyringPair, eras: Array<number>, address?: string) {
  const api = await getApi();

  assert(api, "API not initialized");
  assert(account, "Account not initialized");

  for (const era of eras) {
    debugLog("Paying account: ", address || account.address, " for era ", era);
  }

  const unstakeTxs = eras.map((era) =>
    api.tx.staking.payoutStakers(address || account.address, era)
  );
  const batchTx = api.tx.utility.batch(unstakeTxs);
  const hash = await signAndSend(batchTx, account);

  debugLog(`Batch payout transaction sent with hash: ${hash.hash}`);
}
