import { getKeyring } from "../chain";
import { createAgreement } from "../compute";
import { toAtomicPaliAmount, type PaliAmountInput } from "../utils/token";

export interface InferenceComputeParams {
  /** Raw input data — string will be UTF-8 encoded, Uint8Array used as-is. */
  input: Uint8Array | string;
  /** Guardian account IDs that participate in this compute. */
  guardians: string[];
  /** Fee offered for the compute step in PALI. Defaults to 0. */
  fees?: PaliAmountInput;
  /** Block number deadline for the compute step. Defaults to 0 (no deadline). */
  deadline?: number;
}

/**
 * Submits a plain (unencrypted, no-confidentiality) inference compute request
 * on-chain via the `compute.agreement` extrinsic.
 *
 * - Input is sent inline (no DA layer indirection).
 * - Program is the native `Inference` executor.
 * - Pre-check and post-check are no-ops (no verification).
 * - Cipher fields carry zero-value placeholders (unused in the trusted path).
 * - Result is returned in plain (no re-encryption).
 */
export async function inferenceCompute(params: InferenceComputeParams) {
  const keyring = await getKeyring();
  const account = keyring.getPairs()[0];

  const inputData =
    typeof params.input === "string"
      ? Array.from(new TextEncoder().encode(params.input))
      : Array.from(params.input);
  const atomicFees = toAtomicPaliAmount(params.fees ?? "0");

  // No encryption — use the Plaintext variant of CipherSuite.
  const plaintextCipher = "Plaintext";

  // Primary compute step: inline input + native inference execution.
  const computeStep = {
    cipher: plaintextCipher,
    computer_indices: params.guardians.map((_, i) => i),
    fees: atomicFees,
    deadline: params.deadline ?? 0,
    confidentiality: { Trusted: { trust_index: 0 } },
    fee_function: null,
    input: { Inline: { data: inputData } },
    program: { NativeExecute: "Inference" },
  };

  const contract = {
    contract_type: "Active" as const,
    guardians: params.guardians,
    compute: computeStep,
    result_cipher: plaintextCipher,
  };

  return createAgreement(contract, account);
}
