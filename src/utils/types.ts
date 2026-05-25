export type Hex = `0x${string}`;

/**
 * Mirrors the on-chain ComputePayload SCALE type (CheckCompute signed extension).
 * `agreement` is an array of 32-byte guardian peer-ID keys, obtained by
 * base58-decoding the peer ID and stripping the first 6 multiaddr prefix bytes.
 */
export interface ComputePayload {
  /** DA type: 0 = none, 1 = DA. */
  da_type: number;
  /** Guardian agreement keys. Each element is a 32-byte Uint8Array or number[]. */
  agreement?: Uint8Array[] | number[][];
  /** Verification mode. */
  verification: number;
  /** Compute mode. */
  compute: number;
}