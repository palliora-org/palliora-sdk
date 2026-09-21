import { getCostEstimatorUrl } from "../config";
import { debugLog } from "../utils";

/** Thrown for any non-2xx response from the cost estimation service. */
export class CostEstimationError extends Error {
  constructor(
    message: string,
    public readonly status: number,
  ) {
    super(message);
    this.name = "CostEstimationError";
  }
}

async function request<T>(
  method: "GET" | "POST",
  path: string,
  body?: unknown,
): Promise<T> {
  const url = `${getCostEstimatorUrl()}${path}`;
  debugLog(`cost estimation service: ${method} ${url}`, body);

  const res = await fetch(url, {
    method,
    headers: body !== undefined ? { "Content-Type": "application/json" } : undefined,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });

  const text = await res.text();
  const data = text ? JSON.parse(text) : undefined;

  if (!res.ok) {
    const message =
      data && typeof data === "object" && "error" in data
        ? String((data as { error: unknown }).error)
        : `cost estimation service returned ${res.status}`;
    throw new CostEstimationError(message, res.status);
  }

  return data as T;
}

export const costEstimationClient = {
  get: <T>(path: string) => request<T>("GET", path),
  post: <T>(path: string, body?: unknown) => request<T>("POST", path, body),
};
