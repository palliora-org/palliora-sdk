import { describe, it, expect } from "vitest";
import { getCall, getCallMetadata, getCallArgs } from "../../src/indexer/calls";
import { mockClient } from "./helpers";

describe("getCall", () => {
  it("calls GET /api/call with required query params", async () => {
    const body = { success: true, data: { section: "balances", method: "transfer" } };
    const { client, requests } = mockClient(body);

    const result = await getCall(client, { blockHeight: 500, extrinsicIndex: 2 });

    expect(requests).toHaveLength(1);
    const url = new URL(requests[0].url);
    expect(url.pathname).toBe("/api/call");
    expect(url.searchParams.get("blockHeight")).toBe("500");
    expect(url.searchParams.get("extrinsicIndex")).toBe("2");
    expect(result.data).toEqual({ section: "balances", method: "transfer" });
  });
});

describe("getCallMetadata", () => {
  it("calls GET /api/call-metadata with required query params", async () => {
    const body = { success: true, data: { metadataHash: "0xmeta" } };
    const { client, requests } = mockClient(body);

    const result = await getCallMetadata(client, { blockHeight: 600, extrinsicIndex: 0 });

    const url = new URL(requests[0].url);
    expect(url.pathname).toBe("/api/call-metadata");
    expect(url.searchParams.get("blockHeight")).toBe("600");
    expect(url.searchParams.get("extrinsicIndex")).toBe("0");
    expect(result.data).toEqual({ metadataHash: "0xmeta" });
  });
});

describe("getCallArgs", () => {
  it("calls GET /api/call-args with required metadataHash", async () => {
    const body = { success: true, data: { args: { dest: "5Fabc" } } };
    const { client, requests } = mockClient(body);

    const result = await getCallArgs(client, { metadataHash: "0xdef456" });

    const url = new URL(requests[0].url);
    expect(url.pathname).toBe("/api/call-args");
    expect(url.searchParams.get("metadataHash")).toBe("0xdef456");
    expect(result.data).toEqual({ args: { dest: "5Fabc" } });
  });
});
