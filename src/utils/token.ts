import { assert } from "./assert";
import { formatUnits, parseUnits } from "viem";
import { getApi } from "../chain";

export const PALI_SYMBOL = "PALI";
export const PALI_DECIMALS = 18;

interface TokenProperties {
  symbol: string;
  decimals: number;
}

export type PaliAmountInput = string | number;
export type AtomicPaliAmount = bigint;

let tokenCache: TokenProperties | null = null;

export const toAtomicPaliAmount = (amount: PaliAmountInput): AtomicPaliAmount => {
  const normalizedAmount = String(amount).trim();

  if (!normalizedAmount) {
    throw new Error("Token amount cannot be empty");
  }

  return parseUnits(normalizedAmount, PALI_DECIMALS);
};

export const fromAtomicPaliAmount = (amount: bigint): string => {
  return formatUnits(amount, PALI_DECIMALS);
};

export const formatPaliAmount = (amount: bigint, symbol: string = PALI_SYMBOL): string => {
  return `${fromAtomicPaliAmount(amount)} ${symbol}`;
};

/**
 * Fetch token name and decimals from RPC system properties
 * Results are cached for subsequent calls
 * @param rpc - RPC provider instance with system.properties method
 * @returns Promise<TokenProperties> with symbol and decimals
 */
export async function fetchTokenProperties(): Promise<TokenProperties> {
  // Return cached value if available
  if (tokenCache) {
    return tokenCache;
  }

  try {
    const systemProperties = (await (await getApi())?.rpc.system.properties())?.toHuman();

    assert(systemProperties, "Failed to fetch system properties from RPC");

    const tokenProperties: TokenProperties = {
      symbol: (systemProperties?.tokenSymbol as string[] || [PALI_SYMBOL])[0],
      decimals: Number((systemProperties?.tokenDecimals as string[] || [String(PALI_DECIMALS)])[0]),
    };

    // Store in cache
    tokenCache = tokenProperties;

    return tokenProperties;
  } catch (error) {
    throw error;
  }
}

/**
 * Get cached token properties without making an RPC call
 * @returns TokenProperties or null if not yet cached
 */
export function getCachedTokenProperties(): TokenProperties | null {
  return tokenCache;
}

/**
 * Clear the token properties cache
 */
export function clearTokenCache(): void {
  tokenCache = null;
}

/**
 * Format balance using cached token properties
 * @param balance - The balance value to format
 * @returns Formatted balance string
 */
export async function formatBalanceWithTokenProperties(balance: string | number | bigint): Promise<string> {
  const tokenProperties = await fetchTokenProperties();

  return `${formatUnits(typeof balance === "bigint" ? balance : BigInt(balance), tokenProperties.decimals)} ${tokenProperties.symbol}`;
}

export const tokenToBigint = toAtomicPaliAmount;
