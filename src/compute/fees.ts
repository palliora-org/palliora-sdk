import { getApi } from "../chain";
import { assert } from "../utils";
import { toAtomicPaliAmount } from "../utils/token";
import type { PaliAmountInput } from "../utils/token";

/**
 * The chain-side parameters the compute fee floor is derived from.
 *
 * All four are read live: the first three are root-settable storage values
 * (`compute.setMaxDaStorageSize`, `setProviderStorageRate`,
 * `setThresholdDecryptionFee`), so a hard-coded copy goes stale silently and
 * surfaces only as an `InsufficientFreeBalance` at submission time.
 */
export interface FeeParams {
  /** Bytes of DA storage a result is priced against. */
  maxDaStorageSize: bigint;
  /** Price per byte of DA storage, in atomic units. */
  providerStorageRate: bigint;
  /** Flat fee split between the contract's guardians, in atomic units. */
  thresholdDecryptionFee: bigint;
  /** Block time in milliseconds, the multiplier applied to `computeRate`. */
  millisecondsPerBlock: bigint;
}

export interface MinFeeInput {
  /** Per-millisecond compute rate the contract offers, in PALI. */
  computeRate: PaliAmountInput;
  /** Contract ID supplying the input, whose owner is owed the input fee. */
  inputContractId?: string;
}

/** The fee floor and the four components it is built from, all in atomic units. */
export interface MinFeeBreakdown {
  /** `maxDaStorageSize * providerStorageRate` — pays whoever submits the result. */
  resultFee: bigint;
  /** `usagePrice` of the referenced input contract, or 0 when none is referenced. */
  inputFee: bigint;
  /** Flat threshold-decryption fee, split between the contract's guardians. */
  thresholdDecryptionFee: bigint;
  /** `computeRate * millisecondsPerBlock` — one block's worth of compute. */
  offeredComponent: bigint;
  /** The sum: the smallest `fees` the chain accepts for this contract. */
  minFee: bigint;
}

/**
 * `MillisecondsPerBlock` is a plain `Get<u64>` on `pallet_compute::Config`, not a
 * `#[pallet::constant]`, so it is absent from metadata and cannot be read as
 * `api.consts.compute.millisecondsPerBlock`. The runtime wires both it and
 * `Babe::ExpectedBlockTime` to the same `MILLISECS_PER_BLOCK` constant, so Babe's
 * copy is read instead, falling back to twice the timestamp minimum period.
 */
async function readMillisecondsPerBlock(): Promise<bigint> {
  const api = await getApi();
  assert(api, "Api not initialized");

  const expectedBlockTime = api.consts.babe?.expectedBlockTime;
  if (expectedBlockTime) {
    return BigInt(expectedBlockTime.toString());
  }

  const minimumPeriod = api.consts.timestamp?.minimumPeriod;
  assert(minimumPeriod, "Cannot determine block time: neither babe.expectedBlockTime nor timestamp.minimumPeriod exists");

  return BigInt(minimumPeriod.toString()) * 2n;
}

/**
 * Reads the four live chain parameters that define the compute fee floor.
 *
 * Throws when the connected runtime predates the metered-compute upgrade: older
 * runtimes expose a `compute` pallet with neither these storage items nor the
 * `Contract`-shaped `agreement` call, so there is no fee floor to report.
 */
export async function getFeeParams(): Promise<FeeParams> {
  const api = await getApi();
  assert(api, "Api not initialized");
  assert(
    api.query.compute?.maxDaStorageSize,
    "compute.maxDaStorageSize does not exist on this runtime: the connected chain predates " +
      "metered compute, and has no fee floor. Check PALLIORA_WS points at a current node.",
  );

  const [maxDaStorageSize, providerStorageRate, thresholdDecryptionFee, millisecondsPerBlock] =
    await Promise.all([
      api.query.compute.maxDaStorageSize(),
      api.query.compute.providerStorageRate(),
      api.query.compute.thresholdDecryptionFee(),
      readMillisecondsPerBlock(),
    ]);

  return {
    maxDaStorageSize: BigInt(maxDaStorageSize.toString()),
    providerStorageRate: BigInt(providerStorageRate.toString()),
    thresholdDecryptionFee: BigInt(thresholdDecryptionFee.toString()),
    millisecondsPerBlock,
  };
}

/**
 * Computes the smallest `fees` an `Active` or `Subscription` contract may offer.
 *
 * Mirrors `pallet_compute::Pallet::fee_components`, which `CheckCompute` enforces
 * when validating the extrinsic and which `compute.result` settles against. An
 * offer below this floor is rejected as `InsufficientFreeBalance` before the
 * agreement is ever included in a block.
 *
 * Clearing this floor is necessary but not sufficient: guardians independently
 * reject an agreement whose `computeRate` is under their own per-compute-type
 * threshold. See CHAIN-RULES.md ("Two gates, not one").
 *
 * `Dormant` contracts reserve nothing and are exempt — they may offer any `fees`,
 * including zero.
 */
export async function estimateMinFee(input: MinFeeInput): Promise<MinFeeBreakdown> {
  const api = await getApi();
  assert(api, "Api not initialized");

  const params = await getFeeParams();

  const resultFee = params.maxDaStorageSize * params.providerStorageRate;

  let inputFee = 0n;
  if (input.inputContractId) {
    const contract = (await api.query.compute.contracts(input.inputContractId)).toJSON() as Record<
      string,
      unknown
    > | null;
    if (contract) {
      inputFee = BigInt(String(contract["usagePrice"] ?? contract["usage_price"] ?? 0));
    }
  }

  const offeredComponent = toAtomicPaliAmount(input.computeRate) * params.millisecondsPerBlock;

  return {
    resultFee,
    inputFee,
    thresholdDecryptionFee: params.thresholdDecryptionFee,
    offeredComponent,
    minFee: resultFee + inputFee + params.thresholdDecryptionFee + offeredComponent,
  };
}
