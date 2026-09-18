import { IndexerHttpError, type IndexerClient } from "./client";
import type {
  GuardianDocument,
  GuardianGroupDocument,
  GuardianGroupsQuery,
  SuccessResponse,
} from "./types";

function displayNameForAccount(
  groups: GuardianGroupDocument[],
  account: string,
): string | null {
  for (const group of groups) {
    const addresses = group.guardians ?? [];
    const names = group.guardianNames ?? [];
    const index = addresses.indexOf(account);
    if (index === -1) continue;
    const rawName = names[index];
    if (typeof rawName === "string" && rawName.length > 0) return rawName;
  }
  return null;
}

function uniqueGuardians(groups: GuardianGroupDocument[]): GuardianDocument[] {
  const seen = new Map<string, string | null>();
  for (const group of groups) {
    const addresses = group.guardians ?? [];
    const names = group.guardianNames ?? [];
    for (let i = 0; i < addresses.length; i++) {
      const account = addresses[i];
      if (!account || seen.has(account)) continue;
      const rawName = names[i];
      seen.set(account, typeof rawName === "string" && rawName.length > 0 ? rawName : null);
    }
  }
  return Array.from(seen, ([account, displayName]) => ({ account, displayName }));
}

async function guardianGroupsOrEmpty(
  client: IndexerClient,
  query?: GuardianGroupsQuery,
): Promise<GuardianGroupDocument[]> {
  try {
    const response = await getGuardianGroups(client, query);
    return response.data ?? [];
  } catch (err) {
    if (err instanceof IndexerHttpError && err.statusCode === 404) {
      return [];
    }
    throw err;
  }
}

/**
 * Fetch guardian groups, optionally filtered by guardian address.
 * Results are deduplicated and enriched with identity names.
 *
 * `GET /api/guardian-groups`
 *
 * Each group includes `guardians: string[]` and a parallel `guardianNames`
 * array (`string | null`) from the identity database.
 *
 * @param client  Configured {@link IndexerClient}
 * @param query   Optional filter — `guardian` address
 */
export async function getGuardianGroups(
  client: IndexerClient,
  query?: GuardianGroupsQuery,
): Promise<SuccessResponse<GuardianGroupDocument[]>> {
  return client.get("/api/guardian-groups", query ? { ...query } : undefined);
}

/**
 * Flatten identity-enriched guardian groups into a unique list of guardians.
 *
 * Derived from {@link getGuardianGroups}; there is no separate `/api/guardians`
 * endpoint. A 404 (no groups) returns an empty list.
 *
 * @returns `{ success: true, data: GuardianDocument[] }`
 *          where each item is `{ account, displayName }`.
 */
export async function getGuardians(
  client: IndexerClient,
): Promise<SuccessResponse<GuardianDocument[]>> {
  const groups = await guardianGroupsOrEmpty(client);
  return { success: true, data: uniqueGuardians(groups) };
}

/**
 * Fetch identity for a single guardian account.
 *
 * Uses `GET /api/guardian-groups?guardian=<account>` and returns
 * `{ account, displayName }`. `displayName` is `null` when the account has
 * no identity or is not in any indexed group.
 */
export async function getGuardian(
  client: IndexerClient,
  account: string,
): Promise<SuccessResponse<GuardianDocument>> {
  const groups = await guardianGroupsOrEmpty(client, { guardian: account });
  return {
    success: true,
    data: {
      account,
      displayName: displayNameForAccount(groups, account),
    },
  };
}

/**
 * Fetch a single guardian group by its group ID.
 *
 * `GET /api/guardian-group/:id`
 *
 * @param client  Configured {@link IndexerClient}
 * @param id      The `groupId`
 */
export async function getGuardianGroup(
  client: IndexerClient,
  id: string,
): Promise<SuccessResponse<GuardianGroupDocument>> {
  return client.get(`/api/guardian-group/${encodeURIComponent(id)}`);
}
