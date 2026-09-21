import type { ApiPromise } from "@polkadot/api";
import { waitReady } from "@polkadot/wasm-crypto";
import { getApi } from "./singleton";

export interface LatestBlock {
  height: number;
  hash: string;
  time: number;
  validator: string;
  eventsCount: number;
  extrinsicsCount: number;
}

export interface LatestBlocksResult {
  blocks: LatestBlock[];
  latestHeight: number;
}

/**
 * Newest on-chain blocks first, paged backward from the current tip.
 * Uses RPC rather than the indexer `/api/blocks` list.
 */
export async function getLatestBlocks(
  count: number,
  page = 0,
  apiInstance?: ApiPromise,
): Promise<LatestBlocksResult> {
  await waitReady();
  const api = apiInstance ?? (await getApi());
  if (!api) throw new Error("API not initialized");

  const header = await api.rpc.chain.getHeader();
  const latestHeight = header.number.toNumber();
  const start = latestHeight - page * count;
  if (start < 0) {
    return { blocks: [], latestHeight };
  }

  const heights: number[] = [];
  for (let height = start; height >= Math.max(0, start - count + 1); height -= 1) {
    heights.push(height);
  }

  const blocks = await Promise.all(
    heights.map(async (height) => {
      const hash = await api.rpc.chain.getBlockHash(height);
      const [signed, derived, at] = await Promise.all([
        api.rpc.chain.getBlock(hash),
        api.derive.chain.getHeader(hash).catch(() => null),
        api.at(hash),
      ]);
      const [timestamp, events] = await Promise.all([
        at.query.timestamp.now(),
        at.query.system.events(),
      ]);

      return {
        height,
        hash: hash.toHex(),
        time: Number(timestamp.toString()),
        validator: derived?.author?.toString?.() ?? "",
				extrinsicsCount: signed.block.extrinsics.length,
				eventsCount: (events as unknown as { length: number }).length,
      };
    }),
  );

  return { blocks, latestHeight };
}
