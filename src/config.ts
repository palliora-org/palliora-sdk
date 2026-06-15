import { WsProvider } from "@polkadot/api";

const env = typeof process !== "undefined" && process.env ? process.env : {} as Record<string, string | undefined>;

export let PALLIORA_WS = env.PALLIORA_WS || "wss://manas-rpc.palliora.org";
export let PALLIORA_RPC_URL = env.PALLIORA_RPC_URL || "wss://manas-rpc.palliora.org";

export let DEBUG = env.DEBUG === "true" || false;

export let TX_WAIT_FINALIZATION = env.TX_WAIT_FINALIZATION === "true" || false;

export let provider = new WsProvider(PALLIORA_WS, 10000);

export function configure(opts: {
  pallioraWs?: string;
  pallioraRpcUrl?: string;
  debug?: boolean;
  txWaitFinalization?: boolean;
}) {

  if (opts.pallioraWs !== undefined) PALLIORA_WS = opts.pallioraWs;
  if (opts.pallioraRpcUrl !== undefined) PALLIORA_RPC_URL = opts.pallioraRpcUrl;
  if (opts.debug !== undefined) DEBUG = opts.debug;
  if (opts.txWaitFinalization !== undefined) TX_WAIT_FINALIZATION = opts.txWaitFinalization;

  provider = new WsProvider(PALLIORA_WS, 10000);
}