// ---------------------------------------------------------------------------
// IndexerClient — configurable HTTP client for the @statescan/indexer REST API
// ---------------------------------------------------------------------------

import type { ErrorResponse } from "./types";

const DEFAULT_BASE_URL = "http://localhost:5020";

export interface IndexerClientOptions {
  /** Base URL of the indexer server (default: `http://localhost:5020`). */
  baseUrl?: string;
  /**
   * Custom fetch implementation. Defaults to the global `fetch`.
   * Useful for injecting a test double or a polyfill in older Node versions.
   */
  fetch?: typeof globalThis.fetch;
}

/**
 * Lightweight wrapper around `fetch` that targets the `@statescan/indexer` REST API.
 *
 * Every public method on the domain modules receives an `IndexerClient` instance,
 * keeping configuration (base URL, custom fetch) in one place.
 *
 * @example
 * ```ts
 * import { IndexerClient } from "@palliora.org/chainsdk";
 *
 * const client = new IndexerClient({ baseUrl: "https://indexer.palliora.org" });
 * ```
 */
export class IndexerClient {
  readonly baseUrl: string;
  private readonly _fetch: typeof globalThis.fetch;

  constructor(options: IndexerClientOptions = {}) {
    // Paths already include `/api/...`, so a baseUrl of `.../api` would become
    // `/api/api/...` and 404. Strip trailing slashes and an accidental `/api` suffix.
    this.baseUrl = (options.baseUrl ?? DEFAULT_BASE_URL)
      .replace(/\/+$/, "")
      .replace(/\/api$/i, "");
    this._fetch = options.fetch ?? globalThis.fetch.bind(globalThis);
  }

  /**
   * Performs a GET request against the indexer and returns the parsed JSON body.
   *
   * @throws {IndexerHttpError} When the response indicates failure (`success: false`)
   *         or the HTTP status is not 2xx.
   */
  async get<T>(
    path: string,
    params?: Record<string, string | number | boolean | null | undefined>,
  ): Promise<T> {
    const url = new URL(`${this.baseUrl}${path}`);

    if (params) {
      for (const [key, value] of Object.entries(params)) {
        if (value !== undefined && value !== null) {
          url.searchParams.set(key, String(value));
        }
      }
    }

    const response = await this._fetch(url.toString(), {
      method: "GET",
      headers: { Accept: "application/json" },
    });

    const raw = await response.text();
    let body: unknown;
    try {
      body = raw ? JSON.parse(raw) : null;
    } catch {
      if (!response.ok) {
        throw new IndexerHttpError(
          response.status,
          raw || response.statusText,
        );
      }
      throw new IndexerHttpError(
        response.status,
        `Invalid JSON response from ${url.toString()}: ${raw.slice(0, 120)}`,
      );
    }

    if (!response.ok) {
      const errBody = body as ErrorResponse;
      throw new IndexerHttpError(
        response.status,
        errBody?.message ?? response.statusText,
      );
    }

    return body as T;
  }
}

/**
 * Error thrown when the indexer returns a non-2xx response or an error envelope.
 */
export class IndexerHttpError extends Error {
  readonly statusCode: number;

  constructor(statusCode: number, message: string) {
    super(message);
    this.name = "IndexerHttpError";
    this.statusCode = statusCode;
  }
}
