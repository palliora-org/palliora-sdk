import { getApi, signAndSend } from "../chain";
import { createAgreement, buildFee, buildComputeMetadata } from "../compute";
import { assert, debugLog } from "../utils";
import { formatPaliAmount, toAtomicPaliAmount } from "../utils/token";
import { CipherSuite, OnChainRef } from "./types";
import type { Fee } from "../chain/types";
import type { ComputeMetadataInput } from "../compute/agreement";
import type { KeyringPair } from "@polkadot/keyring/types";

export async function writeMetadata(
  account: KeyringPair,
  name: string,
  description: string,
  ref: OnChainRef,
  price: bigint,
  dataType: number,
  l2Owner: string,
  groupId: string,
) {
  const blobRef = [ref.blockNumber, ref.index];
  const encoder = new TextEncoder();
  const nameBytes = Array.from(encoder.encode(name));
  const descriptionBytes = Array.from(encoder.encode(description));
  const ownerBytes = Array.from(encoder.encode(l2Owner));

  const api = await getApi();
  assert(api, "Failed to get API connection");

  debugLog(`Registering metadata for ${name} at ${formatPaliAmount(price)}`);

  const request = api.tx.dataAvailability.daccRegisterData(
    nameBytes,
    descriptionBytes,
    blobRef,
    price,
    dataType,
    ownerBytes,
    groupId,
  );

  const hash = await signAndSend(request, account);

  debugLog(`Metadata registration transaction sent with hash: ${hash.hash}`);

  return hash;
}

/**
 * Metadata for a registered DA blob. The `storeType` union lives in
 * `compute/agreement.ts` so there is one copy to keep in step with the pallet.
 */
export type DataAgreementMetadata = ComputeMetadataInput & {
  /** H256 group identifier. */
  groupId: string;
};

export interface DataAgreementParams {
  /** DA blob reference returned by submitTEData. */
  ref: OnChainRef;
  /** Guardian account IDs that participate in this agreement. */
  guardians: string[];
  /**
   * Absolute fee for the agreement. `computeRate` is omitted: this is a
   * `Dormant` contract and the compute rate only applies to `Active` contracts.
   */
  fee: Pick<Fee, "amount">;
  /** If provided, populates ComputeInfo.metadata in the contract. */
  metadata?: DataAgreementMetadata;
  /** Block number deadline. Defaults to 0 (no deadline). */
  deadline?: number;
  /** Trusted guardian index in the guardians list. Defaults to 0. */
  trustIndex?: number;
  /**
   * CipherSuite for the compute step input. Defaults to "Plaintext".
   * Pass the `cipher` from submitTEDataWithCipher for the threshold-encrypted path.
   */
  cipher?: CipherSuite;
  /**
   * CipherSuite for the agreement result. Defaults to "Plaintext".
   */
  resultCipher?: CipherSuite;
}

export async function registerDataAgreement(
  account: KeyringPair,
  params: DataAgreementParams,
) {
  debugLog(
    `Registering data agreement for DA ref ${params.ref.blockNumber}-${params.ref.index} at ${formatPaliAmount(toAtomicPaliAmount(params.fee.amount ?? "0"))}`,
  );

  const cipher = params.cipher ?? "Plaintext";
  const resultCipher = params.resultCipher ?? "Plaintext";
  const computeMetadata = buildComputeMetadata(params.metadata);

  const computeStep = {
    cipher,
    computerIndices: params.guardians.map((_, i) => i),
    ...buildFee(params.fee),
    deadline: params.deadline ?? 0,
    confidentiality: { Trusted: params.trustIndex ?? 0 },
    feeFunction: null,
    input: {
      ChainTransaction: {
        blockNumber: params.ref.blockNumber,
        extrinsicIndex: params.ref.index,
      },
    },
    program: {
      NativeData: "DaFalse",
    },
    metadata: computeMetadata,
  };

  const contract = {
    contractType: "Dormant" as const,
    guardians: params.guardians,
    preCheck: null,
    compute: computeStep,
    postCheck: null,
    resultCipher,
  };

  return createAgreement(contract, account);
}
