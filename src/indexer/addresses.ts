import type { IndexerClient } from "./client";
import type { AddressDocument, DataOnlyResponse } from "./types";

/**
 * Fetch the top 50 addresses by balance.
 *
 * `GET /api/addresses`
 *
 * **Note:** This endpoint returns a raw array, not a `{ success, data }` envelope.
 *
 * @param client  Configured {@link IndexerClient}
 */
export async function getAddresses(
  client: IndexerClient,
): Promise<AddressDocument[]> {
  return client.get("/api/addresses");
}

/**
 * Fetch a single address document.
 *
 * `GET /api/address/:address`
 *
 * **Note:** This endpoint returns `{ data }` without a `success` field.
 *
 * @param client   Configured {@link IndexerClient}
 * @param address  The substrate address to look up
 */
export async function getAddress(
  client: IndexerClient,
  address: string,
): Promise<DataOnlyResponse<AddressDocument>> {
  return client.get(`/api/address/${encodeURIComponent(address)}`);
}
