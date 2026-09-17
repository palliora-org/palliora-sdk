import { describe, it, expect } from "vitest";
import { IndexerClient, IndexerHttpError } from "../../src/indexer/client";
import { createMockFetch } from "./helpers";

describe("IndexerClient", () => {
  describe("constructor", () => {
    it("uses default base URL when none provided", () => {
      const { mockFetch } = createMockFetch({});
      const client = new IndexerClient({ fetch: mockFetch });
      expect(client.baseUrl).toBe("http://localhost:5020");
    });

    it("strips trailing slashes from base URL", () => {
      const { mockFetch } = createMockFetch({});
      const client = new IndexerClient({ baseUrl: "http://example.com///", fetch: mockFetch });
      expect(client.baseUrl).toBe("http://example.com");
    });

    it("strips a trailing /api suffix so paths are not doubled", () => {
      const { mockFetch } = createMockFetch({});
      const client = new IndexerClient({ baseUrl: "http://localhost:5020/api", fetch: mockFetch });
      expect(client.baseUrl).toBe("http://localhost:5020");
    });

    it("accepts a custom base URL", () => {
      const { mockFetch } = createMockFetch({});
      const client = new IndexerClient({ baseUrl: "https://indexer.palliora.org", fetch: mockFetch });
      expect(client.baseUrl).toBe("https://indexer.palliora.org");
    });
  });

  describe("get()", () => {
    it("sends a GET request to the correct URL", async () => {
      const { mockFetch, requests } = createMockFetch({ success: true, data: [] });
      const client = new IndexerClient({ baseUrl: "http://host:5020", fetch: mockFetch });

      await client.get("/api/blocks");

      expect(requests).toHaveLength(1);
      expect(requests[0].url).toBe("http://host:5020/api/blocks");
      expect(requests[0].init?.method).toBe("GET");
    });

    it("appends query params to the URL", async () => {
      const { mockFetch, requests } = createMockFetch({ success: true, data: [] });
      const client = new IndexerClient({ baseUrl: "http://host:5020", fetch: mockFetch });

      await client.get("/api/contracts", { page: 2, page_size: 10 });

      const url = new URL(requests[0].url);
      expect(url.searchParams.get("page")).toBe("2");
      expect(url.searchParams.get("page_size")).toBe("10");
    });

    it("omits undefined and null params", async () => {
      const { mockFetch, requests } = createMockFetch({ success: true, data: [] });
      const client = new IndexerClient({ baseUrl: "http://host:5020", fetch: mockFetch });

      await client.get("/api/artefacts", { artefactType: "Model", extra: undefined, nope: null } as any);

      const url = new URL(requests[0].url);
      expect(url.searchParams.get("artefactType")).toBe("Model");
      expect(url.searchParams.has("extra")).toBe(false);
      expect(url.searchParams.has("nope")).toBe(false);
    });

    it("returns parsed JSON body on success", async () => {
      const payload = { success: true, data: [{ id: 1 }] };
      const { mockFetch } = createMockFetch(payload);
      const client = new IndexerClient({ baseUrl: "http://host:5020", fetch: mockFetch });

      const result = await client.get("/api/blocks");
      expect(result).toEqual(payload);
    });

    it("sets Accept: application/json header", async () => {
      const { mockFetch, requests } = createMockFetch({});
      const client = new IndexerClient({ baseUrl: "http://host:5020", fetch: mockFetch });

      await client.get("/api/blocks");

      const headers = requests[0].init?.headers as Record<string, string>;
      expect(headers.Accept).toBe("application/json");
    });
  });

  describe("error handling", () => {
    it("throws IndexerHttpError on non-2xx response", async () => {
      const { mockFetch } = createMockFetch(
        { success: false, message: "Not found" },
        { ok: false, status: 404, statusText: "Not Found" },
      );
      const client = new IndexerClient({ baseUrl: "http://host:5020", fetch: mockFetch });

      await expect(client.get("/api/artefact/missing")).rejects.toThrow(IndexerHttpError);
    });

    it("includes status code and message on error", async () => {
      const { mockFetch } = createMockFetch(
        { success: false, message: "Contract not found" },
        { ok: false, status: 404 },
      );
      const client = new IndexerClient({ baseUrl: "http://host:5020", fetch: mockFetch });

      try {
        await client.get("/api/contract/bad-id");
        expect.unreachable("should have thrown");
      } catch (err) {
        expect(err).toBeInstanceOf(IndexerHttpError);
        const httpErr = err as IndexerHttpError;
        expect(httpErr.statusCode).toBe(404);
        expect(httpErr.message).toBe("Contract not found");
      }
    });

    it("falls back to statusText when body has no message", async () => {
      const { mockFetch } = createMockFetch(
        {},
        { ok: false, status: 500, statusText: "Internal Server Error" },
      );
      const client = new IndexerClient({ baseUrl: "http://host:5020", fetch: mockFetch });

      try {
        await client.get("/api/blocks");
        expect.unreachable("should have thrown");
      } catch (err) {
        const httpErr = err as IndexerHttpError;
        expect(httpErr.statusCode).toBe(500);
        expect(httpErr.message).toBe("Internal Server Error");
      }
    });

    it("IndexerHttpError has correct name property", () => {
      const err = new IndexerHttpError(400, "Bad request");
      expect(err.name).toBe("IndexerHttpError");
      expect(err instanceof Error).toBe(true);
    });
  });
});
