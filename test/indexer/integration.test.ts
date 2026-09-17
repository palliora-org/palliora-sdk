/**
 * Integration tests — hits the real @statescan/indexer at http://localhost:5020.
 *
 * These verify that every wrapper function correctly sends an HTTP request,
 * parses the live response, and returns the expected shape. They require the
 * indexer server to be running locally.
 *
 * Run with:
 *   pnpm test:integration
 */

import { describe, it, expect, beforeAll } from "vitest";
import { IndexerClient, IndexerHttpError } from "../../src/indexer/client";
import { getArtefacts, getArtefact, getArtefactAccess, getArtefactContracts, getModels, getAgents, getDatasets, getExecutables } from "../../src/indexer/artefacts";
import { getContracts, getContract, getCompute } from "../../src/indexer/contracts";
import { getBlocks } from "../../src/indexer/blocks";
import { getCall, getCallMetadata, getCallArgs } from "../../src/indexer/calls";
import { getTransfers } from "../../src/indexer/transfers";
import { getExtrinsics, getExtrinsic } from "../../src/indexer/extrinsics";
import { getAddresses, getAddress } from "../../src/indexer/addresses";
import { getBlob } from "../../src/indexer/blobs";
import { getGuardianGroups, getGuardianGroup } from "../../src/indexer/guardians";
import { getAccess } from "../../src/indexer/access";

const BASE_URL = process.env.INDEXER_URL ?? "http://localhost:5020";
let client: IndexerClient;

beforeAll(() => {
  client = new IndexerClient({ baseUrl: BASE_URL });
});

// ─── Blocks ─────────────────────────────────────────────────────────────────

describe("GET /api/blocks", () => {
  it("returns a success response with an array of blocks", async () => {
    const result = await getBlocks(client, { page: 0, page_size: 3 });

    expect(result.success).toBe(true);
    expect(result.data).toBeDefined();
    expect(result.data.blocks).toBeDefined();
    expect(Array.isArray(result.data.blocks)).toBe(true);
    expect(result.data.blocks.length).toBeGreaterThan(0);

    const block = result.data.blocks[0];
    expect(block).toHaveProperty("height");
    expect(block).toHaveProperty("hash");
    expect(block).toHaveProperty("time");
  });

  it("respects page_size", async () => {
    const result = await getBlocks(client, { page: 0, page_size: 2 });

    expect(result.data.blocks.length).toBeLessThanOrEqual(2);
  });
});

// ─── Contracts ──────────────────────────────────────────────────────────────

describe("GET /api/contracts", () => {
  it("returns a paginated response with data and total", async () => {
    const result = await getContracts(client, { page: 0, page_size: 5 });

    expect(result.success).toBe(true);
    expect(Array.isArray(result.data)).toBe(true);
    expect(typeof result.total).toBe("number");
    expect(result.total).toBeGreaterThan(0);
    expect(result.data.length).toBeGreaterThan(0);

    const contract = result.data[0];
    expect(contract).toHaveProperty("contractId");
    expect(contract).toHaveProperty("creator");
  });
});

let firstContractId: string;

describe("GET /api/contract/:id", () => {
  it("returns a single contract document", async () => {
    const list = await getContracts(client, { page: 0, page_size: 1 });
    firstContractId = list.data[0].contractId;

    const result = await getContract(client, firstContractId);

    expect(result.success).toBe(true);
    expect(result.data).toBeDefined();
    expect(result.data.contractId).toBe(firstContractId);
  });

  it("throws IndexerHttpError for a non-existent contract", async () => {
    await expect(getContract(client, "0xnonexistent_contract_id")).rejects.toThrow(IndexerHttpError);
  });
});

describe("GET /api/compute/:id", () => {
  it("returns compute data for a known contract", async () => {
    if (!firstContractId) {
      const list = await getContracts(client, { page: 0, page_size: 1 });
      firstContractId = list.data[0].contractId;
    }

    const result = await getCompute(client, firstContractId);

    expect(result.success).toBe(true);
    expect(result.data).toBeDefined();
  });
});

