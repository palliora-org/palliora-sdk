import type { PaliAmountInput } from "../utils/token";
import type { API_TYPES } from "./spec";

/** Identifies the currency used for fee payment / contract settlement. Mirrors runtime `primitives::CurrencyId`. */
export type CurrencyId = "Native" | "USDC" | { ForeignAsset: number };

/** Fee terms for a compute step: an absolute amount plus an optional dynamic compute rate. */
export interface Fee {
  /** Absolute fee offered for the compute step, in PALI. Defaults to 0. */
  amount?: PaliAmountInput;
  /** Compute rate used for dynamic fee calculation, in PALI. Defaults to 0. */
  computeRate?: PaliAmountInput;
}

/** On-chain proof that a result extrinsic was included in a block. */
export interface SubmissionReceipt {
  /** Hash of the result extrinsic (hex-encoded, "0x..."). */
  extrinsicHash: string;
  /** Block height at which the result extrinsic was included. */
  blockHeight: number;
  /** Zero-based index of the result extrinsic within the block. */
  extrinsicIndex: number;
}

/** Union of `AgreementStatus` variant names, read straight off {@link API_TYPES} (chain/spec.ts). */
export type AgreementStatus = keyof typeof API_TYPES.AgreementStatus._enum;

/** Union of `ContractType` variant names, read straight off {@link API_TYPES} (chain/spec.ts). */
export type ContractType = keyof typeof API_TYPES.ContractType._enum;

/**
 * On-chain record for an agreement/contract, read back from `compute.agreementsInfo`.
 * Mirrors the `ContractInfo` type registered in {@link API_TYPES} (chain/spec.ts).
 */
export interface ContractInfo {
  /** Current settlement status of the agreement. */
  status: AgreementStatus;
  /** Address of the account that owns the contract. */
  owner: string;
  /** Block number at which the contract originated. */
  originBlock: number;
  /**
   * Number of sessions `compute.invoke` has opened against this contract, and so the
   * index the next one will use. Zero on every non-`Subscription` contract.
   */
  sessionCount: number;
  /** Usage price charged per invocation, in atomic units. */
  usagePrice: bigint;
  /** Contract lifecycle type. */
  contractType: ContractType;
}

/**
 * One usage of a `Subscription` contract, read back from `compute.sessions(sessionId)`.
 * Opened by `compute.invoke` and removed by `compute.result`, so a session that has
 * already been settled reads back as `null`.
 */
export interface SessionInfo {
  /** Contract this session was opened against — the one holding the reserved budget. */
  contractId: string;
  /** Which usage of that contract this is, counting from zero. */
  index: number;
  /** Account that called `compute.invoke`. Always the contract owner. */
  invoker: string;
  /** Block the session opened at; the clock `compute_duration_ms` is measured against. */
  startedBlock: number;
}
