import type { IndexerClient } from "./client";
import type {
  ArtefactDocument,
  ArtefactsQuery,
  ArtefactAccessQuery,
  ArtefactContractsQuery,
  StoreType,
  SuccessResponse,
} from "./types";

/**
 * Fetch all artefacts, optionally filtered by type.
 *
 * `GET /api/artefacts`
 *
 * For UI categorization by `storeType`, prefer the dedicated helpers:
 * {@link getDatasets}, {@link getModels}, {@link getAgents}, {@link getExecutables}.
 *
 * @param client  Configured {@link IndexerClient}
 * @param query   Optional filter — `storeType` / `artefactType`
 * @returns `{ success: true, data: ArtefactDocument[] }`
 */
export async function getArtefacts(
  client: IndexerClient,
  query?: ArtefactsQuery,
): Promise<SuccessResponse<ArtefactDocument[]>> {
  return client.get("/api/artefacts", query ? { ...query } : undefined);
}

/**
 * Fetch artefacts filtered by `storeType`.
 *
 * Loads `/api/artefacts` and filters client-side so results are reliable even when
 * the indexer ignores the `storeType` query param.
 */
export async function getArtefactsByStoreType(
  client: IndexerClient,
  storeType: StoreType,
): Promise<SuccessResponse<ArtefactDocument[]>> {
  const response = await getArtefacts(client);
  return {
    success: true,
    data: response.data.filter((item) => item.storeType === storeType),
  };
}

/** Fetch artefacts with `storeType: "Dataset"`. */
export async function getDatasets(
  client: IndexerClient,
): Promise<SuccessResponse<ArtefactDocument[]>> {
  return getArtefactsByStoreType(client, "Dataset");
}

/** Fetch artefacts with `storeType: "Model"`. */
export async function getModels(
  client: IndexerClient,
): Promise<SuccessResponse<ArtefactDocument[]>> {
  return getArtefactsByStoreType(client, "Model");
}

/** Fetch artefacts with `storeType: "Agent"`. */
export async function getAgents(
  client: IndexerClient,
): Promise<SuccessResponse<ArtefactDocument[]>> {
  return getArtefactsByStoreType(client, "Agent");
}

/** Fetch artefacts with `storeType: "Executable"`. */
export async function getExecutables(
  client: IndexerClient,
): Promise<SuccessResponse<ArtefactDocument[]>> {
  return getArtefactsByStoreType(client, "Executable");
}

/**
 * Fetch a single artefact by its contract ID.
 *
 * `GET /api/artefact/:id`
 *
 * @param client  Configured {@link IndexerClient}
 * @param id      The `contractId` of the artefact
 */
export async function getArtefact(
  client: IndexerClient,
  id: string,
): Promise<SuccessResponse<ArtefactDocument>> {
  return client.get(`/api/artefact/${encodeURIComponent(id)}`);
}

/**
 * Fetch access records for a specific artefact.
 *
 * `GET /api/artefact/:id/access`
 *
 * @param client  Configured {@link IndexerClient}
 * @param id      The `contractId` of the artefact
 * @param query   Optional filters — `blockHeight`, `extrinsicIndex`, `retriver`
 */
export async function getArtefactAccess(
  client: IndexerClient,
  id: string,
  query?: ArtefactAccessQuery,
): Promise<SuccessResponse<unknown[]>> {
  return client.get(
    `/api/artefact/${encodeURIComponent(id)}/access`,
    query ? { ...query } : undefined,
  );
}

/**
 * Fetch contract records associated with a specific artefact.
 *
 * `GET /api/artefact/:id/contracts`
 *
 * @param client  Configured {@link IndexerClient}
 * @param id      The `contractId` of the artefact
 * @param query   Optional filters — `blockHeight`, `extrinsicIndex`, `retriver`
 */
export async function getArtefactContracts(
  client: IndexerClient,
  id: string,
  query?: ArtefactContractsQuery,
): Promise<SuccessResponse<unknown[]>> {
  return client.get(
    `/api/artefact/${encodeURIComponent(id)}/contracts`,
    query ? { ...query } : undefined,
  );
}
