import type { IndexerClient } from "./client";
import type {
  CallDocument,
  CallQuery,
  CallMetadataDocument,
  CallMetadataQuery,
  CallArgsDocument,
  CallArgsQuery,
  SuccessResponse,
} from "./types";

/**
 * Fetch a call by block height and extrinsic index.
 *
 * `GET /api/call`
 *
 * @param client  Configured {@link IndexerClient}
 * @param query   **Required** — `blockHeight` and `extrinsicIndex`
 */
export async function getCall(
  client: IndexerClient,
  query: CallQuery,
): Promise<SuccessResponse<CallDocument>> {
  return client.get("/api/call", { ...query });
}

/**
 * Fetch call metadata by block height and extrinsic index.
 *
 * `GET /api/call-metadata`
 *
 * @param client  Configured {@link IndexerClient}
 * @param query   **Required** — `blockHeight` and `extrinsicIndex`
 */
export async function getCallMetadata(
  client: IndexerClient,
  query: CallMetadataQuery,
): Promise<SuccessResponse<CallMetadataDocument>> {
  return client.get("/api/call-metadata", { ...query });
}

/**
 * Fetch call arguments by metadata hash.
 *
 * `GET /api/call-args`
 *
 * @param client  Configured {@link IndexerClient}
 * @param query   **Required** — `metadataHash`
 */
export async function getCallArgs(
  client: IndexerClient,
  query: CallArgsQuery,
): Promise<SuccessResponse<CallArgsDocument>> {
  return client.get("/api/call-args", { ...query });
}
