import { getApi, getKeyring, signAndSend } from "../chain";
import { debugLog } from "../utils";

export interface DataContractParams {
  /** URL pointing to the data to store. */
  url: string;
  /** Guardian account IDs that participate in this contract. */
  guardians: string[];
  /** Fee offered for the contract (smallest denomination). Defaults to 0. */
  fees?: number;
  /** Block number deadline. Defaults to 0 (no deadline). */
  deadline?: number;
  /** Trusted guardian index in the guardians list. Defaults to 0. */
  trustIndex?: number;
  /** Options passed to signAndSend. */
  opts?: Record<string, any>;
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
export async function dataContract(params: DataContractParams) {
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
      Url: {
        url: Array.from(new TextEncoder().encode(params.url)),
      },
    },
    program: {
      NativeData: "DaFalse",
    },
  };

  const contract = {
    contract_type: "Dormant",
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
      debugLog(
        "Data contract agreement created:",
        agreementEvent.event.data.toString(),
      );
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
