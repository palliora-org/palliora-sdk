import bs58 from "bs58";
import { getApi, getGuardianAddress, getKeyring, signAndSend } from "../chain";
import { assert, debugLog } from "../utils";

export async function createAgreement(
  contract: any,
  account: any,
): Promise<{ blockNumber: any; index: any; hash: any; agreementId?: string }> {
  const api = await getApi();
  if (!api) throw new Error("Api not initialized");

  const guardians = contract.guardians as { peerid: string; address: string }[];
  const agreement = guardians.map((g) => bs58.decode(g.peerid).subarray(6));
  const txContract = {
    ...contract,
    guardians: guardians.map((g) => g.address),
  };
  const tx = (api.tx as any).compute.agreement(txContract);
  const opts = {
    compute: {
      da_type: 1,
      agreement,
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
    const agreementCreatedEvent = tx_result.events.find((event: any) => {
      return (
        event.event.section === "compute" &&
        event.event.method === "AgreementCreated"
      );
    });

    if (agreementCreatedEvent) {
      debugLog(
        "Agreement data:",
        agreementCreatedEvent.event.data.toString(),
      );
      return {
        blockNumber,
        index,
        hash,
        agreementId:
          agreementCreatedEvent.event.data[0]?.toHex?.() ??
          agreementCreatedEvent.event.data.toString(),
      };
    } else {
      debugLog("AgreementCreated event not found");
    }
  }

  return { blockNumber, index, hash };
}

export async function createSimpleAgreement() {
  const guardianIds = (await getGuardianAddress()).slice(0, 3);
  assert(guardianIds.length === 3, "Not enough guardians to create agreement");

  const contract = {
    contract_type: "Dormant",
    guardians: guardianIds,
    pre_check: null,
    compute: {
      cipher: "Plaintext",
      computer_indices: [0, 1, 2],
      fees: 0n,
      deadline: 0,
      confidentiality: { Trusted: { trust_index: 0 } },
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
