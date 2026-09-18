import { describe, it, expect } from "vitest";
import { getContracts, getContract, getCompute, getResults, getResult } from "../../src/indexer/contracts";
import { mockClient, INDEXER_META } from "./helpers";

const CONTRACT_DOC = {
  contractId: "0xc1",
  creator: "5Fabc",
  owner: "5Fxyz",
  storeType: "onchain",
  contractType: "NativeExecute",
  status: "Active",
  groupId: "0xg1",
  artefactType: "Executable",
  indexer: INDEXER_META,
};

describe("getContracts", () => {
  it("calls GET /api/contracts and returns paginated response", async () => {
    const body = { success: true, data: [CONTRACT_DOC], total: 42 };
    const { client, requests } = mockClient(body);

    const result = await getContracts(client);

    expect(requests[0].url).toContain("/api/contracts");
    expect(result.success).toBe(true);
    expect(result.data).toHaveLength(1);
    expect(result.total).toBe(42);
  });

  it("passes page and page_size params", async () => {
    const { client, requests } = mockClient({ success: true, data: [], total: 0 });

    await getContracts(client, { page: 3, page_size: 50 });

    const url = new URL(requests[0].url);
    expect(url.searchParams.get("page")).toBe("3");
    expect(url.searchParams.get("page_size")).toBe("50");
  });

  it("works without query params", async () => {
    const { client, requests } = mockClient({ success: true, data: [], total: 0 });

    await getContracts(client);

    const url = new URL(requests[0].url);
    expect(url.search).toBe("");
  });
});

describe("getContract", () => {
  it("calls GET /api/contract/:id", async () => {
    const body = { success: true, data: CONTRACT_DOC };
    const { client, requests } = mockClient(body);

    const result = await getContract(client, "0xc1");

    expect(requests[0].url).toContain("/api/contract/0xc1");
    expect(result.data.contractId).toBe("0xc1");
  });

  it("URL-encodes the id parameter", async () => {
    const { client, requests } = mockClient({ success: true, data: CONTRACT_DOC });

    await getContract(client, "id/with/slashes");

    expect(requests[0].url).toContain("/api/contract/id%2Fwith%2Fslashes");
  });
});

describe("getCompute", () => {
  it("calls GET /api/compute/:id", async () => {
    const body = { success: true, data: { compute: "result" } };
    const { client, requests } = mockClient(body);

    const result = await getCompute(client, "0xc1");

    expect(requests[0].url).toContain("/api/compute/0xc1");
    expect(result.data).toEqual({ compute: "result" });
  });
});

const RESULT_DOC = {
  resultId: "0xr1",
  contractId: "0xc1",
  contractType: "Active",
  submitor: "5HTntg",
  computeDurationMs: 322,
  executionOutcome: null,
  feeBreakdown: {
    submitorFee: { recipient: "5HTntg", amount: "100", kind: "Submitor" },
    resultFee: "0",
    refundedAmount: "50",
  },
  indexer: INDEXER_META,
};

describe("getResults", () => {
  it("calls GET /api/results with contractId", async () => {
    const body = { success: true, data: [RESULT_DOC] };
    const { client, requests } = mockClient(body);

    const result = await getResults(client, { contractId: "0xc1" });

    const url = new URL(requests[0].url);
    expect(url.pathname).toBe("/api/results");
    expect(url.searchParams.get("contractId")).toBe("0xc1");
    expect(result.data).toHaveLength(1);
    expect(result.data[0].resultId).toBe("0xr1");
  });
});

describe("getResult", () => {
  it("calls GET /api/result/:id", async () => {
    const { client, requests } = mockClient({ success: true, data: RESULT_DOC });

    const result = await getResult(client, "0xr1");

    expect(requests[0].url).toContain("/api/result/0xr1");
    expect(result.data.resultId).toBe("0xr1");
  });
});
