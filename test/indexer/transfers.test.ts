import { describe, it, expect } from "vitest";
import { getTransfers } from "../../src/indexer/transfers";
import { mockClient, INDEXER_META } from "./helpers";

describe("getTransfers", () => {
  it("calls GET /api/transfers and returns data", async () => {
    const transfer = { from: "5Fabc", to: "5Fxyz", amount: "1000", indexer: INDEXER_META };
    const body = { success: true, data: [transfer] };
    const { client, requests } = mockClient(body);

    const result = await getTransfers(client);

    expect(requests).toHaveLength(1);
    expect(requests[0].url).toContain("/api/transfers");
    expect(result.success).toBe(true);
    expect(result.data).toHaveLength(1);
  });

  it("passes pagination params", async () => {
    const { client, requests } = mockClient({ success: true, data: [] });

    await getTransfers(client, { page: 0, page_size: 15 });

    const url = new URL(requests[0].url);
    expect(url.searchParams.get("page")).toBe("0");
    expect(url.searchParams.get("page_size")).toBe("15");
  });

  it("sends no query params when called without args", async () => {
    const { client, requests } = mockClient({ success: true, data: [] });

    await getTransfers(client);

    const url = new URL(requests[0].url);
    expect(url.search).toBe("");
  });
});
