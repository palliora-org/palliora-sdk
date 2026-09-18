import { describe, it, expect } from "vitest";
import {
  buildContractPhases,
  deriveContractStatus,
  getArtefactFlow,
  getContractFlow,
  resultToCompute,
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
    expect(phases).toHaveLength(5);
    expect(phases[0].complete).toBe(true);
    expect(phases[1].pending).toBe(true);
    expect(phases[1].active).toBe(false);
    expect(phases[3].status).toBe("PENDING");
    expect(phases[4].id).toBe("phase-5");
  });

  it("marks phase 3/4 complete when resultTx is present", () => {
    const phases = buildContractPhases(AGREEMENT, COMPUTE);
    expect(phases[2].status).toBe("1/1 RESULT_SUBMITTED");
    expect(phases[2].complete).toBe(true);
    expect(phases[3].status).toBe("1/1 SETTLED");
    expect(phases[3].json).toMatchObject({ requestCount: 1, computeReward: "0x20" });
    expect(phases[4].status).toBe("SETTLED");
  });

  it("treats multiple compute requests as one session", () => {
    const second = { ...COMPUTE, jobId: "0xjob2", resultTx: { hash: "0xres2" } };
    const phases = buildContractPhases(AGREEMENT, [COMPUTE, second]);
    expect(phases[1].status).toBe("2 SUBMITTED");
    expect(phases[2].status).toBe("2/2 RESULT_SUBMITTED");
    expect(phases[4].complete).toBe(true);
  });
});

describe("resultToCompute", () => {
  it("maps result rows onto compute-request fields", () => {
    const mapped = resultToCompute({
      resultId: "0xr1",
      contractId: "0xc1",
      submitor: "5HTntg",
      feeBreakdown: {
        submitorFee: { amount: "100" },
        resultFee: "0",
        thresholdDecryptionFee: [],
      },
      indexer: INDEXER_META,
    });

    expect(mapped.jobId).toBe("0xr1");
    expect(mapped.orchestrator).toBe("5HTntg");
    expect(mapped.computeReward).toBe("100");
    expect(mapped.resultTx).toMatchObject({
      blockHeight: INDEXER_META.blockHeight,
      hash: INDEXER_META.blockHash,
    });
  });
});

describe("getContractFlow", () => {
  it("loads agreement + compute and derives the lifecycle", async () => {
    const { client, requests } = mockClientByUrl([
      { match: "/api/contract/0xc1", body: { success: true, data: AGREEMENT } },
      { match: "/api/compute/0xc1", body: { success: true, data: COMPUTE } },
      { match: "/api/results", body: { success: true, data: [] } },
    ]);

    const { data } = await getContractFlow(client, "0xc1");

    expect(requests.map((r) => r.url)).toEqual(
      expect.arrayContaining([
        expect.stringContaining("/api/contract/0xc1"),
        expect.stringContaining("/api/compute/0xc1"),
        expect.stringContaining("/api/results"),
      ]),
    );
    expect(data.status).toBe("COMPLETED");
    expect(data.agreement.contractId).toBe("0xc1");
    expect(data.compute?.jobId).toBe("0xjob");
    expect(data.computes).toHaveLength(1);
    expect(data.results).toEqual([]);
    expect(data.phases[0].id).toBe("phase-1");
    expect(data.phases[3].complete).toBe(true);
    expect(data.phases[4].id).toBe("phase-5");
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
      { match: "/api/results", body: { success: true, data: [] } },
    ]);

    const { data } = await getContractFlow(client, "0xc1");

    expect(data.compute).toBeNull();
    expect(data.results).toEqual([]);
    expect(data.status).toBe("ACCEPTED");
    expect(data.phases[1].status).toBe("PENDING");
  });

  it("uses palliora-compute results as session compute requests", async () => {
    const resultDoc = {
      resultId: "0xa284",
      contractId: "0xc1",
      submitor: "5HTntg",
      computeDurationMs: 322,
      feeBreakdown: {
        submitorFee: { recipient: "5HTntg", amount: "100", kind: "Submitor" },
        resultFee: "0",
        thresholdDecryptionFee: [],
      },
      indexer: INDEXER_META,
    };
    const { client } = mockClientByUrl([
      { match: "/api/contract/0xc1", body: { success: true, data: AGREEMENT } },
      { match: "/api/compute/0xc1", body: { success: true, data: AGREEMENT } },
      { match: "/api/results", body: { success: true, data: [resultDoc] } },
    ]);

    const { data } = await getContractFlow(client, "0xc1");

    expect(data.results).toHaveLength(1);
    expect(data.computes).toHaveLength(1);
    expect(data.compute?.jobId).toBe("0xa284");
    expect(data.compute?.orchestrator).toBe("5HTntg");
    expect(data.status).toBe("COMPLETED");
    expect(data.phases[2].complete).toBe(true);
    expect(data.phases[3].complete).toBe(true);
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
