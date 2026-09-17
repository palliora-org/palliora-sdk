import { describe, it, expect } from "vitest";
import {
  getArtefacts,
  getArtefact,
  getArtefactAccess,
  getArtefactContracts,
  getArtefactsByStoreType,
  getDatasets,
  getModels,
  getAgents,
  getExecutables,
} from "../../src/indexer/artefacts";
import { mockClient, INDEXER_META } from "./helpers";

const ARTEFACT_DOC = {
  contractId: "0xabc",
  creator: "5Fabc",
  owner: "5Fxyz",
  storeType: "Model" as const,
  contractType: "Dormant",
  status: "Active",
  groupId: "0xg1",
  name: "Sentiment BERT",
  indexer: INDEXER_META,
};

const MIXED_ARTEFACTS = {
  success: true as const,
  data: [
    { ...ARTEFACT_DOC, contractId: "0xd1", storeType: "Dataset" as const, name: "Iris" },
    { ...ARTEFACT_DOC, contractId: "0xd2", storeType: "Dataset" as const, name: "RateProbe" },
    { ...ARTEFACT_DOC, contractId: "0xm1", storeType: "Model" as const, name: "BERT" },
    { ...ARTEFACT_DOC, contractId: "0xa1", storeType: "Agent" as const, name: "Research Agent" },
    { ...ARTEFACT_DOC, contractId: "0xe1", storeType: "Executable" as const, name: "Tokenizer" },
    { ...ARTEFACT_DOC, contractId: "0xo1", storeType: "Other" as const, name: "Misc" },
    { ...ARTEFACT_DOC, contractId: "0xn1", storeType: null, name: null },
  ],
};

describe("getArtefacts", () => {
  it("calls GET /api/artefacts and returns data", async () => {
    const body = { success: true, data: [ARTEFACT_DOC] };
    const { client, requests } = mockClient(body);

    const result = await getArtefacts(client);

    expect(requests).toHaveLength(1);
    expect(requests[0].url).toContain("/api/artefacts");
    expect(result.success).toBe(true);
    expect(result.data).toHaveLength(1);
    expect(result.data[0].contractId).toBe("0xabc");
  });

  it("passes artefactType query param", async () => {
    const { client, requests } = mockClient({ success: true, data: [] });

    await getArtefacts(client, { artefactType: "Agent" });

    const url = new URL(requests[0].url);
    expect(url.searchParams.get("artefactType")).toBe("Agent");
  });

  it("omits query params when none provided", async () => {
    const { client, requests } = mockClient({ success: true, data: [] });

    await getArtefacts(client);

    const url = new URL(requests[0].url);
    expect(url.search).toBe("");
  });
});

describe("storeType helpers", () => {
  it("getArtefactsByStoreType filters client-side by storeType", async () => {
    const { client } = mockClient(MIXED_ARTEFACTS);

    const result = await getArtefactsByStoreType(client, "Dataset");

    expect(result.success).toBe(true);
    expect(result.data).toHaveLength(2);
    expect(result.data.every((a) => a.storeType === "Dataset")).toBe(true);
  });

  it("getModels returns only Model artefacts", async () => {
    const { client } = mockClient(MIXED_ARTEFACTS);
    const result = await getModels(client);
    expect(result.data).toHaveLength(1);
    expect(result.data[0].name).toBe("BERT");
  });

  it("getAgents returns only Agent artefacts", async () => {
    const { client } = mockClient(MIXED_ARTEFACTS);
    const result = await getAgents(client);
    expect(result.data).toHaveLength(1);
    expect(result.data[0].storeType).toBe("Agent");
  });

  it("getDatasets returns only Dataset artefacts", async () => {
    const { client } = mockClient(MIXED_ARTEFACTS);
    const result = await getDatasets(client);
    expect(result.data).toHaveLength(2);
  });

  it("getExecutables returns only Executable artefacts", async () => {
    const { client } = mockClient(MIXED_ARTEFACTS);
    const result = await getExecutables(client);
    expect(result.data).toHaveLength(1);
    expect(result.data[0].storeType).toBe("Executable");
  });
});

describe("getArtefact", () => {
  it("calls GET /api/artefact/:id", async () => {
    const body = { success: true, data: ARTEFACT_DOC };
    const { client, requests } = mockClient(body);

    const result = await getArtefact(client, "0xabc");

    expect(requests[0].url).toContain("/api/artefact/0xabc");
    expect(result.data.storeType).toBe("Model");
  });

  it("URL-encodes the id parameter", async () => {
    const { client, requests } = mockClient({ success: true, data: ARTEFACT_DOC });

    await getArtefact(client, "id with spaces");

    expect(requests[0].url).toContain("/api/artefact/id%20with%20spaces");
  });
});

describe("getArtefactAccess", () => {
  it("calls GET /api/artefact/:id/access", async () => {
    const body = { success: true, data: [{ record: 1 }] };
    const { client, requests } = mockClient(body);

    const result = await getArtefactAccess(client, "0xabc");

    expect(requests[0].url).toContain("/api/artefact/0xabc/access");
    expect(result.data).toHaveLength(1);
  });

  it("passes optional query filters", async () => {
    const { client, requests } = mockClient({ success: true, data: [] });

    await getArtefactAccess(client, "0xabc", {
      blockHeight: 50,
      extrinsicIndex: 1,
      retriver: "5Faddr",
    });

    const url = new URL(requests[0].url);
    expect(url.searchParams.get("blockHeight")).toBe("50");
    expect(url.searchParams.get("extrinsicIndex")).toBe("1");
    expect(url.searchParams.get("retriver")).toBe("5Faddr");
  });
});

describe("getArtefactContracts", () => {
  it("calls GET /api/artefact/:id/contracts", async () => {
    const body = { success: true, data: [{ contract: "c1" }] };
    const { client, requests } = mockClient(body);

    const result = await getArtefactContracts(client, "0xdef");

    expect(requests[0].url).toContain("/api/artefact/0xdef/contracts");
    expect(result.data).toHaveLength(1);
  });

  it("passes optional query filters", async () => {
    const { client, requests } = mockClient({ success: true, data: [] });

    await getArtefactContracts(client, "0xdef", { retriver: "5Fxyz" });

    const url = new URL(requests[0].url);
    expect(url.searchParams.get("retriver")).toBe("5Fxyz");
  });
});
