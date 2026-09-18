import { WsProvider } from "@polkadot/api";

/** Values the host application must supply through {@link init}. */
export interface PallioraConfig {
  /** WebSocket endpoint used for the chain API connection. */
  pallioraWs: string;
  /** RPC endpoint, when it differs from {@link PallioraConfig.pallioraWs}. */
  pallioraRpcUrl: string;
  /** Base URL of the cost-estimation service. */
  costEstimatorUrl: string;
  /** Base URL of the auth service that issues S3 pre-signed URLs. */
  authServiceUrl: string;
  /** AWS region of the artifact storage bucket. */
  awsRegion: string;
  /** Name of the artifact storage bucket. */
  awsS3Bucket: string;
  /** Enables debug logging. Defaults to `false`. */
  debug: boolean;
  /** Waits for finalization instead of returning once a tx is in-block. Defaults to `false`. */
  txWaitFinalization: boolean;
}

type RequiredKey = Exclude<keyof PallioraConfig, "debug" | "txWaitFinalization">;

let config: Partial<PallioraConfig> | null = null;
let cachedProvider: WsProvider | null = null;
let cachedProviderUrl: string | null = null;

/**
 * Initializes the SDK. Call this once, before any other SDK function.
 *
 * @remarks
 * Repeated calls merge into the existing configuration, so a host can supply
 * the chain endpoint at startup and storage settings later.
 */
export function init(options: Partial<PallioraConfig>): void {
  config = { ...config, ...options };
}

/** Whether {@link init} has been called. */
export function isInitialized(): boolean {
  return config !== null;
}

/** Clears the configuration. Intended for tests. */
export function resetConfig(): void {
  config = null;
  cachedProvider = null;
  cachedProviderUrl = null;
}

function read<K extends RequiredKey>(key: K): NonNullable<PallioraConfig[K]> {
  if (!config) {
    throw new Error(
      `Palliora SDK is not initialized: cannot read "${key}". ` +
        `Call init({ ${key}: ... }) before using the SDK.`,
    );
  }

  const value = config[key];
  if (value === undefined) {
    throw new Error(
      `Palliora SDK config "${key}" is not set. Pass it to init({ ${key}: ... }).`,
    );
  }

  return value as NonNullable<PallioraConfig[K]>;
}

/** @throws when `pallioraWs` was not supplied to {@link init}. */
export const getPallioraWs = (): string => read("pallioraWs");

/** @throws when `pallioraRpcUrl` was not supplied to {@link init}. */
export const getPallioraRpcUrl = (): string => read("pallioraRpcUrl");

/** @throws when `costEstimatorUrl` was not supplied to {@link init}. */
export const getCostEstimatorUrl = (): string => read("costEstimatorUrl");

/** @throws when `authServiceUrl` was not supplied to {@link init}. */
export const getAuthServiceUrl = (): string => read("authServiceUrl");

/** @throws when `awsRegion` was not supplied to {@link init}. */
export const getAwsRegion = (): string => read("awsRegion");

/** @throws when `awsS3Bucket` was not supplied to {@link init}. */
export const getAwsS3Bucket = (): string => read("awsS3Bucket");

/** Defaults to `false` when not supplied to {@link init}. */
export const isDebug = (): boolean => config?.debug ?? false;

/** Defaults to `false` when not supplied to {@link init}. */
export const waitsForFinalization = (): boolean => config?.txWaitFinalization ?? false;

/**
 * Returns the shared {@link WsProvider}, creating it on first use and replacing
 * it whenever `pallioraWs` changes.
 *
 * @throws when `pallioraWs` was not supplied to {@link init}.
 */
export function getProvider(): WsProvider {
  const url = getPallioraWs();

  if (!cachedProvider || cachedProviderUrl !== url) {
    cachedProvider = new WsProvider(url, 10000);
    cachedProviderUrl = url;
  }

  return cachedProvider;
}
