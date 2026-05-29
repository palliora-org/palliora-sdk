import { getApi, signAndSend } from "../chain";
import { assert, debugLog } from "../utils";
import type { KeyringPair } from "@polkadot/keyring/types";

export async function joinValidator(account: KeyringPair, commission: number) {
  const api = await getApi();

  assert(api, "API not initialized");
  assert(account, "Account not initialized");

  const validateTx = api.tx.staking.validate({commission, blocked: true});
  const hash = await signAndSend(validateTx, account);

  debugLog("Validator join tx sent with hash:", hash.hash);
}
