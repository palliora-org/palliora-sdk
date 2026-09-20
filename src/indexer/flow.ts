import { IndexerHttpError, type IndexerClient } from "./client";
import { getArtefact, getArtefactAccess } from "./artefacts";
import { getBlob } from "./blobs";
import { getCompute, getContract, getResults } from "./contracts";
import type {
  ArtefactDocument,
  ArtefactAccessQuery,
  ArtefactFlow,
  BlobDocument,
  ComputeDocument,
  ContractDocument,
  ContractFlow,
  ContractFlowPhase,
  ContractFlowStatus,
  ResultDocument,
  SuccessResponse,
} from "./types";

export type ComputeInput = ComputeDocument | ComputeDocument[] | null | undefined;

function computeTime(item: ComputeDocument): number {
  return item.indexer?.blockTime ?? 0;
}

function isComputeRequest(item: ComputeDocument): boolean {
  return Boolean(
    item.jobId ||
    item.orchestrator ||
    item.resultTx ||
    item.computeReward ||
    item.decryptionFee,
  );
}

export function normalizeComputes(compute: ComputeInput): ComputeDocument[] {
  if (!compute) return [];
  const list = Array.isArray(compute)
    ? compute
    : Array.isArray((compute as ComputeDocument & { computes?: ComputeDocument[] }).computes)
      ? (compute as ComputeDocument & { computes: ComputeDocument[] }).computes
      : [compute];
  return [...list]
    .filter(isComputeRequest)
    .sort((a, b) => computeTime(a) - computeTime(b));
}

/**
 * Map a `palliora-compute.results` row onto the compute-request shape used by
 * session phases (jobId, orchestrator, resultTx, fees).
 */
export function resultToCompute(result: ResultDocument): ComputeDocument {
  const indexer = result.indexer;
  return {
    ...result,
    jobId: result.resultId,
    contractId: result.contractId,
    orchestrator: result.submitor,
    resultTx: indexer
      ? {
          blockHeight: indexer.blockHeight,
          extrinsicIndex: indexer.extrinsicIndex,
          blockHash: indexer.blockHash,
          hash: indexer.blockHash,
        }
      : { hash: result.resultId },
    computeReward: result.feeBreakdown?.submitorFee?.amount,
    fee: result.feeBreakdown?.resultFee,
    decryptionFee: result.feeBreakdown?.thresholdDecryptionFee,
    indexer,
  };
}

function mergeComputes(
  fromResults: ComputeDocument[],
  fromCompute: ComputeDocument[],
): ComputeDocument[] {
  if (fromResults.length === 0) return fromCompute;
  const ids = new Set(
    fromResults.flatMap((item) => [item.jobId, item.contractId].filter(Boolean) as string[]),
  );
  const extras = fromCompute.filter(
    (item) => !ids.has(item.jobId ?? "") && !ids.has(item.contractId ?? ""),
  );
  return normalizeComputes([...fromResults, ...extras]);
}

function withParties(agreement: ContractDocument): ContractDocument {
  if (agreement.parties?.length) return agreement;
  const guardians = (agreement as ContractDocument & { guardians?: string[] }).guardians;
  if (Array.isArray(guardians) && guardians.length) {
    return { ...agreement, parties: guardians };
  }
  return agreement;
}

export function deriveContractStatus(
  agreement: ContractDocument | null | undefined,
  compute: ComputeInput,
): ContractFlowStatus | "—" {
  if (!agreement) return "—";
  const computes = normalizeComputes(compute);
  if (computes.length === 0) {
    return (agreement.responses?.length ?? 0) > 0 ? "ACCEPTED" : "PENDING";
  }
  if (computes.every((item) => !!item.resultTx)) return "COMPLETED";
  return "PROCESSING";
}

