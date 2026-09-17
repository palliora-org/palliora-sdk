import { describe, it, expect } from "vitest";
import { getAccess } from "../../src/indexer/access";
import { mockClient } from "./helpers";

describe("getAccess", () => {
  it("calls GET /api/access and returns AccessResponse shape", async () => {
    const body = { success: true, data: [{ record: "a1" }], message: "1 record found" };
    const { client, requests } = mockClient(body);

    const result = await getAccess(client);

    expect(requests).toHaveLength(1);
    expect(requests[0].url).toContain("/api/access");
    expect(result.success).toBe(true);
    expect(result.data).toHaveLength(1);
    expect(result.message).toBe("1 record found");
  });

  it("passes all optional query filters", async () => {
    const { client, requests } = mockClient({ success: true, data: [], message: "ok" });

    await getAccess(client, {
      blockHeight: 10,
      extrinsicIndex: 3,
      retriver: "5Fretriver",
    });

    const url = new URL(requests[0].url);
    expect(url.searchParams.get("blockHeight")).toBe("10");
    expect(url.searchParams.get("extrinsicIndex")).toBe("3");
    expect(url.searchParams.get("retriver")).toBe("5Fretriver");
  });

  it("sends no query params when called without filters", async () => {
    const { client, requests } = mockClient({ success: true, data: [], message: "ok" });

    await getAccess(client);

    const url = new URL(requests[0].url);
    expect(url.search).toBe("");
  });
});
