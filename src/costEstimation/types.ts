/** Confidentiality mode a compute contract requires guardians to support. */
export type ComputeMode = "Trusted" | "TEE" | "MPC" | "FHE" | "ZKP";

/** Request body for {@link startEstimate} (`POST /estimate`). */
export interface ContractParams {
  /** Confidentiality mode eligible guardians must support. */
  computeMode: ComputeMode;
  /** Drives duration prediction. Omit to fall back to the service's default duration. */
  programRef?: string;
  /** Existing on-chain contract id. Omit to zero the input-fee component of the estimate. */
  contractId?: string;
}

/** A guardian entry as returned in an estimate's eligible set. */
export interface GuardianEntry {
  address: string;
  pubKey: string;
  /** On-chain reserve rate, in atomic units. */
  feeThreshold: bigint;
}

/** Resolved outcome of a `"completed"` estimate. */
export interface EstimateResult {
  predictedDurationMs: number;
  /** Winning auctioned rate, in atomic units. */
  auctionedRate: bigint;
  /** `resultFee + inputFee + thresholdDecryptionFee + auctionedRate * predictedDurationMs`. */
  estimatedCost: bigint;
  /** Full eligible guardian set at auction start, not just the winner. */
  guardians: GuardianEntry[];
}

/** Response from {@link getEstimateResult} (`GET /estimates/:id`). */
export type EstimateStatusResponse =
  | { status: "pending"; auctionId: string }
  | { status: "completed"; auctionId: string; result: EstimateResult }
  | { status: "failed"; auctionId: string; error: string };

/** An auction currently open (unresolved), as listed by `GET /auctions` and friends. */
export interface OpenAuction {
  auctionId: string;
  contractId: string;
  guardians: string[];
  /** Auction resolution deadline, epoch ms. */
  deadline: number;
}

/** The winning bid on a resolved auction. */
export interface AuctionWinner {
  guardian: string;
  /** Winning rate, in atomic units. */
  rate: bigint;
}

/**
 * A resolved auction this guardian was eligible for, as returned by
 * {@link listResolvedGuardianAuctions} (`GET /guardians/:address/auctions?resolved=true`).
 */
export interface ResolvedAuction {
  auctionId: string;
  contractId: string;
  guardians: string[];
  deadline: number;
  winner: AuctionWinner;
}

/**
 * Full detail for a single auction regardless of resolution status, as returned by
 * {@link getAuction} (`GET /auctions/:id`). A resolved auction is never deleted from
 * the service's store, only excluded from `GET /auctions` / `GET /guardians/:address/auctions`
 * — this is the only endpoint that can return its outcome once it has dropped off those lists.
 */
export interface AuctionDetail {
  auctionId: string;
  contractId: string;
  guardians: string[];
  deadline: number;
  resolved: boolean;
  /** Present only once `resolved` is `true`. */
  winner?: AuctionWinner;
}
