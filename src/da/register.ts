import { getApi, signAndSend } from "../chain";
import { createAgreement } from "../compute";
import { assert, debugLog } from "../utils";
import { formatPaliAmount } from "../utils/token";
import { CipherSuite, OnChainRef } from "./types";

export async function writeMetadata(
  account: any,
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

export interface DataAgreementMetadata {
  name: string;
  description: string;
  /** Maps to the on-chain StoreType enum. */
  storeType: "Dataset" | "Model" | "Agent" | "Other";
  /** H256 group identifier. */
  groupId: string;
}

export interface DataAgreementParams {
  /** DA blob reference returned by submitTEData. */
  ref: OnChainRef;
  /** Guardian account IDs that participate in this agreement. */
  guardians: { peerid: string; address: string }[];
  /** Fee for the agreement in PALI atomic units. */
  fees: bigint;
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
  account: any,
  params: DataAgreementParams,
) {
  debugLog(
    `Registering data agreement for DA ref ${params.ref.blockNumber}-${params.ref.index} at ${formatPaliAmount(params.fees)}`,
  );

  const cipher = params.cipher ?? "Plaintext";
  const resultCipher = params.resultCipher ?? "Plaintext";
  const encoder = new TextEncoder();
  const computeMetadata = params.metadata
    ? {
        name: Array.from(encoder.encode(params.metadata.name)),
        description: Array.from(encoder.encode(params.metadata.description)),
        store_type: params.metadata.storeType,
        group_id: params.metadata.groupId,
      }
    : null;

  const computeStep = {
    cipher,
    computer_indices: params.guardians.map((_, i) => i),
    fees: params.fees,
    deadline: params.deadline ?? 0,
    confidentiality: {
      Trusted: {
        trust_index: params.trustIndex ?? 0,
      },
    },
    fee_function: null,
    input: {
      ChainTransaction: {
        block_number: params.ref.blockNumber,
        extrinsic_index: params.ref.index,
      },
    },
    program: {
      NativeData: "DaFalse",
    },
    metadata: computeMetadata,
  };

  const contract = {
    contract_type: "Dormant",
    guardians: params.guardians,
    pre_check: null,
    compute: computeStep,
    post_check: null,
    result_cipher: resultCipher,
  };

  return createAgreement(contract, account);
}
