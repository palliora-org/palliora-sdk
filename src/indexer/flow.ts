import { IndexerHttpError, type IndexerClient } from "./client";
import { getArtefact, getArtefactAccess } from "./artefacts";
import { getBlob } from "./blobs";
import { getCompute, getContract } from "./contracts";
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
  SuccessResponse,
} from "./types";

export function deriveContractStatus(
  agreement: ContractDocument | null | undefined,
  compute: ComputeDocument | null | undefined,
): ContractFlowStatus | "—" {
  if (!agreement) return "—";
  if (compute?.resultTx) return "COMPLETED";
  if (compute) return "PROCESSING";
  if ((agreement.responses?.length ?? 0) > 0) return "ACCEPTED";
  return "PENDING";
}

export function buildContractPhases(
  agreement: ContractDocument | null | undefined,
  compute: ComputeDocument | null | undefined,
): ContractFlowPhase[] {
  const status = deriveContractStatus(agreement, compute);
  const phase1Active = !!agreement;
  const phase1Complete = status === "ACCEPTED" || status === "PROCESSING" || status === "COMPLETED";
  const phase2Active = !!compute;
  const phase3Complete = !!compute?.resultTx;

  const { _id: _ignored, ...computeRest } = (compute ?? {}) as ComputeDocument & { _id?: unknown };

  return [
    {
      id: "phase-1",
      title: "Phase 1: Contract Agreement",
      status: agreement ? `RESPONSES (${agreement.responses?.length ?? 0})` : "—",
      description: "User submits agreement, fees are locked, parties respond.",
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
      status: compute ? "SUBMITTED" : "PENDING",
      description: "Compute request is submitted and broadcast to all guardians.",
      json: compute ? computeRest : {},
      active: phase2Active,
      complete: phase2Active,
      pending: phase1Complete && !phase2Active,
    },
    {
      id: "phase-3",
      title: "Phase 3: Guardian Execution",
      status: compute?.resultTx ? "RESULT_SUBMITTED" : compute ? "PROCESSING" : "PENDING",
      description: compute?.resultTx
        ? "Guardian executed compute and submitted the result on-chain."
        : compute
          ? "Compute request is being processed by a guardian..."
          : "One guardian picks the request, executes compute, and submits result.",
      json: compute?.resultTx
        ? {
            jobId: compute.jobId,
            contractId: compute.contractId,
            orchestrator: compute.orchestrator,
            resultTx: compute.resultTx,
          }
        : {},
      active: phase2Active,
      complete: phase3Complete,
      pending: phase2Active && !phase3Complete,
    },
    {
      id: "phase-4",
      title: "Phase 4: Fee Distribution",
      status: compute?.resultTx ? "SETTLED" : compute ? "PROCESSING" : "PENDING",
      description: compute?.resultTx
        ? "Compute reward and decryption fees have been distributed."
        : compute
          ? "Awaiting fee distribution..."
          : "Executor gets compute reward and TD fee is split across guardians.",
      json: compute?.resultTx
        ? {
            jobId: compute.jobId,
            computeReward: compute.computeReward,
            decryptionFee: compute.decryptionFee,
            fee: compute.fee,
          }
        : {},
      active: phase3Complete,
      complete: phase3Complete,
      pending: phase2Active && !phase3Complete,
    },
  ];
}

/**
 * Fetch a compute contract and its compute request, then derive lifecycle status
 * and the four UI phases used by the explorer.
 *
 * A missing compute document (`404`) is treated as "agreement only".
 */
export async function getContractFlow(
  client: IndexerClient,
  id: string,
): Promise<SuccessResponse<ContractFlow>> {
  const [agreementResponse, compute] = await Promise.all([
    getContract(client, id),
    getCompute(client, id).then((response) => response.data).catch((err) => {
      if (err instanceof IndexerHttpError && err.statusCode === 404) return null;
      throw err;
    }),
  ]);

  const agreement = agreementResponse.data;
  return {
    success: true,
    data: {
      agreement,
      compute,
      status: deriveContractStatus(agreement, compute) as ContractFlowStatus,
      phases: buildContractPhases(agreement, compute),
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