// ─── Artefacts ──────────────────────────────────────────────────────────────

describe("GET /api/artefacts", () => {
  it("returns all artefacts", async () => {
    const result = await getArtefacts(client);

    expect(result.success).toBe(true);
    expect(Array.isArray(result.data)).toBe(true);
    expect(result.data.length).toBeGreaterThan(0);

    const artefact = result.data[0];
    expect(artefact).toHaveProperty("contractId");
    expect(artefact).toHaveProperty("owner");
    expect(artefact.indexer).toBeDefined();
    expect(artefact.indexer).toHaveProperty("blockHeight");
  });

  it("filters by artefactType and returns matching or empty array", async () => {
    const result = await getArtefacts(client, { artefactType: "Data" });

    expect(result.success).toBe(true);
    expect(Array.isArray(result.data)).toBe(true);
  });
});

describe("storeType category helpers", () => {
  it("getModels returns only storeType Model", async () => {
    const result = await getModels(client);
    expect(result.success).toBe(true);
    expect(result.data.every((a) => a.storeType === "Model")).toBe(true);
  });

  it("getAgents returns only storeType Agent", async () => {
    const result = await getAgents(client);
    expect(result.success).toBe(true);
    expect(result.data.every((a) => a.storeType === "Agent")).toBe(true);
  });

  it("getDatasets returns only storeType Dataset", async () => {
    const result = await getDatasets(client);
    expect(result.success).toBe(true);
    expect(result.data.every((a) => a.storeType === "Dataset")).toBe(true);
  });

  it("getExecutables returns only storeType Executable", async () => {
    const result = await getExecutables(client);
    expect(result.success).toBe(true);
    expect(result.data.every((a) => a.storeType === "Executable")).toBe(true);
  });
});

let firstArtefactId: string;

describe("GET /api/artefact/:id", () => {
  it("returns a single artefact document", async () => {
    const list = await getArtefacts(client);
    firstArtefactId = list.data[0].contractId;

    const result = await getArtefact(client, firstArtefactId);

    expect(result.success).toBe(true);
    expect(result.data).toBeDefined();
    expect(result.data.contractId).toBe(firstArtefactId);
    expect(result.data.indexer).toHaveProperty("blockHeight");
    expect(result.data.indexer).toHaveProperty("blockHash");
  });

  it("throws IndexerHttpError for a non-existent artefact", async () => {
    await expect(getArtefact(client, "0xdoesnotexist")).rejects.toThrow(IndexerHttpError);
  });
});

describe("GET /api/artefact/:id/access", () => {
  it("returns access records (possibly empty array)", async () => {
    if (!firstArtefactId) {
      const list = await getArtefacts(client);
      firstArtefactId = list.data[0].contractId;
    }

    const result = await getArtefactAccess(client, firstArtefactId);

    expect(result.success).toBe(true);
    expect(Array.isArray(result.data)).toBe(true);
  });
});

describe("GET /api/artefact/:id/contracts", () => {
  it("returns contract records (possibly empty array)", async () => {
    if (!firstArtefactId) {
      const list = await getArtefacts(client);
      firstArtefactId = list.data[0].contractId;
    }

    const result = await getArtefactContracts(client, firstArtefactId);

    expect(result.success).toBe(true);
    expect(Array.isArray(result.data)).toBe(true);
  });
});

// ─── Calls ──────────────────────────────────────────────────────────────────

describe("GET /api/call", () => {
  it("returns call data for a known block + extrinsic", async () => {
    const artefactList = await getArtefacts(client);
    const { blockHeight, extrinsicIndex } = artefactList.data[0].indexer;

    const result = await getCall(client, { blockHeight, extrinsicIndex });

    expect(result.success).toBe(true);
    expect(result.data).toBeDefined();
    expect(Array.isArray(result.data) ? result.data.length > 0 : result.data !== null).toBe(true);
  });
});

