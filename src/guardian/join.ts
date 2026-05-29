import { getApi, signAndSend } from "../chain";
import { assert, debugLog } from "../utils";
import { formatPaliAmount } from "../utils/token";
import type { KeyringPair } from "@polkadot/keyring/types";

export interface GuardianJoinPrefs {
  compute?: string;
  fee?: bigint | string | number;
  standard?: boolean;
  verifier?: boolean;
}

export async function joinGuardian(account: KeyringPair, prefs: GuardianJoinPrefs) {
  const api = await getApi();

  assert(api, "API not initialized");
  assert(account, "Account not initialized");

  const computeOpts =
    (prefs.compute as string | undefined)
      ?.split(",")
      .map((s) => s.trim())
      .filter((s) => s.length > 0) || undefined;

  const feeThreshold =
    typeof prefs.fee === "bigint" ? prefs.fee : BigInt(prefs.fee || "0");

  const guardianPrefs = {
    pubKey: account.publicKey,
    guardian: prefs.standard,
    verifier: prefs.verifier,
    compute: prefs.compute ? true : false,
    computePrefs: {
      trusted: computeOpts?.includes("trusted") || false,
      tee: computeOpts?.includes("tee") || false,
      mpc: computeOpts?.includes("mpc") || false,
      fhe: computeOpts?.includes("fhe") || false,
      zkp: computeOpts?.includes("zkp") || false,
    },
    feeThreshold,
  };

  debugLog(
    account.address,
    "joining as guardian with preferences:",
    { ...guardianPrefs, feeThreshold: formatPaliAmount(feeThreshold) }
  );

  const guardTx = api.tx.staking.guard(guardianPrefs);
  const hash = await signAndSend(guardTx, account);

  debugLog("Guardian join tx sent with hash:", hash.hash);
}
