import type { IndexerClient } from "./client";
import type { EventsData, EventsQuery, SuccessResponse } from "./types";

/**
 * Paginated chain events, newest block first.
 *
 * `GET /api/events`
 *
 * @param client  Configured {@link IndexerClient}
 * @param query   Pagination — `page` (0-indexed), `page_size`
 */
export async function getEvents(
  client: IndexerClient,
  query?: EventsQuery,
): Promise<SuccessResponse<EventsData>> {
  return client.get("/api/events", query ? { ...query } : undefined);
}
