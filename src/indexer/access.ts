import type { IndexerClient } from "./client";
import type { AccessDocument, AccessQuery, AccessResponse } from "./types";

/**
 * Fetch access records from the **legacy** statescan-polkadot-data database.
 *
 * `GET /api/access`
 *
 * > **Deprecated** — superseded by `getArtefactAccess`. Kept for backward compatibility.
 *
 * @param client  Configured {@link IndexerClient}
 * @param query   Optional filters — `blockHeight`, `extrinsicIndex`, `retriver`
 */
export async function getAccess(
  client: IndexerClient,
  query?: AccessQuery,
): Promise<AccessResponse<AccessDocument>> {
  return client.get("/api/access", query ? { ...query } : undefined);
}
