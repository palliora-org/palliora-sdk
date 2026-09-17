import type { IndexerClient } from "./client";
import type { TransferDocument, TransfersQuery, SuccessResponse } from "./types";

/**
 * Fetch a paginated list of transfers, sorted by block height descending.
 *
 * `GET /api/transfers`
 *
 * @param client  Configured {@link IndexerClient}
 * @param query   Pagination — `page` (0-indexed), `page_size`
 */
export async function getTransfers(
  client: IndexerClient,
  query?: TransfersQuery,
): Promise<SuccessResponse<TransferDocument[]>> {
  return client.get("/api/transfers", query ? { ...query } : undefined);
}
