import { costEstimationClient } from "./client";

/**
 * Liveness probe via `GET /health`. Does not verify chain connectivity — a healthy
 * response does not guarantee {@link startEstimate} will succeed.
 */
export async function healthCheck(): Promise<boolean> {
  const { status } = await costEstimationClient.get<{ status: string }>("/health");
  return status === "ok";
}
