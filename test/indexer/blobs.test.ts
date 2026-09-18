import { describe, it, expect } from "vitest";
import { getBlob } from "../../src/indexer/blobs";
import { mockClient, INDEXER_META } from "./helpers";

describe("getBlob", () => {
  it("calls GET /api/blob/:id with integer id", async () => {
    const body = { success: true, data: { content: "blob-data", indexer: INDEXER_META } };
    const { client, requests } = mockClient(body);

    const result = await getBlob(client, 42);

    expect(requests).toHaveLength(1);
    expect(requests[0].url).toContain("/api/blob/42");
    expect(result.success).toBe(true);
    expect(result.data).toHaveProperty("content", "blob-data");
  });

  it("handles block height 0", async () => {
    const body = { success: true, data: { indexer: INDEXER_META } };
    const { client, requests } = mockClient(body);

    await getBlob(client, 0);

    expect(requests[0].url).toContain("/api/blob/0");
  });
});
