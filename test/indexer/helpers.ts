/**
 * Shared test utilities for indexer tests.
 *
 * Provides a `createMockFetch` factory that returns a mock `fetch` function
 * recording every request and returning a configurable JSON response.
 */

import { IndexerClient } from "../../src/indexer/client";

/** A single captured request made by IndexerClient. */
export interface CapturedRequest {
  url: string;
  init: RequestInit | undefined;
}

/**
 * Creates a mock `fetch` that resolves with the given `body` and captures
 * every request URL + init for later assertions.
 */
export function createMockFetch(
  body: unknown,
  options: { ok?: boolean; status?: number; statusText?: string } = {},
) {
  const { ok = true, status = 200, statusText = "OK" } = options;
  const requests: CapturedRequest[] = [];

  const mockFetch = async (input: string | URL | Request, init?: RequestInit) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
    requests.push({ url, init });

    const raw = JSON.stringify(body);
    return {
      ok,
      status,
      statusText,
      text: async () => raw,
      json: async () => body,
    } as Response;
  };

  return { mockFetch, requests };
}

/** Shorthand: build a client wired to a mock that returns `body`. */
export function mockClient(body: unknown, fetchOpts?: Parameters<typeof createMockFetch>[1]) {
  const { mockFetch, requests } = createMockFetch(body, fetchOpts);
  const client = new IndexerClient({ baseUrl: "http://test-indexer:5020", fetch: mockFetch });
  return { client, requests };
}

export function mockClientByUrl(
  handlers: Array<{
    match: string | RegExp;
    body: unknown;
    ok?: boolean;
    status?: number;
    statusText?: string;
  }>,
) {
  const requests: CapturedRequest[] = [];

  const mockFetch = async (input: string | URL | Request, init?: RequestInit) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
    requests.push({ url, init });

    const handler = handlers.find((h) =>
      typeof h.match === "string" ? url.includes(h.match) : h.match.test(url),
    );
    if (!handler) {
      return {
        ok: false,
        status: 404,
        statusText: "Not Found",
        text: async () => JSON.stringify({ success: false, message: `No mock for ${url}` }),
        json: async () => ({ success: false, message: `No mock for ${url}` }),
      } as Response;
    }

    const { ok = true, status = 200, statusText = "OK", body } = handler;
    const raw = JSON.stringify(body);
    return {
      ok,
      status,
      statusText,
      text: async () => raw,
      json: async () => body,
    } as Response;
  };

  const client = new IndexerClient({ baseUrl: "http://test-indexer:5020", fetch: mockFetch });
  return { client, requests };
}
export const INDEXER_META = {
  blockHeight: 100,
  blockHash: "0xabc123",
  blockTime: 1700000000000,
  extrinsicIndex: 0,
  eventIndex: 0,
} as const;
