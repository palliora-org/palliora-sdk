
/** On-chain proof that a result extrinsic was included in a block. */
export interface SubmissionReceipt {
  /** Hash of the result extrinsic (hex-encoded, "0x..."). */
  extrinsicHash: string;
  /** Block height at which the result extrinsic was included. */
  blockHeight: number;
  /** Zero-based index of the result extrinsic within the block. */
  extrinsicIndex: number;
}
