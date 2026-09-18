import type { KeyringPair } from "@polkadot/keyring/types";
import { u8aToHex } from "@polkadot/util";
import { costEstimationClient } from "./client";
import type { AuctionDetail, AuctionWinner, OpenAuction, ResolvedAuction } from "./types";

interface RawOpenAuctionsResponse {
  auctions: OpenAuction[];
}

interface RawAuctionWinner {
  guardian: string;
  rate: string;
}

interface RawAuctionDetail {
  auctionId: string;
  contractId: string;
  guardians: string[];
  deadline: number;
  resolved: boolean;
  winner?: RawAuctionWinner;
}

interface RawResolvedAuctionsResponse {
  auctions: (Omit<RawAuctionDetail, "resolved"> & { winner: RawAuctionWinner })[];
}

function toAuctionWinner(raw: RawAuctionWinner): AuctionWinner {
  return { guardian: raw.guardian, rate: BigInt(raw.rate) };
}

/**
 * Lists currently open (unresolved) auctions via `GET /auctions`, so a guardian can
 * discover an `auctionId` while it is still running in the background after a
 * {@link startEstimate} call returned. Only relevant when acting on behalf of a
 * guardian — a plain cost lookup never needs this.
 */
export async function listOpenAuctions(): Promise<OpenAuction[]> {
  const { auctions } =
    await costEstimationClient.get<RawOpenAuctionsResponse>("/auctions");
  return auctions;
}

/**
 * Same as {@link listOpenAuctions}, pre-filtered server-side (via
 * `GET /guardians/:address/auctions`) to auctions `guardianAddress` is eligible for.
 */
export async function listGuardianAuctions(
  guardianAddress: string,
): Promise<OpenAuction[]> {
  const { auctions } = await costEstimationClient.get<RawOpenAuctionsResponse>(
    `/guardians/${encodeURIComponent(guardianAddress)}/auctions`,
  );
  return auctions;
}

/**
 * Looks up a single auction via `GET /auctions/:id`, regardless of resolution status.
 * A resolved auction is never deleted from the service's store, only excluded from
 * {@link listOpenAuctions} / {@link listGuardianAuctions} — this is the only way to
 * retrieve its outcome (including the winning guardian's address) once resolved.
 *
 * @throws {CostEstimationError} 404 if `auctionId` is unrecognized — terminal.
 */
export async function getAuction(auctionId: string): Promise<AuctionDetail> {
  const raw = await costEstimationClient.get<RawAuctionDetail>(
    `/auctions/${encodeURIComponent(auctionId)}`,
  );
  return {
    auctionId: raw.auctionId,
    contractId: raw.contractId,
    guardians: raw.guardians,
    deadline: raw.deadline,
    resolved: raw.resolved,
    winner: raw.winner ? toAuctionWinner(raw.winner) : undefined,
  };
}

/**
 * Lists auctions `guardianAddress` was eligible for and that have since resolved, via
 * `GET /guardians/:address/auctions?resolved=true`. Use this instead of
 * {@link listGuardianAuctions} (which only ever shows currently open auctions) when
 * fetching a confirmed auction for a guardian you don't already have an `auctionId`
 * for — no need to guess the guardian's `computeMode` and start a throwaway estimate.
 */
export async function listResolvedGuardianAuctions(
  guardianAddress: string,
): Promise<ResolvedAuction[]> {
  const { auctions } = await costEstimationClient.get<RawResolvedAuctionsResponse>(
    `/guardians/${encodeURIComponent(guardianAddress)}/auctions?resolved=true`,
  );
  return auctions.map((a) => ({
    auctionId: a.auctionId,
    contractId: a.contractId,
    guardians: a.guardians,
    deadline: a.deadline,
    winner: toAuctionWinner(a.winner),
  }));
}

/**
 * Submits a signed rate bid into an open auction via `POST /auctions/:id/bid`,
 * signed with `guardian`'s sr25519 key over the literal string
 * `${auctionId}:${rate}`, as required by the service.
 *
 * Lowest `rate` wins; ties break by earliest submission time, then by
 * lexicographically smallest address. A guardian that never bids keeps its default
 * entry — its own on-chain threshold for the compute type this auction was opened
 * for, which reads as zero when it declared none.
 *
 * @param rate - Bid rate as a decimal-integer string, in atomic units.
 * @throws {CostEstimationError} 422 if the auction is unknown, already closed, or
 * `guardian` isn't in its eligible set — terminal, do not retry the same bid.
 */
export async function submitAuctionBid(
  auctionId: string,
  rate: string,
  guardian: KeyringPair,
): Promise<void> {
  const signature = u8aToHex(guardian.sign(`${auctionId}:${rate}`));
  await costEstimationClient.post<{ status: "accepted" }>(
    `/auctions/${encodeURIComponent(auctionId)}/bid`,
    { guardian: guardian.address, rate, signature },
  );
}
