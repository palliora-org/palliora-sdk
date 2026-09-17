import { describe, it, expect } from "vitest";
import { getBlocks } from "../../src/indexer/blocks";
import { mockClient } from "./helpers";

describe("getBlocks", () => {
  it("calls GET /api/blocks and returns data", async () => {
    const body = {
      success: true,
      data: {
        blocks: [{ height: 100, hash: "0xabc", time: 1700000000000 }],
        stats: { total: 100 },
      },
    };
    const { client, requests } = mockClient(body);

    const result = await getBlocks(client);

    expect(requests).toHaveLength(1);
    expect(requests[0].url).toContain("/api/blocks");
    expect(result.success).toBe(true);
    expect(result.data.blocks).toHaveLength(1);
    expect(result.data.blocks[0].height).toBe(100);
  });

  it("passes pagination params", async () => {
    const { client, requests } = mockClient({ success: true, data: { blocks: [] } });

    await getBlocks(client, { page: 1, page_size: 5 });

    const url = new URL(requests[0].url);
    expect(url.searchParams.get("page")).toBe("1");
    expect(url.searchParams.get("page_size")).toBe("5");
  });

  it("sends no query params when called without args", async () => {
    const { client, requests } = mockClient({ success: true, data: { blocks: [] } });

    await getBlocks(client);

    const url = new URL(requests[0].url);
    expect(url.search).toBe("");
  });
});
