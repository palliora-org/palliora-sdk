import { DEFAULT_EMPTY_PAYLOAD, getApi, signAndSend } from "../chain";
import { assert, debugLog } from "../utils";

export async function submitData(account: any, data: string) {
  const api = await getApi();

  assert(api, "API not initialized");

  debugLog(`\nSubmitting data with content length: ${data.length}`);

  const tx = api.tx.dataAvailability.submitData(data);
  const hash = await signAndSend(tx, account, DEFAULT_EMPTY_PAYLOAD);

  debugLog(`Data availability transaction sent with hash: ${hash.hash}`);
}
