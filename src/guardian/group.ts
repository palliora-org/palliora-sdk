import { getApi, getGuardianNwParams, signAndSend, scanForBlockEvent, fetchAndDecodeExtrinsic } from "../chain";
import { GuardianGroupInfo, OnChainRef } from "..";
import { hexToUint8Array, debugLog, assert } from "../utils";
import type { KeyringPair } from "@polkadot/keyring/types";
import type { ApiPromise } from "@polkadot/api";
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

/**
 * Walks blocks forward from `startBlock`, fetching each directly via RPC (not a
 * live subscription), looking for the first `dataAvailability.daccGuardianGroupInfo`
 * extrinsic. Needed because {@link scanForBlockEvent} only observes new block headers
 * and cannot find an extrinsic that already landed on-chain.
 *
 * @param maxBlocks  Give up after scanning this many blocks; 0 = scan to current chain tip
 */
async function findGuardianGroupInfoExtrinsic(
  api: ApiPromise,
  startBlock: number,
  maxBlocks: number
): Promise<OnChainRef> {
  const tip = (await api.rpc.chain.getHeader()).number.toNumber();
  const endBlock = maxBlocks > 0 ? Math.min(startBlock + maxBlocks - 1, tip) : tip;

  for (let blockNumber = startBlock; blockNumber <= endBlock; blockNumber++) {
    const blockHash = await api.rpc.chain.getBlockHash(blockNumber);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const signedBlock: any = await api.rpc.chain.getBlock(blockHash);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const extrinsics: any[] = signedBlock.block.extrinsics;

    for (let index = 0; index < extrinsics.length; index++) {
      const ext = extrinsics[index];
      if (
        ext?.method?.section?.toLowerCase() === "dataavailability" &&
        ext?.method?.method?.toLowerCase() === "daccguardiangroupinfo"
      ) {
        return { blockNumber, index };
      }
    }
  }

  throw new Error(
    `No daccGuardianGroupInfo extrinsic found in blocks ${startBlock}-${endBlock} ` +
      `(searched ${Math.max(endBlock - startBlock + 1, 0)} block(s) after the creation extrinsic)`
  );
}

/**
 * Reconstructs a guardian group's full crypto params from the two on-chain
 * extrinsics that together define it. There is no direct RPC to query group
 * info by ID, so this reads it back from where it was written:
 *
 * - `dataAvailability.daccGuardianGroup(selectedGuardians, tauParams)` — the
 *   creation extrinsic; carries the guardian list.
 * - `dataAvailability.daccGuardianGroupInfo(groupId, groupPk, tauParams, aggKey)`
 *   — the result extrinsic (submitted separately once the group's crypto
 *   params are computed); carries the actual group_id/group_pk/tau_params/agg_key.
 *
 * `groupId` isn't a required input — like {@link createGuardianGroupAndWatch},
 * it's derived from decoding the result extrinsic, not supplied by the caller.
 *
 * @param creationRef  Block number + extrinsic index of the group creation extrinsic
 * @param resultRef    Block number + extrinsic index of the group creation result
 *                      extrinsic. If omitted, blocks are scanned forward from
 *                      `creationRef` to find it (see `maxBlocks`).
 * @param maxBlocks    Only used when `resultRef` is omitted. Give up scanning after
 *                      this many blocks; 0 = scan to current chain tip (default 20)
 */
export const getGuardianGroupInfo = async (
  creationRef: OnChainRef,
  resultRef?: OnChainRef,
  maxBlocks = 20
): Promise<GuardianGroupInfo> => {
  assert(creationRef, "Group creation extrinsic reference is required");

  const api = await getApi();
  assert(api, "Failed to initialize API");

  debugLog(`Reading guardian group creation extrinsic at block ${creationRef.blockNumber}, index ${creationRef.index}...`);
  const { raw: creationExt } = await fetchAndDecodeExtrinsic(creationRef.blockNumber, creationRef.index);
  assert(
    creationExt?.method?.section?.toLowerCase() === "dataavailability" &&
      creationExt?.method?.method?.toLowerCase() === "daccguardiangroup",
    `Extrinsic at block ${creationRef.blockNumber}, index ${creationRef.index} is not a daccGuardianGroup call ` +
      `(found ${creationExt?.method?.section}.${creationExt?.method?.method})`
  );

  // daccGuardianGroup(selected_guardians: Vec<GuardianAddress>, tau_params: AppData)
  const [selectedGuardiansArg] = creationExt.method.args;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const guardians = (Array.from(selectedGuardiansArg) as any[]).map((g) => g.toString()) as GuardianAddress[];
  debugLog(`Guardian group creation extrinsic decoded: guardians=${guardians.join(", ")}`);

  const resolvedResultRef =
    resultRef ??
    (await (async () => {
      debugLog(
        `No result extrinsic reference given, scanning forward from block ${creationRef.blockNumber + 1} for daccGuardianGroupInfo...`
      );
      return findGuardianGroupInfoExtrinsic(api, creationRef.blockNumber + 1, maxBlocks);
    })());

  debugLog(`Reading guardian group result extrinsic at block ${resolvedResultRef.blockNumber}, index ${resolvedResultRef.index}...`);
  const { raw: resultExt } = await fetchAndDecodeExtrinsic(resolvedResultRef.blockNumber, resolvedResultRef.index);
  assert(
    resultExt?.method?.section?.toLowerCase() === "dataavailability" &&
      resultExt?.method?.method?.toLowerCase() === "daccguardiangroupinfo",
    `Extrinsic at block ${resolvedResultRef.blockNumber}, index ${resolvedResultRef.index} is not a daccGuardianGroupInfo call ` +
      `(found ${resultExt?.method?.section}.${resultExt?.method?.method})`
  );

  // daccGuardianGroupInfo(group_id: H256, group_pk: AppData, tau_params: AppData, agg_key: AppData)
  const [group_id, group_pk, tau_params, agg_key] = resultExt.method.args;
  debugLog(`Guardian group result extrinsic decoded: group_id=${group_id.toHex()}`);

  return {
    groupId: group_id.toHex(),
    groupPk: group_pk.toHex(),
    tauParams: tau_params.toHex(),
    aggKey: agg_key.toHex(),
    guardians,
  };
};
