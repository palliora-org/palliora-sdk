import { describe, it, expect } from "vitest";
import { getEvents } from "../../src/indexer/events";
import { mockClient } from "./helpers";

describe("getEvents", () => {
  it("calls GET /api/events with pagination", async () => {
    const body = {
      success: true,
      data: {
        items: [{ indexer: { blockHeight: 10, eventIndex: 0 }, section: "balances", method: "Withdraw" }],
        page: 0,
        pageSize: 5,
      },
    };
    const { client, requests } = mockClient(body);

    const result = await getEvents(client, { page: 0, page_size: 5 });

    const url = new URL(requests[0].url);
    expect(url.pathname).toBe("/api/events");
    expect(url.searchParams.get("page")).toBe("0");
    expect(url.searchParams.get("page_size")).toBe("5");
    expect(result.data.items).toHaveLength(1);
    expect(result.data.items[0].section).toBe("balances");
  });
});
