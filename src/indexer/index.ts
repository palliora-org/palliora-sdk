// ---------------------------------------------------------------------------
// @statescan/indexer REST API wrapper — public surface
// ---------------------------------------------------------------------------

export { IndexerClient, IndexerHttpError } from "./client";
export type { IndexerClientOptions } from "./client";

export * from "./types";

export { getArtefacts, getArtefact, getArtefactAccess, getArtefactContracts, getArtefactsByStoreType, getDatasets, getModels, getAgents, getExecutables, isArtefactUsage } from "./artefacts";
export { getContracts, getContract, getCompute, getResults, getResult } from "./contracts";
export { getContractFlow, getArtefactFlow, deriveContractStatus, buildContractPhases, normalizeComputes, resultToCompute } from "./flow";
export { getBlocks } from "./blocks";
export { getOverview } from "./overview";
export { getEvents } from "./events";
export { getCall, getCallMetadata, getCallArgs } from "./calls";
export { getTransfers } from "./transfers";
export { getExtrinsics, getExtrinsic } from "./extrinsics";
export { getAddresses, getAddress } from "./addresses";
export { getBlob } from "./blobs";
export { getGuardianGroups, getGuardianGroup, getGuardians, getGuardian } from "./guardians";
export { getAccess } from "./access";
