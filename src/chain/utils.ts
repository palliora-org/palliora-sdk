import { TX_WAIT_FINALIZATION } from "../config";
import { getApi } from "./singleton";
import { isFunction } from "@polkadot/util";
import { DEFAULT_COMPUTE_PAYLOAD } from "./spec";
import bs58 from "bs58";
import { getGuardianList } from "../guardian";
import { assert, debugLog } from "../utils";
import type { KeyringPair } from "@polkadot/keyring/types";
import type { SubmittableExtrinsic } from "@polkadot/api/types";
import type { ISubmittableResult } from "@polkadot/types/types";
import type { EventRecord } from "@polkadot/types/interfaces";
import type { ApiPromise } from "@polkadot/api";
import type { Header, SignedBlock } from "@polkadot/types/interfaces";

/** ISubmittableResult extended with the concrete blockNumber present after finalization */
interface SubmittableResultExtended extends ISubmittableResult {
  readonly blockNumber?: { toNumber(): number };
}

export const signAndSend = async (request: SubmittableExtrinsic<'promise'>, account: KeyringPair, opts: Record<string, unknown> = DEFAULT_COMPUTE_PAYLOAD) => {
  const tx_result: SubmittableResultExtended = await new Promise((res, err) => {
    // opts contains custom chain-specific fields (da_type, compute, etc.) that extend SignerOptions
    request.signAndSend(account, opts as Parameters<typeof request.signAndSend>[1], (result: SubmittableResultExtended) => {
      // console.trace(result.toHuman());
      if (result.isFinalized) {
        res(result);
      }
      if (!TX_WAIT_FINALIZATION && result.isInBlock) {
        res(result);
      }
      if (result.isError) err(result);
    });
  });
  // console.trace(tx_result.toHuman());

  if (tx_result.isError) {
    throw new Error(`Transaction failed with error: ${tx_result.dispatchError}`);
  }

  if (tx_result.dispatchError) {
    throw new Error(
      `Transaction dispatched with error: ${tx_result.dispatchError}`
    );
  }

  console.debug(
    `Transaction ${tx_result.txHash.toHex()} included in timepoint ${
      tx_result.blockNumber
    }-${tx_result.txIndex}`
  );

  return {
    blockNumber: tx_result.blockNumber?.toNumber() ?? 0,
    index: tx_result.txIndex ?? 0,
    hash: tx_result.txHash.toHex(),
    tx_result: tx_result as ISubmittableResult,
  };
};

export const getFileMetadataCall = async (
  api: ApiPromise,
  metadataRef: [number, number]
) => {
  const block = await getBlock(api, metadataRef[0]);
  const call = block.block.extrinsics[metadataRef[1]];
  return call.method;
};

const getBlock = async (api: ApiPromise, blockNumber: number) => {
  const blockHash = await api.rpc.chain.getBlockHash(blockNumber);
  return await api.rpc.chain.getBlock(blockHash);
};

export const getGuardianAddress = async () => {
  const api = await getApi();

  if (!api) throw new Error("API not initialized");
  assert(
    isFunction(api.query["guardian"]?.["workerByKey"]),
    `api.query.guardian.workerByKey does not exist`,
  );

  const list = await getGuardianList();

  const addresses = await Promise.all(
    list.map(async (item) => {
      const peerid = bs58.decode(item).slice(6, 38);
      return ((await api.query["guardian"]["workerByKey"](peerid)).toString());
    })
  );

  return list.map((peerid, index) => ({ peerid, address: addresses[index] }));
};

export const getGuardianNwParams = async () => {
  try {
    const api = await getApi();
    if (!api) throw new Error("API not initialized");

    const rpc = api.rpc as unknown as Record<
      string,
      Record<string, (...params: unknown[]) => Promise<unknown>>
    >;
    const section = "guardian";
    const method = "guardianNwParams";

    assert(
      isFunction(rpc[section]?.[method]),
      `api.rpc.${section}.guardianNwParams does not exist`
    );

    const guardianNwParams = (await rpc[section][method]()) as Record<
      string,
      unknown
    >;
    if (
      typeof guardianNwParams === "object" &&
      guardianNwParams !== null &&
      "kzg" in guardianNwParams
    ) {
      return (guardianNwParams.kzg as { toHex(): string }).toHex().slice(2);
    } else {
      throw new Error(`Invalid ${guardianNwParams} format`);
    }
  } catch (error) {
    console.error({ error });
    throw error;
  }
};