describe("GET /api/call-metadata", () => {
  it("returns metadata (or errors gracefully) for a known block + extrinsic", async () => {
    const artefactList = await getArtefacts(client);
    const { blockHeight, extrinsicIndex } = artefactList.data[0].indexer;

    try {
      const result = await getCallMetadata(client, { blockHeight, extrinsicIndex });
      expect(result.success).toBe(true);
    } catch (err) {
      expect(err).toBeInstanceOf(IndexerHttpError);
    }
  });
});

describe("GET /api/call-args", () => {
  it("returns call args or errors gracefully for a hash", async () => {
    try {
      const result = await getCallArgs(client, { metadataHash: "0x0000000000000000000000000000000000000000000000000000000000000000" });
      expect(result.success).toBe(true);
    } catch (err) {
      expect(err).toBeInstanceOf(IndexerHttpError);
    }
  });
});

// ─── Transfers ──────────────────────────────────────────────────────────────

describe("GET /api/transfers", () => {
  it("returns a list of transfers", async () => {
    const result = await getTransfers(client, { page: 0, page_size: 5 });

    expect(result.success).toBe(true);
    expect(Array.isArray(result.data)).toBe(true);
    expect(result.data.length).toBeGreaterThan(0);

    const transfer = result.data[0];
    expect(transfer).toHaveProperty("from");
    expect(transfer).toHaveProperty("to");
    expect(transfer).toHaveProperty("balance");
    expect(transfer.indexer).toBeDefined();
    expect(transfer.indexer).toHaveProperty("blockHeight");
  });
});

// ─── Extrinsics ─────────────────────────────────────────────────────────────

describe("GET /api/extrinsics", () => {
  it("returns a paginated list of extrinsics (or 404 if endpoint not deployed)", async () => {
    try {
      const result = await getExtrinsics(client, { page: 0, page_size: 5 });

      expect(result.success).toBe(true);
      expect(Array.isArray(result.data)).toBe(true);
      expect(typeof result.total).toBe("number");

      if (result.data.length > 0) {
        const ext = result.data[0];
        expect(ext).toHaveProperty("hash");
        expect(ext).toHaveProperty("isSigned");
        expect(ext.indexer).toHaveProperty("blockHeight");
        expect(ext.indexer).toHaveProperty("extrinsicIndex");
      }
    } catch (err) {
      expect(err).toBeInstanceOf(IndexerHttpError);
    }
  });

  it("accepts signed_only filter (or 404 if endpoint not deployed)", async () => {
    try {
      const result = await getExtrinsics(client, { page: 0, page_size: 5, signed_only: true });
      expect(result.success).toBe(true);
      expect(Array.isArray(result.data)).toBe(true);
      for (const ext of result.data) {
        expect(ext.isSigned).toBe(true);
      }
    } catch (err) {
      expect(err).toBeInstanceOf(IndexerHttpError);
    }
  });
});

describe("GET /api/extrinsic/:indexOrHash", () => {
  it("fetches by height-index when data is available", async () => {
    try {
      const list = await getExtrinsics(client, { page: 0, page_size: 1, signed_only: true });
      if (!list.data.length) return;

      const { blockHeight, extrinsicIndex } = list.data[0].indexer;
      const result = await getExtrinsic(client, `${blockHeight}-${extrinsicIndex}`);

      expect(result.success).toBe(true);
      expect(result.data.hash).toBe(list.data[0].hash);
      expect(result.data.indexer.blockHeight).toBe(blockHeight);
    } catch (err) {
      expect(err).toBeInstanceOf(IndexerHttpError);
    }
  });

  it("fetches by transaction hash when data is available", async () => {
    try {
      const list = await getExtrinsics(client, { page: 0, page_size: 1 });
      if (!list.data.length) return;

      const result = await getExtrinsic(client, list.data[0].hash);

      expect(result.success).toBe(true);
      expect(result.data.hash).toBe(list.data[0].hash);
    } catch (err) {
      expect(err).toBeInstanceOf(IndexerHttpError);
    }
  });

  it("throws IndexerHttpError for an invalid id format", async () => {
    try {
      await getExtrinsic(client, "not-a-valid-id");
      // If the server is not deployed yet this may 404; either way it should error
      expect.unreachable("should have thrown");
    } catch (err) {
      expect(err).toBeInstanceOf(IndexerHttpError);
      const httpErr = err as IndexerHttpError;
      expect([400, 404]).toContain(httpErr.statusCode);
    }
  });
});

