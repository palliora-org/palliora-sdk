import { getApi, getGuardianAddress, getKeyring, signAndSend } from "../chain";
import { assert, debugLog, toAtomicPaliAmount } from "../utils";
import type { KeyringPair } from "@polkadot/keyring/types";
import type { SubmittableExtrinsic } from "@polkadot/api/types";
import type { GuardianAddress } from "../da/types";

export interface ComputeContract {
  contract_type: "Active" | "Dormant";
  guardians: GuardianAddress[];
  pre_check?: unknown;
  compute: Record<string, unknown>;
  post_check?: unknown;
  result_cipher: unknown;
}

export async function createAgreement(
  contract: ComputeContract,
  account: KeyringPair,
): Promise<{
  blockNumber: number;
  index: number;
  hash: string;
  agreementId?: string;
}> {
  const api = await getApi();
  if (!api) throw new Error("Api not initialized");

  const tx = (
    api.tx as Record<
      string,
      Record<string, (...args: unknown[]) => SubmittableExtrinsic<"promise">>
    >
  )["compute"]["agreement"](contract);
  const opts = {
    compute: {
      da_type: 1,
      verification: 0,
      compute: contract.contract_type === "Active" ? 1 : 0,
    },
  };

  const { tx_result, blockNumber, index, hash } = await signAndSend(
    tx,
    account,
    opts,
  );

  if (!tx_result.isError) {
    const agreementCreatedEvent = tx_result.events.find(
      (event: {
        event: { section: string; method: string; data: unknown[] };
      }) => {
        return (
          event.event.section === "compute" &&
          event.event.method === "AgreementCreated"
        );
      },
    );

    if (agreementCreatedEvent) {
      debugLog("Agreement data:", agreementCreatedEvent.event.data.toString());
      return {
        blockNumber,
        index: index ?? 0,
        hash,
        agreementId:
          agreementCreatedEvent.event.data[0]?.toHex?.() ??
          agreementCreatedEvent.event.data.toString(),
      };
    } else {
      debugLog("AgreementCreated event not found");
    }
  }

  return { blockNumber, index: index ?? 0, hash };
}

export async function createSimpleAgreement() {
  const guardianIds = (await getGuardianAddress())
    .slice(0, 3)
    .map((g) => g.address);
  assert(guardianIds.length === 3, "Not enough guardians to create agreement");

  const contract = {
    contract_type: "Dormant" as const,
    guardians: guardianIds,
    pre_check: null,
    compute: {
      cipher: "Plaintext",
      computer_indices: [0, 1, 2],
      fees: toAtomicPaliAmount("0.01") ,
      deadline: 0,
      confidentiality: { Trusted: 0 },
      fee_function: null,
      input: null,
      program: { NativeData: "DaFalse" },
      metadata: null,
    },
    post_check: null,
    result_cipher: "Plaintext",
  };

  const keyring = await getKeyring();
  const account = keyring.getPairs()[0];

  return createAgreement(contract, account);
}

export default createSimpleAgreement;
