// ---------------------------------------------------------------------------
// @statescan/indexer REST API — TypeScript type definitions
// ---------------------------------------------------------------------------

import { StoreType } from "../compute";

/** Common `indexer` subdocument present on most indexed documents. */
export interface IndexerMeta {
  blockHeight: number;
  blockHash: string;
  blockTime: number;
  extrinsicIndex: number;
  eventIndex: number;
}

// ── Artefacts ───────────────────────────────────────────────────────────────

/** @deprecated Prefer {@link StoreType}. Kept for backward compatibility. */
export type ArtefactType = StoreType | "Data";

export interface ArtefactDocument {
  contractId: string;
  creator: string;
  owner: string;
  storeType: StoreType | string | null;
  contractType: string;
  status?: string;
  groupId: string | null;
  name?: string | null;
  description?: string | null;
  /** @deprecated Prefer `storeType`. May be absent on newer documents. */
  artefactType?: ArtefactType;
  blobRefs?: Array<[number, number] | unknown>;
  indexer: IndexerMeta;
  [key: string]: unknown;
}

export interface ArtefactsQuery {
  /** Server-side filter when supported by the indexer. Prefer client helpers for `storeType`. */
  artefactType?: ArtefactType;
  storeType?: StoreType;
}

export interface ArtefactAccessQuery {
  blockHeight?: number;
  extrinsicIndex?: number;
  retriver?: string;
}

export interface ArtefactContractsQuery {
  blockHeight?: number;
  extrinsicIndex?: number;
  retriver?: string;
}

// ── Contracts ───────────────────────────────────────────────────────────────

export interface ContractResponse {
  peerId?: string;
  acceptance?: boolean;
  creationTime?: number;
  [key: string]: unknown;
}

export interface ContractDocument {
  contractId: string;
  creator?: string;
  owner?: string;
  storeType?: string;
  contractType?: string;
  status?: string;
  groupId?: string;
  artefactType?: string;
  parties?: string[];
  responses?: ContractResponse[];
  fee?: string | number;
  creationTime?: number;
  computeTx?: unknown;
  indexer?: IndexerMeta;
  [key: string]: unknown;
}

export interface ContractsQuery {
  page?: number;
  page_size?: number;
}

export interface ComputeDocument {
  jobId?: string;
  contractId?: string;
  orchestrator?: string;
  parties?: string[];
  resultTx?: unknown;
  computeReward?: string | number;
  decryptionFee?: unknown;
  fee?: string | number;
  indexer?: IndexerMeta;
  [key: string]: unknown;
}

export interface ResultFeeParty {
  recipient?: string;
  amount?: string;
  kind?: string;
  [key: string]: unknown;
}

export interface ResultFeeBreakdown {
  inputFee?: ResultFeeParty | null;
  programFee?: ResultFeeParty | null;
  thresholdDecryptionFee?: unknown;
  computeFee?: ResultFeeParty | null;
  submitorFee?: ResultFeeParty | null;
  resultFee?: string;
  totalCharged?: string;
  reservedFee?: string;
  refundedAmount?: string;
  [key: string]: unknown;
}

/** One execution stored in `palliora-compute.results`. */
export interface ResultDocument {
  resultId: string;
  contractId: string;
  contractType?: string;
  submitor?: string;
  computeDurationMs?: number;
  executionOutcome?: unknown;
  feeBreakdown?: ResultFeeBreakdown;
  indexer?: IndexerMeta;
  [key: string]: unknown;
}

export interface ResultsQuery {
  /** Filter `palliora-compute.results` by parent contract. Required by the indexer. */
  contractId: string;
}

export type ContractFlowStatus = "PENDING" | "ACCEPTED" | "PROCESSING" | "COMPLETED";

export interface ContractFlowPhase {
  id: "phase-1" | "phase-2" | "phase-3" | "phase-4" | "phase-5";
  title: string;
  status: string;
  description: string;
  json: Record<string, unknown>;
  active: boolean;
  complete: boolean;
  pending: boolean;
}

/** Combined compute-contract lifecycle assembled from `/api/contract/:id` + `/api/compute/:id` + `/api/results`. */
export interface ContractFlow {
  agreement: ContractDocument;
  /** Latest compute request, if any. Prefer {@link ContractFlow.computes} for session flows. */
  compute: ComputeDocument | null;
  /** Every compute request on this agreement, oldest first. */
  computes: ComputeDocument[];
  /** Execution rows from `palliora-compute.results` for this contract. */
  results: ResultDocument[];
  status: ContractFlowStatus;
  phases: ContractFlowPhase[];
}

