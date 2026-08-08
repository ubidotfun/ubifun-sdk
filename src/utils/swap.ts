import { encodeAbiParameters, isAddress, zeroAddress, type Address } from "viem";
import { PoolKey } from "../types";
import { USDC_ADDRESS } from "../addresses";
import { orderPoolKey, Q192 } from "./univ4";

/**
 * Swap-building helpers shared by the quoter and PoolSwap clients. Pool keys,
 * hook data and direction mirror the ubi.fun app and MCP server exactly; the
 * SDK's price bound additionally anchors on the quoted end price so an
 * exact-input trade's own impact does not eat the slippage budget.
 */

/**
 * Encodes the referrer for the hook: 5% of the swap fee accrues on-chain to
 * this address (claimable from the ReferralEscrow). '0x' means no referrer and
 * the share cascades down the fee split instead. The SAME hookData must be
 * used for the quote and the swap for them to match.
 */
export function referrerHookData(
  referrer: Address | undefined
): `0x${string}` {
  return referrer && isAddress(referrer) && referrer !== zeroAddress
    ? encodeAbiParameters([{ type: "address" }], [referrer])
    : "0x";
}

/** Builds the v4 pool key for a coin: USDC on the cash side, hook fixed by the protocol. */
export function coinPoolKey(
  coinAddress: Address,
  positionManagerAddress: Address
): PoolKey {
  return orderPoolKey({
    currency0: USDC_ADDRESS,
    currency1: coinAddress,
    fee: 0,
    tickSpacing: 60,
    hooks: positionManagerAddress,
  });
}

/** True when USDC sorts as currency0 for this coin's pool. */
export function usdcIsCurrencyZero(coinAddress: Address): boolean {
  return coinAddress.toLowerCase() > USDC_ADDRESS.toLowerCase();
}

/**
 * v4 swap direction. Buys spend USDC for the coin: when USDC is currency0
 * that's a zeroForOne swap, otherwise the reverse.
 */
export function swapDirection(
  side: "buy" | "sell",
  coinAddress: Address
): boolean {
  return side === "buy"
    ? usdcIsCurrencyZero(coinAddress)
    : !usdcIsCurrencyZero(coinAddress);
}

// Uniswap v4 sqrt price bounds (TickMath.MIN_SQRT_PRICE / MAX_SQRT_PRICE, exclusive).
const MIN_SQRT_PRICE = 4_295_128_739n + 1n;
const MAX_SQRT_PRICE =
  1_461_446_703_485_210_103_287_273_052_203_988_822_378_723_970_342n - 1n;

function bigintSqrt(value: bigint): bigint {
  if (value < 2n) {
    return value;
  }
  let current = value;
  let next = (current + value / current) / 2n;
  while (next < current) {
    current = next;
    next = (current + value / current) / 2n;
  }
  return current;
}

/**
 * Expected pool sqrt price after an exact-input fill, derived from the quoted
 * amounts through the constant-liquidity identity amountOut/amountIn =
 * sqrtP_start * sqrtP_end (inverted for oneForZero). Hook fees only skew the
 * estimate toward the permissive side, so a slippage margin applied on top of
 * it never lands tighter than the real fill. Falls back to the spot price when
 * a quote leg is zero or the estimate lands on the wrong side of spot.
 */
export function expectedEndSqrtPriceX96({
  current,
  zeroForOne,
  amountIn,
  amountOut,
}: {
  current: bigint;
  zeroForOne: boolean;
  amountIn: bigint;
  amountOut: bigint;
}): bigint {
  if (current === 0n || amountIn <= 0n || amountOut <= 0n) {
    return current;
  }
  const end = zeroForOne
    ? (amountOut * Q192) / (amountIn * current)
    : (amountIn * Q192) / (amountOut * current);
  if (zeroForOne) {
    return end < current ? end : current;
  }
  return end > current ? end : current;
}

/**
 * Slippage bound as a sqrt price limit: the pool price may move at most
 * `slippageBps` beyond `current` (pass the expected end price for exact-input
 * swaps, so the trade's own quoted impact is not counted against the budget)
 * before the swap stops filling.
 */
export function sqrtPriceLimit({
  current,
  zeroForOne,
  slippageBps,
}: {
  current: bigint;
  zeroForOne: boolean;
  slippageBps: number;
}): bigint {
  if (
    !Number.isInteger(slippageBps) ||
    slippageBps < 0 ||
    slippageBps >= 10_000
  ) {
    throw new Error(
      `slippageBps must be an integer in [0, 10000), got ${slippageBps}`
    );
  }
  const factor = BigInt(
    zeroForOne ? 10_000 - slippageBps : 10_000 + slippageBps
  );
  const multiplier = bigintSqrt((factor * 10n ** 18n) / 10_000n);
  const limit = (current * multiplier) / 10n ** 9n;
  return zeroForOne
    ? limit > MIN_SQRT_PRICE
      ? limit
      : MIN_SQRT_PRICE
    : limit < MAX_SQRT_PRICE
      ? limit
      : MAX_SQRT_PRICE;
}
