import { getApi, signAndSend } from "../chain";
import { assert, debugLog } from "../utils";
import { formatPaliAmount } from "../utils/token";
import type { KeyringPair } from "@polkadot/keyring/types";

/** Classes of compute a guardian can declare a fee threshold against. */
export const COMPUTE_TYPES = ["trusted", "tee", "mpc", "fhe", "zkp"] as const;

export type ComputeType = (typeof COMPUTE_TYPES)[number];

/** A rate in atomic units, already converted from PALI by the caller. */
export type FeeThresholdInput = bigint | string | number;

const CHAIN_COMPUTE_TYPE: Record<ComputeType, string> = {
  trusted: "Trusted",
  tee: "Tee",
  mpc: "Mpc",
  fhe: "Fhe",
  zkp: "Zkp",
};

export interface GuardianJoinPrefs {
  compute?: string;
  /**
   * Minimum rate to take work on at, in atomic units. A single amount applies to every
   * compute type named in `compute`; a per-type record prices each one separately.
   * Compute types left unpriced carry no threshold on chain, which reads as zero — the
   * guardian accepts any rate for them.
   */
  fee?: FeeThresholdInput | Partial<Record<ComputeType, FeeThresholdInput>>;
  standard?: boolean;
  verifier?: boolean;
}

function parseComputeTypes(compute: string | undefined): ComputeType[] {
  const requested = (compute || "")
    .split(",")
    .map((s) => s.trim())
    .filter((s) => s.length > 0);

  // Filtering the canonical list drops duplicates, which `staking.guard` rejects.
  return COMPUTE_TYPES.filter((type) => requested.includes(type));
}

function buildFeeThresholds(
  fee: GuardianJoinPrefs["fee"],
  computeTypes: ComputeType[],
): [string, bigint][] {
  if (fee === undefined || fee === null || fee === "") {
    return [];
  }

  if (typeof fee !== "object") {
    assert(
      computeTypes.length > 0,
      "A single fee threshold needs compute preferences to apply to. Set compute preferences, or declare thresholds per compute type.",
    );
    return computeTypes.map((type) => [CHAIN_COMPUTE_TYPE[type], BigInt(fee)]);
  }

  return Object.entries(fee).map(([type, amount]) => {
    assert(
      (COMPUTE_TYPES as readonly string[]).includes(type),
      `Unknown compute type "${type}" in fee thresholds. Allowed: ${COMPUTE_TYPES.join(", ")}`,
    );
    assert(
      computeTypes.includes(type as ComputeType),
      `Fee threshold declared for "${type}", which is not among the compute preferences (${computeTypes.join(", ") || "none"})`,
    );
    return [CHAIN_COMPUTE_TYPE[type as ComputeType], BigInt(amount as FeeThresholdInput)];
  });
}

export async function joinGuardian(account: KeyringPair, prefs: GuardianJoinPrefs) {
  const api = await getApi();

  assert(api, "API not initialized");
  assert(account, "Account not initialized");

  const computeTypes = parseComputeTypes(prefs.compute);
  const feeThresholds = buildFeeThresholds(prefs.fee, computeTypes);

  const guardianPrefs = {
    pubKey: account.publicKey,
    guardian: prefs.standard,
    verifier: prefs.verifier,
    compute: prefs.compute ? true : false,
    computePrefs: {
      trusted: computeTypes.includes("trusted"),
      tee: computeTypes.includes("tee"),
      mpc: computeTypes.includes("mpc"),
      fhe: computeTypes.includes("fhe"),
      zkp: computeTypes.includes("zkp"),
    },
    feeThresholds,
  };

  debugLog(
    account.address,
    "joining as guardian with preferences:",
    {
      ...guardianPrefs,
      feeThresholds: feeThresholds.map(
        ([type, threshold]) => `${type}: ${formatPaliAmount(threshold)}`,
      ),
    }
  );

  const guardTx = api.tx.staking.guard(guardianPrefs);
  const hash = await signAndSend(guardTx, account);

  debugLog("Guardian join tx sent with hash:", hash.hash);
}
