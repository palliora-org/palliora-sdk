import { getApi, signAndSend } from "../chain";
import { assert, debugLog } from "../utils";
import { formatPaliAmount } from "../utils/token";
import type { KeyringPair } from "@polkadot/keyring/types";

export async function newStake(
  account: KeyringPair,
  amountBaseUnits: bigint,
  rewardDestination: string = "Staked"
) {
  const api = await getApi();

  assert(api, "API not initialized");
  assert(account, "Account not initialized");

  debugLog(
    `Staking amount: ${formatPaliAmount(amountBaseUnits)} for account: ${account.address} with reward destination: ${rewardDestination}`
  );

  const stakeTx = api.tx.staking.bond(amountBaseUnits, rewardDestination);
  const hash = await signAndSend(stakeTx, account);

  debugLog(`Stake transaction sent with hash: ${hash.hash}`);
}
