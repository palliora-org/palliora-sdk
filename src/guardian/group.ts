import { getApi, getGuardianNwParams, signAndSend, scanForBlockEvent } from "../chain";
import { GuardianGroupInfo } from "..";
import { hexToUint8Array, debugLog, assert } from "../utils";
import type { KeyringPair } from "@polkadot/keyring/types";
import type { GuardianAddress } from "../da/types";

export const createGuardianGroup = async (account: KeyringPair, selectedGuardians: GuardianAddress[]) => {
  try {
    const api = await getApi();

    assert(selectedGuardians.length >= 3, "Not enough guardians available to create a group");
    assert(account, "Failed to load account");
    assert(api, "Failed to initialize API");

    const tau_params = await getGuardianNwParams();
    assert(tau_params && tau_params !== "", "Failed to retrieve guardian network parameters");

    // For simplicity, select the first 3 guardians
    debugLog(`Selected guardians: ${selectedGuardians.join(", ")} and tau_params: ${tau_params}`);

    // Create and send the transaction
    const tx = api.tx.dataAvailability.daccGuardianGroup(
      selectedGuardians,
      Array.from(hexToUint8Array(tau_params as `0x${string}`)) // Use the new helper function
    );
    const result = await signAndSend(tx, account);

    debugLog("Guardian group created:", result);
    return result;
  } catch (error) {
    console.error("Error creating guardian group:", error);
    throw new Error(`Failed to create guardian group: ${error instanceof Error ? error.message : error}`);
  }
};

/**
 * Creates a guardian group with exactly 3 guardians, waits for tx confirmation,
 * then watches incoming blocks for the `DaccGuardianGroup` event (emitted by a
 * subsequent `daccGuardianGroupInfo` extrinsic) and returns the decoded args.
 *
 * @param account    Signing account
 * @param guardians  Exactly 3 guardian addresses / peer-ids
 * @param maxBlocks  Give up waiting for the event after this many blocks; 0 = indefinite (default 20)
 */
export const createGuardianGroupAndWatch = async (
  account: KeyringPair,
  guardians: GuardianAddress[],
  maxBlocks = 20
): Promise<GuardianGroupInfo> => {
  assert(guardians.length === 3, "Exactly 3 guardians are required");
  assert(account, "Failed to load account");

  const api = await getApi();
  assert(api, "Failed to initialize API");

  debugLog(`Submitting guardian group creation...`);
  // daccGuardianGroup emits DaccGuardianGroup with empty group_pk/tau_params/agg_key.
  // Start listening from the next block so we only catch the DaccGuardianGroup event
  // emitted by the subsequent daccGuardianGroupInfo extrinsic.
  const creationResult = await createGuardianGroup(account, guardians);
  const startBlock: number = (creationResult?.blockNumber ?? 0) + 1;
  debugLog(`Group creation tx confirmed at block ${startBlock - 1}. Listening for DaccGuardianGroup event from block ${startBlock}...`);

  const match = await scanForBlockEvent(
    api,
    {
      predicate: async (block, event, phase) => {
        if (
          event.section.toLowerCase() !== "dataavailability" ||
          event.method.toLowerCase() !== "daccguardiangroup"
        ) return false;
        if (!phase.isApplyExtrinsic) return false;
        const ext = block.block.extrinsics[phase.asApplyExtrinsic.toNumber()];
        return (
          ext?.method?.section?.toLowerCase() === "dataavailability" &&
          ext?.method?.method?.toLowerCase() === "daccguardiangroupinfo"
        );
      },
    },
    startBlock,
    maxBlocks
  );

  // Block is pre-fetched by scanForBlockEvent when using predicate mode
  assert(match.extrinsicIndex !== null, "DaccGuardianGroup event was not emitted by an extrinsic");
  debugLog(`DaccGuardianGroup event found at block ${match.blockNumber}, extrinsic index ${match.extrinsicIndex}. Decoding args...`);

  const block = await match.block();
  const ext = block.block.extrinsics[match.extrinsicIndex];

  // daccGuardianGroupInfo(group_id: H256, group_pk: AppData, tau_params: AppData, agg_key: AppData)
  const [group_id, group_pk, tau_params, agg_key] = ext.method.args;
  debugLog(`Guardian group parameters decoded: group_id=${group_id.toHex()}`);

  return {
    groupId: group_id.toHex(),
    groupPk: group_pk.toHex(),
    tauParams: tau_params.toHex(),
    aggKey: agg_key.toHex(),
    guardians,
  };
};
