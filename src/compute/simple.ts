import { getApi, getKeyring, signAndSend } from "../chain";
import { debugLog } from "../utils";

export interface SimpleComputeParams {
  /** Guardian account IDs that participate in this compute. */
  guardians: string[];
  /** Input reference block number from which to read the tx payload. */
  inputBlockNumber: number;
  /** Input reference extrinsic index within the input block. */
  inputExtrinsicIndex: number;
  /** Program location as URL. */
  programUrl: string;
  /** Fee offered for the compute step (smallest denomination). Defaults to 0. */
  fees?: number;
  /** Block number deadline for the compute step. Defaults to 0 (no deadline). */
  deadline?: number;
  /** Trusted guardian index in the guardians list. Defaults to 0. */
  trustIndex?: number;
  /** Options passed to signAndSend (e.g. compute payload overrides). */
  opts?: Record<string, any>;
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
  const api = await getApi();
  if (!api) throw new Error("Api not initialized");

  const keyring = await getKeyring();
  const account = keyring.getPairs()[0];

  const plaintextCipher = "Plaintext";
  const computeStep = {
    cipher: plaintextCipher,
    computer_indices: params.guardians.map((_, i) => i),
    fees: params.fees ?? 0,
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

  const tx = (api.tx as any).compute.agreement(contract);
  const { tx_result, blockNumber, index, hash } = await signAndSend(
    tx,
    account,
    params.opts as any,
  );

  if (!tx_result.isError) {
    const agreementEvent = tx_result.events.find(
      (event: any) =>
        event.event.section === "compute" &&
        event.event.method === "AgreementCreated",
    );

    if (agreementEvent) {
      debugLog("Simple compute agreement created:", agreementEvent.event.data.toString());
      return {
        blockNumber,
        index,
        hash,
        agreementId:
          agreementEvent.event.data[0]?.toHex?.() ??
          agreementEvent.event.data.toString(),
      };
    }
  }

  return { blockNumber, index, hash };
}
