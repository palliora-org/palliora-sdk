import { describe, it, expect } from "vitest";
import { getOverview } from "../../src/indexer/overview";
import { mockClient } from "./helpers";

describe("getOverview", () => {
  it("calls GET /api/overview and returns the summary", async () => {
    const body = {
      success: true,
      data: {
        accounts: 17,
        transfers: 8,
        latestHeight: 21230,
        avgBlockTime: 1,
        activeValidators: null,
      },
    };
    const { client, requests } = mockClient(body);

    const result = await getOverview(client);

    expect(requests).toHaveLength(1);
    expect(new URL(requests[0].url).pathname).toBe("/api/overview");
    expect(result.data.accounts).toBe(17);
    expect(result.data.latestHeight).toBe(21230);
  });
});
