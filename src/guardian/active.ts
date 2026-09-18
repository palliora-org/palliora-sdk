import type { ApiPromise } from "@polkadot/api";
import { waitReady } from "@polkadot/wasm-crypto";
import { getApi } from "../chain";
import { isFunction } from "@polkadot/util";
import { assert } from "../utils";

export const getGuardianList = async () => {
  const api = await getApi();
  if (!api) throw new Error("API not initialized");

  const rpc = api.rpc as unknown as Record<
    string,
    Record<string, (...params: unknown[]) => Promise<unknown>>
  >;
  const section = "guardian";
  const method = "guardianList";

  assert(
    isFunction(rpc[section]?.[method]),
    `api.rpc.${section}.${method} does not exist`,
  );

  const list = ((await rpc[section]["guardianList"]()) as Array<Text>)
    .map((item) => [item.toString()])
    .flat(1);

  return list;
};

export interface ActiveGuardian {
  account: string;
  guardianPrefs: Record<string, unknown> | null;
  stakersOverview: Record<string, unknown> | null;
}

/**
 * Current-era on-chain guardians with staking prefs and ledger totals.
 * Does not disconnect the shared API.
 */
export async function getActiveGuardians(
  apiInstance?: ApiPromise,
): Promise<ActiveGuardian[]> {
  await waitReady();
  const api = apiInstance ?? (await getApi());
  if (!api) throw new Error("API not initialized");

  const guardians = await api.query.guardian.guardians();
  const accounts = (guardians?.toJSON() || []) as string[];

  return Promise.all(
    accounts.map(async (account) => {
      const [prefs, ledger] = await Promise.all([
        api.query.staking.guardians(account),
        api.query.staking.ledger(account),
      ]);

      return {
        account,
        guardianPrefs: (prefs?.toHuman?.() as Record<string, unknown>) ?? null,
        stakersOverview: (ledger?.toHuman?.() as Record<string, unknown>) ?? null,
      };
    }),
  );
}
