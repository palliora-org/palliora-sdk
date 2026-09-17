import { describe, it, expect } from "vitest";
import {
  buildContractPhases,
  deriveContractStatus,
  getArtefactFlow,
  getContractFlow,
} from "../../src/indexer/flow";
import { INDEXER_META, mockClientByUrl } from "./helpers";

const AGREEMENT = {
  contractId: "0xc1",
  creator: "5Fabc",
  fee: "0x10",
  creationTime: 1700000000000,
  parties: ["12D3KooWA", "12D3KooWB"],
  responses: [{ peerId: "12D3KooWA", acceptance: true }],
  indexer: INDEXER_META,
};

const COMPUTE = {
  jobId: "0xjob",
  contractId: "0xc1",
  orchestrator: "12D3KooWA",
  computeReward: "0x20",
  fee: "0x30",
  decryptionFee: [["12D3KooWA", "0x18"]],
  resultTx: { hash: "0xres" },
};

describe("deriveContractStatus", () => {
  it("returns PENDING when there is an agreement with no responses", () => {
    expect(deriveContractStatus({ contractId: "0xc1", responses: [] }, null)).toBe("PENDING");
  });

  it("returns ACCEPTED when parties have responded", () => {
    expect(deriveContractStatus(AGREEMENT, null)).toBe("ACCEPTED");
  });

  it("returns PROCESSING when compute exists without a result", () => {
    expect(deriveContractStatus(AGREEMENT, { jobId: "0xjob" })).toBe("PROCESSING");
  });

  it("returns COMPLETED when compute has a resultTx", () => {
    expect(deriveContractStatus(AGREEMENT, COMPUTE)).toBe("COMPLETED");
  });
});

describe("buildContractPhases", () => {
  it("marks later phases pending until compute exists", () => {
    const phases = buildContractPhases(AGREEMENT, null);
    expect(phases).toHaveLength(4);
    expect(phases[0].complete).toBe(true);
    expect(phases[1].pending).toBe(true);
    expect(phases[1].active).toBe(false);
    expect(phases[3].status).toBe("PENDING");
  });

  it("marks phase 3/4 complete when resultTx is present", () => {
    const phases = buildContractPhases(AGREEMENT, COMPUTE);
    expect(phases[2].status).toBe("RESULT_SUBMITTED");
    expect(phases[2].complete).toBe(true);
    expect(phases[3].status).toBe("SETTLED");
    expect(phases[3].json).toMatchObject({ jobId: "0xjob", computeReward: "0x20" });
  });
});

describe("getContractFlow", () => {
  it("loads agreement + compute and derives the lifecycle", async () => {
    const { client, requests } = mockClientByUrl([
      { match: "/api/contract/0xc1", body: { success: true, data: AGREEMENT } },
      { match: "/api/compute/0xc1", body: { success: true, data: COMPUTE } },
    ]);

    const { data } = await getContractFlow(client, "0xc1");

    expect(requests.map((r) => r.url)).toEqual(
      expect.arrayContaining([
        expect.stringContaining("/api/contract/0xc1"),
        expect.stringContaining("/api/compute/0xc1"),
      ]),
    );
    expect(data.status).toBe("COMPLETED");
    expect(data.agreement.contractId).toBe("0xc1");
    expect(data.compute?.jobId).toBe("0xjob");
    expect(data.phases[0].id).toBe("phase-1");
    expect(data.phases[3].complete).toBe(true);
  });

  it("treats a missing compute document as agreement-only", async () => {
    const { client } = mockClientByUrl([
      { match: "/api/contract/0xc1", body: { success: true, data: AGREEMENT } },
      {
        match: "/api/compute/0xc1",
        body: { success: false, message: "Compute data not found" },
        ok: false,
        status: 404,
      },
    ]);

    const { data } = await getContractFlow(client, "0xc1");

    expect(data.compute).toBeNull();
    expect(data.status).toBe("ACCEPTED");
    expect(data.phases[1].status).toBe("PENDING");
  });
});

describe("getArtefactFlow", () => {
  it("loads artefact, access, and blobs", async () => {
    const artefact = {
      contractId: "0xa1",
      creator: "5Fabc",
      owner: "5Fxyz",
      storeType: "Dataset",
      contractType: "NativeExecute",
      groupId: null,
      blobRefs: [[12, 0], [15, 1]],
      indexer: INDEXER_META,
    };
    const { client, requests } = mockClientByUrl([
      { match: "/api/artefact/0xa1/access", body: { success: true, data: [{ retriver: "5Fabc" }] } },
      { match: "/api/artefact/0xa1", body: { success: true, data: artefact } },
      { match: "/api/blob/12", body: { success: true, data: { indexer: INDEXER_META, dataSize: 10 } } },
      { match: "/api/blob/15", body: { success: true, data: { indexer: INDEXER_META, dataSize: 20 } } },
    ]);

    const { data } = await getArtefactFlow(client, "0xa1", { retriver: "5Fabc" });

    expect(requests.some((r) => r.url.includes("/api/artefact/0xa1"))).toBe(true);
    expect(data.artefact.contractId).toBe("0xa1");
    expect(data.access).toHaveLength(1);
    expect(data.blobs).toHaveLength(2);
  });

  it("skips missing blobs and empty access", async () => {
    const artefact = {
      contractId: "0xa1",
      creator: "5Fabc",
      owner: "5Fxyz",
      storeType: "Dataset",
      contractType: "NativeExecute",
      groupId: null,
      blobRefs: [[99, 0]],
      indexer: INDEXER_META,
    };
    const { client } = mockClientByUrl([
      { match: "/api/artefact/0xa1/access", body: { success: false, message: "none" }, ok: false, status: 404 },
      { match: "/api/artefact/0xa1", body: { success: true, data: artefact } },
      { match: "/api/blob/99", body: { success: false, message: "none" }, ok: false, status: 404 },
    ]);

    const { data } = await getArtefactFlow(client, "0xa1");

    expect(data.access).toEqual([]);
    expect(data.blobs).toEqual([]);
  });
});
