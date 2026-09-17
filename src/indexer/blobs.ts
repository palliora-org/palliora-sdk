import type { IndexerClient } from "./client";
import type { BlobDocument, SuccessResponse } from "./types";

/**
 * Fetch a blob by its block-height ID.
 *
 * `GET /api/blob/:id`
 *
 * @param client  Configured {@link IndexerClient}
 * @param id      Block height (integer) identifying the blob
 */
export async function getBlob(
  client: IndexerClient,
  id: number,
): Promise<SuccessResponse<BlobDocument>> {
  return client.get(`/api/blob/${encodeURIComponent(String(id))}`);
}