// ─── Addresses ──────────────────────────────────────────────────────────────

describe("GET /api/addresses", () => {
  it("returns a raw array of address documents", async () => {
    const result = await getAddresses(client);

    expect(Array.isArray(result)).toBe(true);
    expect(result.length).toBeGreaterThan(0);

    const addr = result[0];
    expect(addr).toHaveProperty("address");
    expect(typeof addr.address).toBe("string");
  });
});

let firstAddress: string;

describe("GET /api/address/:address", () => {
  it("returns a DataOnlyResponse for a known address", async () => {
    const addresses = await getAddresses(client);
    firstAddress = addresses[0].address;

    const result = await getAddress(client, firstAddress);

    expect(result).toHaveProperty("data");
    expect(result.data).toBeDefined();
    expect(result.data.address).toBe(firstAddress);
  });
});

// ─── Blobs ──────────────────────────────────────────────────────────────────

describe("GET /api/blob/:id", () => {
  it("returns blob data or 404 for a given block height", async () => {
    try {
      const result = await getBlob(client, 100);
      expect(result.success).toBe(true);
      expect(result.data).toBeDefined();
    } catch (err) {
      expect(err).toBeInstanceOf(IndexerHttpError);
      expect((err as IndexerHttpError).statusCode).toBe(404);
    }
  });
});

// ─── Guardian Groups ────────────────────────────────────────────────────────

describe("GET /api/guardian-groups", () => {
  it("returns guardian groups or an error with message", async () => {
    try {
      const result = await getGuardianGroups(client);
      expect(result.success).toBe(true);
      expect(Array.isArray(result.data)).toBe(true);
    } catch (err) {
      expect(err).toBeInstanceOf(IndexerHttpError);
      expect((err as IndexerHttpError).message).toContain("guardian");
    }
  });
});

describe("GET /api/guardian-group/:id", () => {
  it("returns a single group or 404", async () => {
    try {
      const result = await getGuardianGroup(client, "0xnonexistent");
      expect(result.success).toBe(true);
    } catch (err) {
      expect(err).toBeInstanceOf(IndexerHttpError);
    }
  });
});

// ─── Access (legacy) ────────────────────────────────────────────────────────

describe("GET /api/access", () => {
  it("returns an AccessResponse shape with data and message", async () => {
    const result = await getAccess(client);

    expect(result.success).toBe(true);
    expect(Array.isArray(result.data)).toBe(true);
    expect(typeof result.message).toBe("string");
  });
});

// ─── Error handling ─────────────────────────────────────────────────────────

describe("IndexerHttpError on real server", () => {
  it("throws with status 404 for a non-existent resource", async () => {
    try {
      await getArtefact(client, "0x0000000000000000000000000000000000000000000000000000000000000000");
      expect.unreachable("should have thrown");
    } catch (err) {
      expect(err).toBeInstanceOf(IndexerHttpError);
      const httpErr = err as IndexerHttpError;
      expect(httpErr.statusCode).toBeGreaterThanOrEqual(400);
      expect(typeof httpErr.message).toBe("string");
      expect(httpErr.message.length).toBeGreaterThan(0);
    }
  });
});
