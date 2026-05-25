import type { PaliAmountInput } from "../utils/token";
import type { ComputePayload } from "../utils/types";

export interface OnChainRef {
  blockNumber: number;
  index: number;
}

export interface SilentThresholdParams {
  /** Encoded threshold ciphertext bytes (from encodeCiphertext). */
  td_params: number[];
  /** Guardian group aggregate public key bytes. */
  pk_bytes: number[];
  /** KZG powers-of-tau bytes. */
  tau_params: number[];
}

export type ThresholdAlgos = { SilentThreshold: SilentThresholdParams };

export type SymmetricAlgos =
  | { ChaCha20Poly1305: { nonce: number[] } }
  | { Aes256Gcm: { nonce: number[] } };

export interface CipherSuiteEncrypted {
  threshold: ThresholdAlgos;
  symmetric: SymmetricAlgos;
}

/** Mirrors the on-chain CipherSuite enum from spec.ts. */
export type CipherSuite = "Plaintext" | { Encrypted: CipherSuiteEncrypted };

export interface SubmitTEDataResult {
  ref: OnChainRef;
  cipher: CipherSuite;
}

export interface GuardianGroupInfo {
  groupId: string;
  guardians: any[];
  tauParams: string;
  aggKey: string;
  groupPk: string;
}

export interface UploadOptions {
  name: string;
  description: string;
  price: PaliAmountInput;
  type: "model" | "dataset" | "agent";
  guardianGroupInfo: GuardianGroupInfo;
  ref?: string;
  filePath?: string;
  /** Options forwarded to signAndSend. Defaults to dormant DA payload (da_type=1, compute=0). */
  opts?: { compute: ComputePayload };
}
