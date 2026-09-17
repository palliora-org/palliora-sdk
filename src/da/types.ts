import type { PaliAmountInput } from "../utils/token";
import type { ComputePayload } from "../utils/types";

export interface OnChainRef {
  blockNumber: number;
  index: number;
}

export interface SilentThresholdParams {
  /** Encoded threshold ciphertext bytes (from encodeCiphertext). */
  tdParams: number[];
  /** Guardian group aggregate public key bytes. */
  pkBytes: number[];
  /** KZG powers-of-tau bytes. */
  tauParams: number[];
}

export type ThresholdParams = { SilentThreshold: SilentThresholdParams };

export type SymmetricParams =
  | { ChaCha20Poly1305: { nonce: number[] } }
  | { Aes256Gcm: { nonce: number[] } };

export type KdfParams = "HkdfSha256" | "HkdfSha512";

export interface Secp256k1Params {
  recipientPublicKey: number[];
  ephemeralPublicKey?: number[] | null;
  compressed: boolean;
  kdf: KdfParams;
  salt?: number[] | null;
  info?: number[] | null;
}

export interface Ed25519Params {
  recipientPublicKey: number[];
  ephemeralPublicKey?: number[] | null;
  kdf: KdfParams;
  salt?: number[] | null;
  info?: number[] | null;
}

export type AsymmetricParams =
  | { Secp256k1: Secp256k1Params }
  | { Ed25519: Ed25519Params };

export interface ThresholdHybridParams {
  thresholdParams: ThresholdParams;
  symmetricParams: SymmetricParams;
}

export interface AsymmetricHybridParams {
  asymmetricParams: AsymmetricParams;
  symmetricParams: SymmetricParams;
}

/** Mirrors the on-chain CipherSuite enum from spec.ts. */
export type CipherSuite =
  | "Plaintext"
  | { ThresholdHybrid: ThresholdHybridParams }
  | { AsymmetricHybrid: AsymmetricHybridParams };

export interface SubmitTEDataResult {
  ref: OnChainRef;
  cipher: CipherSuite;
}

export type GuardianAddress = string;

export interface GuardianGroupInfo {
  groupId: string;
  guardians: GuardianAddress[];
  tauParams: string;
  aggKey: string;
  groupPk: string;
}

export interface UploadOptions {
  name: string;
  description: string;
  price: PaliAmountInput;
  type: "model" | "dataset" | "agent" | "executable";
  guardianGroupInfo: GuardianGroupInfo;
  ref?: string;
  filePath?: string;
  /** Options forwarded to signAndSend. Defaults to dormant DA payload (daType=1, compute=0). */
  opts?: { compute: ComputePayload };
}
