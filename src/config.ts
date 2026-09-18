import { WsProvider } from "@polkadot/api";

const env = typeof process !== "undefined" && process.env ? process.env : {} as Record<string, string | undefined>;

export let PALLIORA_WS = env.PALLIORA_WS || "wss://manas-rpc.palliora.org";
export let PALLIORA_RPC_URL = env.PALLIORA_RPC_URL || "wss://manas-rpc.palliora.org";

export let DEBUG = env.DEBUG === "true" || false;

export let TX_WAIT_FINALIZATION = env.TX_WAIT_FINALIZATION === "true" || false;

export let COST_ESTIMATOR_URL = env.COST_ESTIMATOR_URL || "http://localhost:4141";

export let AUTH_SERVICE_URL = env.AUTH_SERVICE_URL || "http://localhost:3000";

export let AWS_REGION = env.AWS_REGION || "us-east-1";

export let AWS_S3_BUCKET = env.AWS_S3_BUCKET || "palliora-storage";

export let provider = new WsProvider(PALLIORA_WS, 10000);

export function configure(opts: {
  pallioraWs?: string;
  pallioraRpcUrl?: string;
  debug?: boolean;
  txWaitFinalization?: boolean;
  costEstimatorUrl?: string;
  authServiceUrl?: string;
  awsRegion?: string;
  awsS3Bucket?: string;
}) {

  if (opts.pallioraWs !== undefined) PALLIORA_WS = opts.pallioraWs;
  if (opts.pallioraRpcUrl !== undefined) PALLIORA_RPC_URL = opts.pallioraRpcUrl;
  if (opts.debug !== undefined) DEBUG = opts.debug;
  if (opts.txWaitFinalization !== undefined) TX_WAIT_FINALIZATION = opts.txWaitFinalization;
  if (opts.costEstimatorUrl !== undefined) COST_ESTIMATOR_URL = opts.costEstimatorUrl;
  if (opts.authServiceUrl !== undefined) AUTH_SERVICE_URL = opts.authServiceUrl;
  if (opts.awsRegion !== undefined) AWS_REGION = opts.awsRegion;
  if (opts.awsS3Bucket !== undefined) AWS_S3_BUCKET = opts.awsS3Bucket;

  provider = new WsProvider(PALLIORA_WS, 10000);
}