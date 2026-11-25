import { getApi, signAndSend } from "../chain";
import { assert, debugLog } from "../utils";
import type { KeyringPair } from "@polkadot/keyring/types";

/**
 * Whether `address` bonds, as its own controller, at least `staking.minGuardianBond` of
 * active stake: the stake `compute.registerResultSubmitter` requires (spec 34 and later).
 */
export async function hasResultSubmitterStake(address: string): Promise<boolean> {
  const api = await getApi();
  assert(api, "API not initialized");

  const [ledger, minBond] = await Promise.all([
    api.query.staking.ledger(address),
    api.query.staking.minGuardianBond(),
  ]);
  if (ledger.isEmpty) return false;
  const active = BigInt((ledger.toJSON() as { active: string | number }).active);
  return active >= BigInt(minBond.toString());
}

/**
 * Whether `address` may sign `compute.result`: Root put it in `compute.resultSubmitters`,
 * or (spec 34 and later) it is in `compute.stakedResultSubmitters` and still bonds enough.
 */
export async function isResultSubmitter(address: string): Promise<boolean> {
  const api = await getApi();
  assert(api, "API not initialized");

  const listed = (await api.query.compute.resultSubmitters()).toJSON() as string[];
  if (listed.includes(address)) return true;

  if (!api.query.compute.stakedResultSubmitters) return false;
  const registered = await api.query.compute.stakedResultSubmitters(address);
  return !registered.isEmpty && (await hasResultSubmitterStake(address));
}

/**
 * Registers `account` to sign `compute.result` without Root. Requires spec 34 and an
 * account for which `hasResultSubmitterStake` holds; fails with `InsufficientStake` or
 * `AlreadyResultSubmitter` otherwise.
 */
export async function registerResultSubmitter(account: KeyringPair) {
  const api = await getApi();
  assert(api, "API not initialized");
  assert(api.tx.compute.registerResultSubmitter, "compute.registerResultSubmitter needs spec 34 or later");

  const receipt = await signAndSend(api.tx.compute.registerResultSubmitter(), account);
  debugLog("Result submitter registered:", account.address, "tx:", receipt.hash);
  return receipt;
}
