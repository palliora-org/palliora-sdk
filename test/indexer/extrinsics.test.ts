import { describe, it, expect } from "vitest";
import { getExtrinsics, getExtrinsic } from "../../src/indexer/extrinsics";
import { mockClient } from "./helpers";

const EXTRINSIC_DOC = {
  indexer: { blockHeight: 2528092, extrinsicIndex: 2 },
  hash: "0x8699070554e60992aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
  isSigned: true,
  section: "balances",
  method: "transfer",
};

describe("getExtrinsics", () => {
  it("calls GET /api/extrinsics and returns paginated response", async () => {
    const body = { success: true, data: [EXTRINSIC_DOC], total: 46 };
    const { client, requests } = mockClient(body);

    const result = await getExtrinsics(client);

    expect(requests).toHaveLength(1);
    expect(requests[0].url).toContain("/api/extrinsics");
    expect(result.success).toBe(true);
    expect(result.data).toHaveLength(1);
    expect(result.total).toBe(46);
    expect(result.data[0].hash).toBe(EXTRINSIC_DOC.hash);
  });

  it("passes page and page_size params", async () => {
    const { client, requests } = mockClient({ success: true, data: [], total: 0 });

    await getExtrinsics(client, { page: 1, page_size: 25 });

    const url = new URL(requests[0].url);
    expect(url.searchParams.get("page")).toBe("1");
    expect(url.searchParams.get("page_size")).toBe("25");
  });

  it("serializes signed_only boolean as string \"true\"", async () => {
    const { client, requests } = mockClient({ success: true, data: [], total: 0 });

    await getExtrinsics(client, { signed_only: true });

    const url = new URL(requests[0].url);
    expect(url.searchParams.get("signed_only")).toBe("true");
  });

  it("serializes signed_only string \"true\" as-is", async () => {
    const { client, requests } = mockClient({ success: true, data: [], total: 0 });

    await getExtrinsics(client, { signed_only: "true" });

    const url = new URL(requests[0].url);
    expect(url.searchParams.get("signed_only")).toBe("true");
  });

  it("sends no query params when called without args", async () => {
    const { client, requests } = mockClient({ success: true, data: [], total: 0 });

    await getExtrinsics(client);

    const url = new URL(requests[0].url);
    expect(url.search).toBe("");
  });
});

describe("getExtrinsic", () => {
  it("calls GET /api/extrinsic/:indexOrHash with a height-index pair", async () => {
    const body = { success: true, data: EXTRINSIC_DOC };
    const { client, requests } = mockClient(body);

    const result = await getExtrinsic(client, "2528092-2");

    expect(requests[0].url).toContain("/api/extrinsic/2528092-2");
    expect(result.data.hash).toBe(EXTRINSIC_DOC.hash);
    expect(result.data.indexer.blockHeight).toBe(2528092);
  });

  it("calls GET /api/extrinsic/:indexOrHash with a transaction hash", async () => {
    const body = { success: true, data: EXTRINSIC_DOC };
    const { client, requests } = mockClient(body);

    const result = await getExtrinsic(client, EXTRINSIC_DOC.hash);

    expect(requests[0].url).toContain(`/api/extrinsic/${encodeURIComponent(EXTRINSIC_DOC.hash)}`);
    expect(result.data.isSigned).toBe(true);
  });

  it("URL-encodes the id parameter", async () => {
    const { client, requests } = mockClient({ success: true, data: EXTRINSIC_DOC });

    await getExtrinsic(client, "id with spaces");

    expect(requests[0].url).toContain("/api/extrinsic/id%20with%20spaces");
  });
});
