import { KeyringPair } from "@polkadot/keyring/types";
import { getKeyring } from "../chain";
import { createAgreement } from "../compute";
import { toAtomicPaliAmount, type PaliAmountInput } from "../utils/token";

export interface DataContractParams {
  /** URL pointing to the data to store. */
  url: string;
  /** Guardian account IDs that participate in this contract. */
  guardians: string[];
  /** Fee offered for the contract in PALI. Defaults to 0. */
  fees?: PaliAmountInput;
  /** Block number deadline. Defaults to 0 (no deadline). */
  deadline?: number;
  /** Trusted guardian index in the guardians list. Defaults to 0. */
  trustIndex?: number;
}

/**
 * Submits a dormant data-store contract on-chain via `compute.agreement`.
 *
 * - No encryption (Plaintext cipher suite)
 * - Trusted confidentiality mode
 * - Input fetched from a URL
 * - No pre-check or post-check verifications
 * - Plain (unencrypted) result
 */
export async function dataContract(params: DataContractParams, account: KeyringPair) {
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
      Url: {
        url: Array.from(new TextEncoder().encode(params.url)),
      },
    },
    program: {
      NativeData: "DaFalse",
    },
  };

  const contract = {
    contract_type: "Dormant" as const,
    guardians: params.guardians,
    pre_check: null,
    compute: computeStep,
    post_check: null,
    result_cipher: plaintextCipher,
  };

  return createAgreement(contract, account);
}
