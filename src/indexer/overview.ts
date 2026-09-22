import type { IndexerClient } from "./client";
import type { Overview, SuccessResponse } from "./types";

/**
 * Chain summary used by the explorer home and blocks pages.
 *
 * `GET /api/overview`
 *
 * @param client  Configured {@link IndexerClient}
 */
export async function getOverview(
  client: IndexerClient,
): Promise<SuccessResponse<Overview>> {
  return client.get("/api/overview");
}
