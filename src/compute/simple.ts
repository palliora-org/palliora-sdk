import { getKeyring } from "../chain";
import { createAgreement } from "../compute";
import { toAtomicPaliAmount, type PaliAmountInput } from "../utils/token";

export interface SimpleComputeParams {
  /** Guardian account IDs that participate in this compute. */
  guardians: { peerid: string; address: string }[];
  /** Input reference block number from which to read the tx payload. */
  inputBlockNumber: number;
  /** Input reference extrinsic index within the input block. */
  inputExtrinsicIndex: number;
  /** Program location as URL. */
  programUrl: string;
  /** Fee offered for the compute step in PALI. Defaults to 0. */
  fees?: PaliAmountInput;
  /** Block number deadline for the compute step. Defaults to 0 (no deadline). */
  deadline?: number;
  /** Trusted guardian index in the guardians list. Defaults to 0. */
  trustIndex?: number;
}

/**
 * Submits a minimal trusted compute agreement:
 * - no encryption (plaintext cipher)
 * - trusted confidentiality mode
 * - input from chain transaction reference
 * - program fetched from URL
 * - no pre/post verification
 */
export async function simpleCompute(params: SimpleComputeParams) {
  const keyring = await getKeyring();
  const account = keyring.getPairs()[0];

  const plaintextCipher = "Plaintext";
  const atomicFees = toAtomicPaliAmount(params.fees ?? "0");
  const computeStep = {
    cipher: plaintextCipher,
    computer_indices: params.guardians.map((_, i) => i),
    fees: atomicFees,
    deadline: params.deadline ?? 0,
    confidentiality: {
      Trusted: {
        trust_index: params.trustIndex ?? 0,
      },
    },
    fee_function: null,
    input: {
      ChainTransaction: {
        block_number: params.inputBlockNumber,
        extrinsic_index: params.inputExtrinsicIndex,
      },
    },
    program: {
      Url: {
        url: Array.from(new TextEncoder().encode(params.programUrl)),
      },
    },
  };

  const contract = {
    contract_type: "Active",
    guardians: params.guardians,
    pre_check: null,
    compute: computeStep,
    post_check: null,
    result_cipher: plaintextCipher,
  };

  return createAgreement(contract, account);
}