export function buildContractPhases(
  agreement: ContractDocument | null | undefined,
  compute: ComputeInput,
): ContractFlowPhase[] {
  const computes = normalizeComputes(compute);
  const latest = computes[computes.length - 1] ?? null;
  const settledCount = computes.filter((item) => !!item.resultTx).length;
  const status = deriveContractStatus(agreement, computes);
  const phase1Active = !!agreement;
  const phase1Complete = status === "ACCEPTED" || status === "PROCESSING" || status === "COMPLETED";
  const phase2Active = computes.length > 0;
  const allSettled = computes.length > 0 && settledCount === computes.length;
  const phase5Complete = status === "COMPLETED";

  const requestsJson = computes.map((item) => {
    const { _id: _ignored, ...rest } = item as ComputeDocument & { _id?: unknown };
    return rest;
  });

  return [
    {
      id: "phase-1",
      title: "Phase 1: Contract Agreement",
      status: agreement ? `RESPONSES (${agreement.responses?.length ?? 0})` : "—",
      description: "Established once and reused by every compute request in this session.",
      json: agreement
        ? {
            contractId: agreement.contractId,
            creator: agreement.creator,
            fee: agreement.fee,
            creationTime: agreement.creationTime,
            parties: agreement.parties,
            responses: agreement.responses,
            indexer: agreement.indexer,
            computeTx: agreement.computeTx,
          }
        : {},
      active: phase1Active,
      complete: phase1Complete,
      pending: phase1Active && !phase1Complete,
    },
    {
      id: "phase-2",
      title: "Phase 2: Compute Request",
      status: phase2Active ? `${computes.length} SUBMITTED` : "PENDING",
      description: "Each iteration submits a compute request that is broadcast to all guardians.",
      json: { requestCount: computes.length, requests: requestsJson },
      active: phase2Active,
      complete: phase2Active,
      pending: phase1Complete && !phase2Active,
    },
    {
      id: "phase-3",
      title: "Phase 3: Guardian Execution",
      status: allSettled
        ? `${settledCount}/${computes.length} RESULT_SUBMITTED`
        : phase2Active
          ? `${settledCount}/${computes.length} PROCESSING`
          : "PENDING",
      description: "One guardian claims each request, executes compute, and submits the result on-chain.",
      json: latest?.resultTx
        ? {
            jobId: latest.jobId,
            contractId: latest.contractId,
            orchestrator: latest.orchestrator,
            resultTx: latest.resultTx,
            settledCount,
            requestCount: computes.length,
          }
        : { settledCount, requestCount: computes.length },
      active: phase2Active,
      complete: allSettled,
      pending: phase2Active && !allSettled,
    },
    {
      id: "phase-4",
      title: "Phase 4: Fee Distribution",
      status: allSettled ? `${settledCount}/${computes.length} SETTLED` : phase2Active ? "PROCESSING" : "PENDING",
      description: "Executor reward is paid per completed request. TD fee was locked once at agreement.",
      json: allSettled
        ? {
            requestCount: computes.length,
            settledCount,
            computeReward: latest?.computeReward,
            decryptionFee: latest?.decryptionFee,
            fee: latest?.fee,
          }
        : { requestCount: computes.length, settledCount },
      active: allSettled,
      complete: allSettled,
      pending: phase2Active && !allSettled,
    },
    {
      id: "phase-5",
      title: "Phase 5: Close Out",
      status: phase5Complete ? "SETTLED" : phase1Complete ? "PENDING" : "—",
      description: "User sends closeout, guardians clean up, remaining funds are refunded.",
      json: {
        requestCount: computes.length,
        settledCount,
        finalStatus: phase5Complete ? "SETTLED" : status,
      },
      active: phase5Complete,
      complete: phase5Complete,
      pending: phase1Complete && !phase5Complete,
    },
  ];
}

/**
 * Fetch a compute contract, optional `/api/compute/:id` payload, and
 * `palliora-compute.results` rows, then derive session lifecycle status and
 * the five UI phases used by the explorer.
 *
 * Missing compute (`404`) or results (`404`) is treated as empty.
 */
export async function getContractFlow(
  client: IndexerClient,
  id: string,
): Promise<SuccessResponse<ContractFlow>> {
  const [agreementResponse, compute, results] = await Promise.all([
    getContract(client, id),
    getCompute(client, id).then((response) => response.data).catch((err) => {
      if (err instanceof IndexerHttpError && err.statusCode === 404) return null;
      throw err;
    }),
    getResults(client, { contractId: id }).then((response) => response.data).catch((err) => {
      if (err instanceof IndexerHttpError && err.statusCode === 404) return [];
      throw err;
    }),
  ]);

  const agreement = withParties(agreementResponse.data);
  const computes = mergeComputes(
    (results ?? []).map(resultToCompute),
    normalizeComputes(compute),
  );
  const latest = computes[computes.length - 1] ?? null;

  return {
    success: true,
    data: {
      agreement,
      compute: latest,
      computes,
      results: results ?? [],
      status: deriveContractStatus(agreement, computes) as ContractFlowStatus,
      phases: buildContractPhases(agreement, computes),
    },
  };
}

function blobHeightsFromArtefact(artefact: ArtefactDocument): number[] {
  const refs = artefact.blobRefs;
  if (!Array.isArray(refs)) return [];
  const heights: number[] = [];
  for (const ref of refs) {
    const raw = Array.isArray(ref) ? ref[0] : ref;
    const height = typeof raw === "number" ? raw : Number(raw);
    if (Number.isFinite(height)) heights.push(height);
  }
  return heights;
}

/**
 * Fetch an artefact together with its access records and blobs.
 *
 * Missing access (`404`) becomes `[]`. Missing blobs are skipped.
 */
export async function getArtefactFlow(
  client: IndexerClient,
  id: string,
  accessQuery?: ArtefactAccessQuery,
): Promise<SuccessResponse<ArtefactFlow>> {
  const artefactResponse = await getArtefact(client, id);
  const artefact = artefactResponse.data;

  let access: unknown[] = [];
  try {
    const accessResponse = await getArtefactAccess(client, id, accessQuery);
    access = Array.isArray(accessResponse.data) ? accessResponse.data : [];
  } catch (err) {
    if (!(err instanceof IndexerHttpError && err.statusCode === 404)) throw err;
  }

  const blobs: BlobDocument[] = [];
  for (const height of blobHeightsFromArtefact(artefact)) {
    try {
      const blobResponse = await getBlob(client, height);
      if (blobResponse.data) blobs.push(blobResponse.data);
    } catch (err) {
      if (err instanceof IndexerHttpError && err.statusCode === 404) continue;
      throw err;
    }
  }

  return {
    success: true,
    data: { artefact, access, blobs },
  };
}
