import { costEstimationClient } from "./client";
import type {
  ContractParams,
  EstimateResult,
  EstimateStatusResponse,
  GuardianEntry,
} from "./types";

interface RawGuardianEntry {
  address: string;
  pubKey: string;
  feeThreshold: string;
}

interface RawEstimateResult {
  predictedDurationMs: number;
  auctionedRate: string;
  estimatedCost: string;
  guardians: RawGuardianEntry[];
}

type RawEstimateStatusResponse =
  | { status: "pending"; auctionId: string }
  | { status: "completed"; auctionId: string; result: RawEstimateResult }
  | { status: "failed"; auctionId: string; error: string };

function toGuardianEntry(raw: RawGuardianEntry): GuardianEntry {
  return {
    address: raw.address,
    pubKey: raw.pubKey,
    feeThreshold: BigInt(raw.feeThreshold),
  };
}

function toEstimateResult(raw: RawEstimateResult): EstimateResult {
  return {
    predictedDurationMs: raw.predictedDurationMs,
    auctionedRate: BigInt(raw.auctionedRate),
    estimatedCost: BigInt(raw.estimatedCost),
    guardians: raw.guardians.map(toGuardianEntry),
  };
}

function toEstimateStatusResponse(
  raw: RawEstimateStatusResponse,
): EstimateStatusResponse {
  if (raw.status === "completed") {
    return { status: "completed", auctionId: raw.auctionId, result: toEstimateResult(raw.result) };
  }
  return raw;
}

export interface StartedEstimate {
  estimateId: string;
  /**
   * Id of the auction backing this estimate. Usable with {@link getAuction} once a
   * resolved auction has dropped off `GET /auctions` / `GET /guardians/:address/auctions`
   * — most callers never need it and can just poll {@link getEstimateResult}.
   */
  auctionId: string;
}

/**
 * Starts a cost estimate via `POST /estimate`.
 *
 * Asynchronous: returns as soon as the rate auction is created, well before it
 * resolves (~`AUCTION_WINDOW_MS`, 5000ms by default). Poll {@link getEstimateResult}
 * with the returned id for the outcome, or use {@link waitForEstimate} to do both in
 * one call.
 *
 * Not idempotent — every call starts a brand-new auction with a new id, and can
 * resolve to a different `estimatedCost` even for identical input.
 *
 * @throws {CostEstimationError} 400 if `computeMode` is missing/invalid; 422 if no
 * guardians are eligible for that mode (do not tight-loop retry).
 */
export async function startEstimate(params: ContractParams): Promise<StartedEstimate> {
  return costEstimationClient.post<StartedEstimate>("/estimate", params);
}

/**
 * Fetches the current state of an estimate started via {@link startEstimate}.
 *
 * `auctionedRate`, `estimatedCost`, and `feeThreshold` are returned as `bigint` —
 * never treat them as floating-point numbers.
 *
 * @throws {CostEstimationError} 404 if `estimateId` is unrecognized (terminal — a
 * restart of the service does not invalidate a previously issued id).
 */
export async function getEstimateResult(
  estimateId: string,
): Promise<EstimateStatusResponse> {
  const raw = await costEstimationClient.get<RawEstimateStatusResponse>(
    `/estimates/${encodeURIComponent(estimateId)}`,
  );
  return toEstimateStatusResponse(raw);
}

export interface WaitForEstimateOptions {
  /** Milliseconds between polls. Defaults to 5000ms (the service's default auction window). */
  intervalMs?: number;
  /** Upper bound on total wait time in milliseconds. Defaults to 60000ms. */
  timeoutMs?: number;
}

/**
 * Starts an estimate and polls {@link getEstimateResult} until it leaves
 * `"pending"`, spacing requests `intervalMs` apart rather than tight-looping.
 *
 * Resolves with the terminal `"completed"` or `"failed"` status. Rejects if
 * `timeoutMs` elapses first — the estimate keeps running server-side regardless,
 * and can still be recovered later via {@link getEstimateResult} with the same id.
 */
export async function waitForEstimate(
  params: ContractParams,
  options: WaitForEstimateOptions = {},
): Promise<{ estimateId: string; status: EstimateStatusResponse }> {
  const { intervalMs = 5000, timeoutMs = 60000 } = options;
  const { estimateId } = await startEstimate(params);
  const deadline = Date.now() + timeoutMs;

  for (;;) {
    const status = await getEstimateResult(estimateId);
    if (status.status !== "pending") {
      return { estimateId, status };
    }

    const remaining = deadline - Date.now();
    if (remaining <= 0) {
      throw new Error(
        `waitForEstimate: estimate ${estimateId} still pending after ${timeoutMs}ms`,
      );
    }
    await sleep(Math.min(intervalMs, remaining));
  }
}

function sleep(ms: number) {
  return new Promise<void>((resolve) => setTimeout(resolve, ms));
}
