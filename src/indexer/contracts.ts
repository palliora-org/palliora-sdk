import type { IndexerClient } from "./client";
import type {
  ContractDocument,
  ContractsQuery,
  ComputeDocument,
  PaginatedResponse,
  SuccessResponse,
} from "./types";

/**
 * Fetch a paginated list of contracts.
 *
 * `GET /api/contracts`
 *
 * @param client  Configured {@link IndexerClient}
 * @param query   Pagination — `page` (0-indexed), `page_size` (default 25)
 * @returns `{ success: true, data: ContractDocument[], total: number }`
 */
export async function getContracts(
  client: IndexerClient,
  query?: ContractsQuery,
): Promise<PaginatedResponse<ContractDocument>> {
  return client.get("/api/contracts", query ? { ...query } : undefined);
}

/**
 * Fetch a single contract by its ID.
 *
 * `GET /api/contract/:id`
 *
 * @param client  Configured {@link IndexerClient}
 * @param id      The contract identifier
 */
export async function getContract(
  client: IndexerClient,
  id: string,
): Promise<SuccessResponse<ContractDocument>> {
  return client.get(`/api/contract/${encodeURIComponent(id)}`);
}

/**
 * Fetch compute request data for a specific contract.
 *
 * `GET /api/compute/:id`
 *
 * @param client  Configured {@link IndexerClient}
 * @param id      The contract identifier
 */
export async function getCompute(
  client: IndexerClient,
  id: string,
): Promise<SuccessResponse<ComputeDocument>> {
  return client.get(`/api/compute/${encodeURIComponent(id)}`);
}
