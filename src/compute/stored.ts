import { KeyringPair } from "@polkadot/keyring/types";
import { createAgreement, buildFee, buildComputeMetadata } from "../compute";
import { assert } from "../utils";
import type { Fee } from "../chain/types";
import type { ComputeMetadataInput } from "./agreement";

export interface StoredComputeParams {
  /** Guardian account IDs that participate in this compute. */
  guardians: string[];
  /** Contract ID of the `Dormant` contract registering the program. */
  programContractId: string;
  /** Contract ID of the `Dormant` contract registering the input data. */
  inputContractId: string;
  /**
   * Fee offered for the compute step. Must clear the floor returned by
   * `estimateMinFee({ computeRate, inputContractId })` — referencing a stored
   * input raises that floor by the input contract's usage price.
   */
  fee: Fee;
  /** Describes this execution. Unlike the contracts it references, it registers
   * nothing — so `storeType` is `"Other"` unless the run itself produces a
   * classifiable artifact. */
  metadata?: ComputeMetadataInput;
  /** Block number deadline for the compute step. Defaults to 0 (no deadline). */
  deadline?: number;
  /** Trusted guardian index in the guardians list. Defaults to 0. */
  trustIndex?: number;
}

/**
 * Submits an `Active` agreement whose program and input both live in contracts
 * already registered on-chain.
 *
 * Where {@link simpleCompute} carries the program as a URL and the input as a
 * block coordinate, this points at two `Dormant` contracts instead. Each
 * `{ ContractId: { id } }` resolves to that contract's `compute.input` — the
 * field {@link dataContract} stores an artifact in — so the program contract
 * supplies the image and the input contract supplies the data.
 *
 * Only the `input` reference is billed: settlement pays the input contract's
 * owner its `usage_price`, which is why that ID is also what
 * `estimateMinFee` needs to quote the floor.
 */
export async function storedCompute(params: StoredComputeParams, account: KeyringPair) {
  assert(!!params.programContractId, "storedCompute requires a programContractId");
  assert(!!params.inputContractId, "storedCompute requires an inputContractId");

  const plaintextCipher = "Plaintext";
  const computeStep = {
    cipher: plaintextCipher,
    computerIndices: params.guardians.map((_, i) => i),
    ...buildFee(params.fee),
    deadline: params.deadline ?? 0,
    confidentiality: { Trusted: params.trustIndex ?? 0 },
    feeFunction: null,
    input: { ContractId: { id: params.inputContractId } },
    program: { ContractId: { id: params.programContractId } },
    metadata: buildComputeMetadata(params.metadata),
  };

  const contract = {
    contractType: "Active" as const,
    guardians: params.guardians,
    preCheck: null,
    compute: computeStep,
    postCheck: null,
    resultCipher: plaintextCipher,
  };

  return createAgreement(contract, account);
}