export type BlockScanFilter =
  | {
      /** Pallet name, e.g. "dataAvailability" (case-insensitive) */
      section: string;
      /** Event name, e.g. "DaccGuardianGroup" (case-insensitive) */
      method: string;
      predicate?: never;
    }
  | {
      /**
       * Custom predicate called for every event record in each scanned block.
       * The full signed block is pre-fetched before any predicate call.
       * Return true to accept the match and resolve, false to skip and keep scanning.
       */
      predicate: (block: SignedBlock, event: EventRecord['event'], phase: EventRecord['phase']) => boolean | Promise<boolean>;
      section?: never;
      method?: never;
    };

export type BlockScanResult = {
  blockHash: string;
  blockNumber: number;
  /** Index of the extrinsic that emitted the event, or null for inherents */
  extrinsicIndex: number | null;
  /** Returns the full signed block; cached when predicate mode was used */
  block: () => Promise<SignedBlock>;
  /** All event records for this block */
  events: EventRecord[];
};

/**
 * Subscribes to new block headers and resolves with a match descriptor as soon
 * as a qualifying event is found.
 *
 * Supply exactly one of:
 * - `section` + `method` — lightweight name match, no block fetch
 * - `predicate(block, event, phase)` — full control; block is pre-fetched
 *
 * @param api        Connected ApiPromise instance
 * @param filter     Either a name filter or a predicate (mutually exclusive)
 * @param startBlock Ignore blocks with a number strictly below this value
 * @param maxBlocks  Reject after scanning this many blocks; pass 0 to wait indefinitely (default 20)
 */
export const scanForBlockEvent = (
  api: ApiPromise,
  filter: BlockScanFilter,
  startBlock?: number,
  maxBlocks = 20
): Promise<BlockScanResult> => {
  const hasPredicate = "predicate" in filter;
  let blocksScanned = 0;
  let done = false;

  return new Promise((resolve, reject) => {
    const unsubPromise: Promise<() => void> = api.rpc.chain.subscribeNewHeads(
      async (header: Header) => {
        if (done) return;

        const currentBlock: number = header.number.toNumber();
        if (startBlock !== undefined && currentBlock < startBlock) return;

        blocksScanned++;
        if (maxBlocks > 0 && blocksScanned > maxBlocks) {
          done = true;
          unsubPromise.then((unsub) => unsub());
          reject(new Error(`No matching event found within ${maxBlocks} blocks`));
          return;
        }

        try {
          const blockHash = await api.rpc.chain.getBlockHash(currentBlock);

          // Pre-fetch block when using predicate so the caller can inspect extrinsics
          const eventsResult = await api.query.system.events.at(blockHash);
          const events = eventsResult as unknown as EventRecord[];
          const blockData: SignedBlock | null = await (hasPredicate ? api.rpc.chain.getBlock(blockHash) : Promise.resolve(null));

          for (const record of events) {
            const { event, phase } = record;

            const matched: boolean = hasPredicate
              ? await (filter as { predicate: Function }).predicate(blockData, event, phase)
              : event.section.toLowerCase() === (filter as { section: string; method: string }).section.toLowerCase() &&
                event.method.toLowerCase() === (filter as { section: string; method: string }).method.toLowerCase();

            if (!matched) continue;

            done = true;
            unsubPromise.then((unsub) => unsub());
            resolve({
              blockHash: blockHash.toHex(),
              blockNumber: currentBlock,
              extrinsicIndex: phase.isApplyExtrinsic ? phase.asApplyExtrinsic.toNumber() : null,
              block: blockData ? () => Promise.resolve(blockData) : () => api.rpc.chain.getBlock(blockHash),
              events,
            });
            return;
          }
        } catch (err) {
          debugLog(`scanForBlockEvent: error scanning block ${currentBlock}: ${err}`);
        }
      }
    );
  });
};