/** Combined artefact + access + blobs for a dataset/model/agent detail page. */
export interface ArtefactFlow {
  artefact: ArtefactDocument;
  access: unknown[];
  blobs: BlobDocument[];
}

// ── Blocks ──────────────────────────────────────────────────────────────────

export interface BlockDocument {
  height: number;
  hash: string;
  time: number;
  validator?: string;
  parentHash?: string;
  stateRoot?: string;
  extrinsicsRoot?: string;
  eventsCount?: number;
  extrinsicsCount?: number;
  [key: string]: unknown;
}

/** Payload inside `GET /api/blocks` — `{ data: { blocks, stats } }`. */
export interface BlocksData {
  blocks: BlockDocument[];
  stats?: Record<string, unknown>;
  [key: string]: unknown;
}

export interface BlocksQuery {
  page?: number;
  page_size?: number;
}

// ── Calls ───────────────────────────────────────────────────────────────────

export interface CallDocument {
  [key: string]: unknown;
}

export interface CallQuery {
  blockHeight: number;
  extrinsicIndex: number;
}

export interface CallMetadataDocument {
  [key: string]: unknown;
}

export interface CallMetadataQuery {
  blockHeight: number;
  extrinsicIndex: number;
}

export interface CallArgsDocument {
  [key: string]: unknown;
}

export interface CallArgsQuery {
  metadataHash: string;
}

// ── Transfers ───────────────────────────────────────────────────────────────

export interface TransferDocument {
  indexer: IndexerMeta;
  [key: string]: unknown;
}

export interface TransfersQuery {
  page?: number;
  page_size?: number;
}

// ── Extrinsics ──────────────────────────────────────────────────────────────

export interface ExtrinsicDocument {
  indexer: {
    blockHeight: number;
    extrinsicIndex: number;
    blockHash?: string;
    blockTime?: number;
    eventIndex?: number;
  };
  hash: string;
  isSigned: boolean;
  [key: string]: unknown;
}

export interface ExtrinsicsQuery {
  page?: number;
  page_size?: number;
  /** Set to `"true"` to return only signed extrinsics. */
  signed_only?: "true" | "false" | boolean;
}

// ── Addresses ───────────────────────────────────────────────────────────────

export interface AddressDocument {
  address: string;
  balance: string | number;
  [key: string]: unknown;
}

// ── Blobs ───────────────────────────────────────────────────────────────────

export interface BlobDocument {
  indexer: IndexerMeta;
  [key: string]: unknown;
}

// ── Guardians ───────────────────────────────────────────────────────────────

/**
 * Identity-enriched guardian from `GET /api/guardian-groups`.
 * `displayName` is the on-chain identity display, or `null` if none is set.
 */
export interface GuardianDocument {
  account: string;
  displayName: string | null;
}

export interface GuardianGroupDocument {
  groupId: string;
  creator?: string;
  guardians: string[];
  /**
   * Parallel to {@link GuardianGroupDocument.guardians}.
   * Identity display name for each address, or `null` if unset.
   */
  guardianNames: Array<string | null>;
  groupPk?: string;
  tauParams?: string;
  aggKey?: string;
  status?: string;
  success?: boolean;
  indexer?: IndexerMeta;
  creationTime?: number;
  [key: string]: unknown;
}

export interface GuardianGroupsQuery {
  guardian?: string;
}

// ── Access (legacy) ─────────────────────────────────────────────────────────

export interface AccessDocument {
  [key: string]: unknown;
}

export interface AccessQuery {
  blockHeight?: number;
  extrinsicIndex?: number;
  retriver?: string;
}

// ── Response Envelopes ──────────────────────────────────────────────────────

/** Standard success response: `{ success: true, data: T }`. */
export interface SuccessResponse<T> {
  success: true;
  data: T;
}

/** Paginated success response: `{ success: true, data: T[], total: number }`. */
export interface PaginatedResponse<T> {
  success: true;
  data: T[];
  total: number;
}

/** Access-style success response: `{ success: true, data: T[], message: string }`. */
export interface AccessResponse<T> {
  success: true;
  data: T[];
  message: string;
}

/** Address-style response (no `success` flag): `{ data: T }`. */
export interface DataOnlyResponse<T> {
  data: T;
}

/** Error response from the indexer. */
export interface ErrorResponse {
  success: false;
  message: string;
}
