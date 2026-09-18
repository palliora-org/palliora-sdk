import type { IndexerClient } from "./client";
import type {
  ExtrinsicDocument,
  ExtrinsicsQuery,
  PaginatedResponse,
  SuccessResponse,
} from "./types";

/**
 * Fetch a paginated list of extrinsics, sorted by block height descending.
 *
 * `GET /api/extrinsics`
 *
 * Fields `nonce`, `_id`, `tip`, and `signature` are excluded by the indexer.
 *
 * @param client  Configured {@link IndexerClient}
 * @param query   Pagination — `page` (0-indexed, default 0), `page_size` (default 10, max 100);
 *                `signed_only: true` filters to signed extrinsics only
 * @returns `{ success: true, data: ExtrinsicDocument[], total: number }`
 */
export async function getExtrinsics(
  client: IndexerClient,
  query?: ExtrinsicsQuery,
): Promise<PaginatedResponse<ExtrinsicDocument>> {
  if (!query) {
    return client.get("/api/extrinsics");
  }

  const { signed_only, ...rest } = query;
  const params: Record<string, string | number | boolean | undefined> = { ...rest };

  if (signed_only !== undefined) {
    // Indexer expects the string "true" / "false"
    params.signed_only = signed_only === true || signed_only === "true" ? "true" : "false";
  }

  return client.get("/api/extrinsics", params);
}

/**
 * Fetch a single extrinsic by block index or transaction hash.
 *
 * `GET /api/extrinsic/:indexOrHash`
 *
 * Accepts either:
 * - Block index: `blockHeight-extrinsicIndex` (e.g. `"2528092-2"`)
 * - Transaction hash: `0x`-prefixed 64-char hex string
 *
 * @param client       Configured {@link IndexerClient}
 * @param indexOrHash  Block-index pair or extrinsic hash
 * @throws {IndexerHttpError} `400` for invalid id format, `404` when not found
 */
export async function getExtrinsic(
  client: IndexerClient,
  indexOrHash: string,
): Promise<SuccessResponse<ExtrinsicDocument>> {
  return client.get(`/api/extrinsic/${encodeURIComponent(indexOrHash)}`);
}
