import type { IndexerClient } from "./client";
import type { BlocksData, BlocksQuery, SuccessResponse } from "./types";

/**
 * Fetch a paginated list of blocks, including chain stats.
 *
 * `GET /api/blocks`
 *
 * Response shape: `{ success: true, data: { blocks: BlockDocument[], stats? } }`
 *
 * @param client  Configured {@link IndexerClient}
 * @param query   Pagination — `page` (0-indexed), `page_size`
 */
export async function getBlocks(
	client: IndexerClient,
	query?: BlocksQuery,
): Promise<SuccessResponse<BlocksData>> {
	return client.get("/api/blocks", query ? { ...query } : undefined);
}
