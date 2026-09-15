import type { KeyringPair } from "@polkadot/keyring/types";
import { u8aToHex } from "@polkadot/util";
import { costEstimationClient } from "./client";

/**
 * Registers a webhook URL for `guardian` via `POST /guardians/:address/webhook`, so
 * it gets a best-effort push (`{ auctionId, contractId, deadline }`) whenever it's
 * placed in a new auction, instead of polling {@link listGuardianAuctions}.
 *
 * Signed with `guardian`'s sr25519 key over the literal string `webhook:${url}`, as
 * required by the service — this binds the registration to the exact URL so it
 * can't be replayed to redirect notifications elsewhere.
 *
 * Replaces any previously registered webhook for this guardian; there is no
 * list/unregister endpoint. Delivery is best-effort and unawaited by the service —
 * a failed push is only logged server-side, never retried, so don't rely on this as
 * a substitute for polling if missing an auction would be costly.
 *
 * @throws {CostEstimationError} 400 if `url` isn't an absolute http(s) URL; 404 if
 * `guardian` has no resolvable on-chain guardian entry; 422 if the signature doesn't
 * verify.
 */
export async function registerGuardianWebhook(
  url: string,
  guardian: KeyringPair,
): Promise<void> {
  const signature = u8aToHex(guardian.sign(`webhook:${url}`));
  await costEstimationClient.post<void>(
    `/guardians/${encodeURIComponent(guardian.address)}/webhook`,
    { url, signature },
  );
}
