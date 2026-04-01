import { getApi, getKeyring, signAndSend } from "../chain";
import { debugLog } from "../utils";

export interface InferenceComputeParams {
  /** Raw input data — string will be UTF-8 encoded, Uint8Array used as-is. */
  input: Uint8Array | string;
  /** Guardian account IDs that participate in this compute. */
  guardians: string[];
  /** Fee offered for the compute step (smallest denomination). Defaults to 0. */
  fees?: number;
  /** Block number deadline for the compute step. Defaults to 0 (no deadline). */
  deadline?: number;
  /** Options passed to signAndSend (e.g. compute payload overrides). */
  opts?: Record<string, any>;
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
  const api = await getApi();
  if (!api) throw new Error("Api not initialized");

  const keyring = await getKeyring();
  const account = keyring.getPairs()[0];

  const inputData =
    typeof params.input === "string"
      ? Array.from(new TextEncoder().encode(params.input))
      : Array.from(params.input);

  // No encryption — use the Plaintext variant of CipherSuite.
  const plaintextCipher = "Plaintext";

  // Primary compute step: inline input + native inference execution.
  const computeStep = {
    cipher: plaintextCipher,
    computer_indices: params.guardians.map((_, i) => i),
    fees: params.fees ?? 0,
    deadline: params.deadline ?? 0,
    confidentiality: { Trusted: { trust_index: 0 } },
    fee_function: null,
    input: { Inline: { data: inputData } },
    program: { NativeExecute: "Inference" },
  };

  const contract = {
    contract_type: "Active",
    guardians: params.guardians,
    compute: computeStep,
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
        "Inference agreement created:",
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
