import { getApi, signAndSend } from "../chain";
import { assert, debugLog } from "../utils";
import { OnChainRef } from "./types";

export async function writeMetadata(
  account: any,
  name: string,
  description: string,
  ref: OnChainRef,
  price: bigint,
  dataType: number,
  l2Owner: string,
  groupId: string,
) {
  const blobRef = [ref.blockNumber, ref.index];
  const encoder = new TextEncoder();
  const nameBytes = Array.from(encoder.encode(name));
  const descriptionBytes = Array.from(encoder.encode(description));
  const ownerBytes = Array.from(encoder.encode(l2Owner));

  const api = await getApi();
  assert(api, "Failed to get API connection");

  const request = api.tx.dataAvailability.daccRegisterData(
    nameBytes,
    descriptionBytes,
    blobRef,
    price,
    dataType,
    ownerBytes,
    groupId,
  );

  const hash = await signAndSend(request, account);

  debugLog(`Metadata registration transaction sent with hash: ${hash.hash}`);

  return hash;
}
