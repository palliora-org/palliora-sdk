import { KeyringPair } from "@polkadot/keyring/types";
import { getKeyring } from "../chain";
import { createAgreement, buildFee, buildComputeMetadata } from "../compute";
import { assert } from "../utils";
import type { Fee } from "../chain/types";
import type { ComputeMetadataInput } from "./agreement";

export interface DataContractParams {
  /** URL pointing to the data to store. Mutually exclusive with `data`. */
  url?: string;
  /**
   * Bytes carried in the extrinsic itself, for payloads small enough not to
   * warrant off-chain hosting. Mutually exclusive with `url`.
   */
  data?: string | Uint8Array;
  /** Guardian account IDs that participate in this contract. */
  guardians: string[];
  /**
   * Absolute fee offered for the contract. Defaults to 0.
   * `computeRate` is omitted: this is a `Dormant` contract and the
   * compute rate only applies to `Active` contracts.
   */
  fee: Fee;
  /**
   * Describes the registered artifact — name, description, and the `storeType`
   * saying what kind of thing it is. Omitted metadata registers the contract
   * anonymously, which leaves nothing on-chain to tell a stored dataset from a
   * stored program.
   */
  metadata?: ComputeMetadataInput;
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
 * - Input fetched from a URL, or carried inline in the extrinsic
 * - No pre-check or post-check verifications
 * - Plain (unencrypted) result
 *
 * The artifact goes in `compute.input` and `compute.program` stays inert: a
 * `Dormant` contract registers something rather than running it. A later
 * `Active` contract reaches this artifact with `{ ContractId: { id } }`, in
 * either its own `input` or its `program`, and pays this contract's owner the
 * `fee` offered here as the usage price.
 */
export async function dataContract(params: DataContractParams, account: KeyringPair) {
  const plaintextCipher = "Plaintext";
  assert(
    (params.url === undefined) !== (params.data === undefined),
    "dataContract requires exactly one of `url` or `data`",
  );

  const input =
    params.url !== undefined
      ? { Url: { url: Array.from(new TextEncoder().encode(params.url)) } }
      : {
          Inline: {
            data: Array.from(
              typeof params.data === "string"
                ? new TextEncoder().encode(params.data)
                : (params.data as Uint8Array),
            ),
          },
        };

  const computeStep = {
    cipher: plaintextCipher,
    computerIndices: params.guardians.map((_, i) => i),
    ...buildFee(params.fee),
    deadline: params.deadline ?? 0,
    confidentiality: { Trusted: params.trustIndex ?? 0 },
    feeFunction: null,
    input,
    program: {
      NativeData: "DaFalse",
    },
    metadata: buildComputeMetadata(params.metadata),
  };

  const contract = {
    contractType: "Dormant" as const,
    guardians: params.guardians,
    preCheck: null,
    compute: computeStep,
    postCheck: null,
    resultCipher: plaintextCipher,
  };

  return createAgreement(contract, account);
}
