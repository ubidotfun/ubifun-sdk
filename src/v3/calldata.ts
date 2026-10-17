import {
  concatHex,
  encodeAbiParameters,
  encodePacked,
  isAddress,
  parseAbiParameters,
  parseUnits,
  zeroAddress,
  type Address,
  type Hex,
} from "viem";
import { USDC_ADDRESS } from "../addresses";
import type { V3Pair } from "./deployments";

/**
 * Pure builders for v3 launches and trades, ported unchanged from the ubi.fun site
 * (apps/web/src/features/ubi/v3.ts, goldRoute.ts, prebuyV3.ts, sendLaunchV3.ts), where they are
 * tested and proven against the live Arc contracts. Units follow the contracts: rates in
 * FeeDistributor units (100_00 = 100%), shares in DividendVault units (100_00 = 100%).
 */

/** PairFeeCalculator MIN_FEE / MAX_FEE: buy and sell rates. */
export const V3_MIN_FEE = 150;
export const V3_MAX_FEE = 500;
/** PairFeeCalculator MAX_ANTI_SNIPE_FEE / MAX_ANTI_SNIPE_DURATION / MAX size fee. */
export const V3_MAX_ANTI_SNIPE_FEE = 60_00;
export const V3_MAX_ANTI_SNIPE_DURATION = 600;
export const V3_MAX_SIZE_FEE = 350;
/** DividendVault MIN_HOLDER_STREAM_SHARE: holders get at least 1/6 of the creator stream. */
export const V3_MIN_HOLDER_STREAM_SHARE = 16_67;
export const V3_SHARE_DENOMINATOR = 100_00;
/** Every v3 coin's supply: 1 billion with 18 decimals (contracts-v3 TokenSupply.INITIAL_SUPPLY). */
export const V3_TOTAL_SUPPLY = 1_000_000_000n * 10n ** 18n;
/** The Underwater pot's minimum holding, whole coins (DividendVault MIN/MAX_UNDERWATER_HOLDING). */
export const V3_MIN_UNDERWATER_HOLDING = 1_000;
export const V3_MAX_UNDERWATER_HOLDING = 5_000_000;

export interface V3FeeSettings {
  buyFee: number;
  sellFee: number;
  /** Pair-token raw units; 0 with sizeFee 0 (no size fee) */
  sizeThreshold: bigint;
  sizeFee: number;
  /** Both 0 turns the anti-snipe fee off */
  antiSnipeFee: number;
  antiSnipeDuration: number;
}

/**
 * `feeCalculatorParams` for a v3 launch: exactly six words, as PairFeeCalculator._decodeParams
 * reads them. Out-of-range settings throw here rather than revert on-chain.
 */
export function v3FeeCalculatorParams(settings: V3FeeSettings): Hex {
  const { buyFee, sellFee, sizeThreshold, sizeFee, antiSnipeFee, antiSnipeDuration } = settings;
  const inRate = (rate: number): boolean => Number.isInteger(rate) && rate >= V3_MIN_FEE && rate <= V3_MAX_FEE;
  if (!inRate(buyFee) || !inRate(sellFee)) {
    throw new Error("Buy and sell rates must be 1.5% to 5%");
  }
  if (!Number.isInteger(sizeFee) || sizeFee < 0 || sizeFee > V3_MAX_SIZE_FEE) {
    throw new Error("The size fee must be 0% to 3.5%");
  }
  if (sizeFee === 0 ? sizeThreshold !== 0n : sizeThreshold <= 0n || sizeThreshold >= 2n ** 128n) {
    throw new Error("A size fee needs a threshold, and no size fee needs none");
  }
  const antiSnipeOff = antiSnipeFee === 0 && antiSnipeDuration === 0;
  const antiSnipeOk =
    Number.isInteger(antiSnipeFee) &&
    Number.isInteger(antiSnipeDuration) &&
    antiSnipeFee > buyFee &&
    antiSnipeFee <= V3_MAX_ANTI_SNIPE_FEE &&
    antiSnipeDuration >= 1 &&
    antiSnipeDuration <= V3_MAX_ANTI_SNIPE_DURATION;
  if (!antiSnipeOff && !antiSnipeOk) {
    throw new Error("Anti-snipe fee must be above the buy rate and at most 60%, for 1 to 600 seconds");
  }
  return encodeAbiParameters(
    [
      { type: "uint256" },
      { type: "uint256" },
      { type: "uint256" },
      { type: "uint256" },
      { type: "uint256" },
      { type: "uint256" },
    ],
    [BigInt(buyFee), BigInt(sellFee), sizeThreshold, BigInt(sizeFee), BigInt(antiSnipeFee), BigInt(antiSnipeDuration)]
  );
}

/**
 * The lowest holder share the vault accepts for a creator side (`creatorFeeAllocation`, 2dp):
 * `holderShare × creatorFee ≥ 16_67 × 100_00`, so holders always get 1/6 of the creator stream.
 */
export function minV3HolderShare(creatorFeeAllocation: number): number {
  if (creatorFeeAllocation <= 0) {
    return V3_SHARE_DENOMINATOR;
  }
  return Math.min(
    V3_SHARE_DENOMINATOR,
    Math.ceil((V3_MIN_HOLDER_STREAM_SHARE * V3_SHARE_DENOMINATOR) / creatorFeeAllocation)
  );
}

/**
 * The v3 DividendVault's `initializeData`: `abi.encode(holderShare, underwaterShare,
 * underwaterMinHolding, recipients, shares)`. Without `underwater` the Underwater slice is off
 * (both 0). The launcher is last and takes what the others leave.
 */
export function v3VaultInitializeData({
  holderShare,
  others,
  launcher,
  underwater,
}: {
  holderShare: number;
  others: { recipient: Address; bps: number }[];
  launcher: Address;
  /** An Underwater pot: its share of what the vault receives (bps) and the minimum holding in whole coins */
  underwater?: { share: number; minHolding: number };
}): Hex {
  const othersTotal = others.reduce((sum, row) => sum + row.bps, 0);
  if (othersTotal >= V3_SHARE_DENOMINATOR) {
    throw new Error("Recipient shares leave nothing for the launcher");
  }
  const underwaterShare = underwater?.share ?? 0;
  const minHolding = underwaterShare > 0 ? (underwater?.minHolding ?? 0) : 0;
  if (!Number.isInteger(underwaterShare) || underwaterShare < 0 || holderShare + underwaterShare > V3_SHARE_DENOMINATOR) {
    throw new Error("Holder dividends and the Underwater pot take at most everything the vault receives");
  }
  if (
    underwaterShare > 0 &&
    (!Number.isInteger(minHolding) || minHolding < V3_MIN_UNDERWATER_HOLDING || minHolding > V3_MAX_UNDERWATER_HOLDING)
  ) {
    throw new Error("The Underwater minimum holding must be 1,000 to 5,000,000 coins");
  }
  return encodeAbiParameters(
    [{ type: "uint256" }, { type: "uint256" }, { type: "uint256" }, { type: "address[]" }, { type: "uint256[]" }],
    [
      BigInt(holderShare),
      BigInt(underwaterShare),
      BigInt(minHolding),
      [...others.map((row) => row.recipient), launcher],
      [...others.map((row) => BigInt(row.bps)), BigInt(V3_SHARE_DENOMINATOR - othersTotal)],
    ]
  );
}

/** A USD amount in the pair's raw units at a price ratio (pair raw = USDC raw x den / num), rounded up, as the site. */
export function usdToPairRaw(usd: number, ratio: { num: bigint; den: bigint }): bigint {
  if (!(usd > 0) || ratio.num <= 0n || ratio.den <= 0n) {
    throw new Error("a positive amount and price are required");
  }
  const usdcRaw = BigInt(Math.round(usd * 1e6));
  return (usdcRaw * ratio.den + ratio.num - 1n) / ratio.num;
}

/** The FlaunchParams of a v3 launch; `calculateFee` reads the same struct. */
export function v3FlaunchParams(input: {
  name: string;
  symbol: string;
  tokenUri: string;
  creator: Address;
  /** The creator side of the creator stream, whole percent (90 = 90%; the rest is the buyback) */
  creatorFeePercent: number;
  /** Unix seconds trading opens; 0 = at launch */
  flaunchAt: number;
  /** Starting market cap in USD, e.g. "10000" */
  marketCapUsd: string;
  fees: V3FeeSettings;
  pair: V3Pair;
  /** Coins the creator buys in the launch transaction (0n: none) */
  premineAmount?: bigint;
}) {
  return {
    name: input.name.trim(),
    symbol: input.symbol.trim().toUpperCase(),
    tokenUri: input.tokenUri,
    premineAmount: input.premineAmount ?? 0n,
    creator: input.creator,
    creatorFeeAllocation: input.creatorFeePercent * 100,
    flaunchAt: BigInt(input.flaunchAt),
    initialPriceParams: encodeAbiParameters([{ type: "uint256" }], [parseUnits(input.marketCapUsd, 6)]),
    feeCalculatorParams: v3FeeCalculatorParams(input.fees),
    pairedToken: input.pair.token,
  };
}

/** The coins a pre-buy of `percent` of the supply buys (0 for none). */
export function v3PremineAmount(percent: number): bigint {
  if (!Number.isInteger(percent) || percent < 0 || percent > 100) {
    throw new Error(`pre-buy percent must be a whole number from 0 to 100, got ${percent}`);
  }
  return (V3_TOTAL_SUPPLY * BigInt(percent)) / 100n;
}

/**
 * The slippage (bps) added to the zap's pre-buy quote: the zap's 1% buffer covers ordinary
 * pre-buys only; buying `percent`% of the supply off the launch position costs about
 * 1 / (1 - percent%) of linear. This adds that impact, rounded up, plus 0.5% (fork-tested through
 * the zap at 1, 2 and 5%). Over-funding is refunded by the zap.
 */
export function v3PrebuySlippageBps(percent: number): number {
  if (!Number.isInteger(percent) || percent <= 0 || percent >= 100) {
    throw new Error(`pre-buy percent must be a whole number from 1 to 99, got ${percent}`);
  }
  return Math.ceil((100_00 * percent) / (100 - percent)) + 50;
}

/** The pre-buy's cost cap: the zap's quote with {@link v3PrebuySlippageBps}, in the zap's own arithmetic. */
export function v3PrebuyCap(quotedCost: bigint, percent: number): bigint {
  return quotedCost + (quotedCost * BigInt(v3PrebuySlippageBps(percent))) / 100_00n;
}

/** A referrer's hookData for v3 coin swaps (empty for none). */
export function referrerHookData(referrer?: string): Hex {
  return referrer && isAddress(referrer) && referrer !== zeroAddress
    ? encodeAbiParameters([{ type: "address" }], [referrer])
    : "0x";
}

export interface V3PoolKey {
  currency0: Address;
  currency1: Address;
  fee: number;
  tickSpacing: number;
  hooks: Address;
}

export interface RouterCall {
  commands: Hex;
  inputs: Hex[];
}

/** Universal Router commands and v4 actions (Commands.sol, Actions.sol). */
const V3_SWAP_EXACT_IN = "0x00";
const V3_SWAP_EXACT_OUT = "0x01";
const SWEEP = "0x04";
const V4_SWAP = "0x10";
const SWAP_EXACT_IN = "0x07";
const SETTLE = "0x0b";
const TAKE = "0x0e";
/** ActionConstants: the router resolves these to its caller, to itself, and to its whole balance. */
const MSG_SENDER = "0x0000000000000000000000000000000000000001";
const ADDRESS_THIS = "0x0000000000000000000000000000000000000002";
const CONTRACT_BALANCE = 1n << 255n;
const OPEN_DELTA = 0n;

const v3SwapInput = parseAbiParameters(
  "address recipient, uint256 amountIn, uint256 amountOutMin, bytes path, bool payerIsUser, uint256[] minHopPriceX36"
);
const v4SwapInput = parseAbiParameters("bytes actions, bytes[] params");
const exactInputParams = parseAbiParameters(
  "(address currencyIn, (address intermediateCurrency, uint24 fee, int24 tickSpacing, address hooks, bytes hookData)[] path, uint256[] maxHopSlippage, uint128 amountIn, uint128 amountOutMinimum)"
);
const settleParams = parseAbiParameters("address currency, uint256 amount, bool payerIsUser");
const takeParams = parseAbiParameters("address currency, address recipient, uint256 amount");
const sweepParams = parseAbiParameters("address token, address recipient, uint256 amountMin");

function v3Path({ tokenIn, fee, tokenOut }: { tokenIn: Address; fee: number; tokenOut: Address }): Hex {
  return encodePacked(["address", "uint24", "address"], [tokenIn, fee, tokenOut]);
}

function coinHop({ poolKey, currencyOut, hookData }: { poolKey: V3PoolKey; currencyOut: Address; hookData: Hex }) {
  return {
    intermediateCurrency: currencyOut,
    fee: poolKey.fee,
    tickSpacing: poolKey.tickSpacing,
    hooks: poolKey.hooks,
    hookData,
  };
}

/**
 * USDC in, coins out, in one Universal Router call: the v3 hop pays the pair to the router, the
 * router settles its whole pair balance into the PoolManager, swaps the open credit for coins
 * and takes them to the trader. Exact input only (exact-output buys revert while a coin's
 * anti-snipe fee runs).
 */
export function goldBuyCall(params: {
  pair: V3Pair;
  poolKey: V3PoolKey;
  coin: Address;
  usdcIn: bigint;
  minCoinsOut: bigint;
  hookData: Hex;
}): RouterCall {
  const v3Hop = encodeAbiParameters(v3SwapInput, [
    ADDRESS_THIS,
    params.usdcIn,
    0n,
    v3Path({ tokenIn: USDC_ADDRESS, fee: params.pair.usdcPoolFee, tokenOut: params.pair.token }),
    true,
    [],
  ]);
  const v4Hop = encodeAbiParameters(v4SwapInput, [
    concatHex([SETTLE, SWAP_EXACT_IN, TAKE]),
    [
      encodeAbiParameters(settleParams, [params.pair.token, CONTRACT_BALANCE, false]),
      encodeAbiParameters(exactInputParams, [
        {
          currencyIn: params.pair.token,
          path: [coinHop({ poolKey: params.poolKey, currencyOut: params.coin, hookData: params.hookData })],
          maxHopSlippage: [],
          amountIn: OPEN_DELTA,
          amountOutMinimum: params.minCoinsOut,
        },
      ]),
      encodeAbiParameters(takeParams, [params.coin, MSG_SENDER, OPEN_DELTA]),
    ],
  ]);
  return { commands: concatHex([V3_SWAP_EXACT_IN, V4_SWAP]), inputs: [v3Hop, v4Hop] };
}

/**
 * Coins in, USDC out: the v4 hop swaps the trader's coins for the pair to the router, the v3 hop
 * swaps the router's whole pair balance to USDC for the trader, and a final sweep returns any pair
 * a partial v3 fill left in the router.
 */
export function goldSellCall(params: {
  pair: V3Pair;
  poolKey: V3PoolKey;
  coin: Address;
  coinsIn: bigint;
  minUsdcOut: bigint;
  hookData: Hex;
}): RouterCall {
  const v4Hop = encodeAbiParameters(v4SwapInput, [
    concatHex([SWAP_EXACT_IN, SETTLE, TAKE]),
    [
      encodeAbiParameters(exactInputParams, [
        {
          currencyIn: params.coin,
          path: [coinHop({ poolKey: params.poolKey, currencyOut: params.pair.token, hookData: params.hookData })],
          maxHopSlippage: [],
          amountIn: params.coinsIn,
          amountOutMinimum: 0n,
        },
      ]),
      encodeAbiParameters(settleParams, [params.coin, OPEN_DELTA, true]),
      encodeAbiParameters(takeParams, [params.pair.token, ADDRESS_THIS, OPEN_DELTA]),
    ],
  ]);
  const v3Hop = encodeAbiParameters(v3SwapInput, [
    MSG_SENDER,
    CONTRACT_BALANCE,
    params.minUsdcOut,
    v3Path({ tokenIn: params.pair.token, fee: params.pair.usdcPoolFee, tokenOut: USDC_ADDRESS }),
    false,
    [],
  ]);
  const sweep = encodeAbiParameters(sweepParams, [params.pair.token, MSG_SENDER, 0n]);
  return { commands: concatHex([V4_SWAP, V3_SWAP_EXACT_IN, SWEEP]), inputs: [v4Hop, v3Hop, sweep] };
}

/**
 * Exactly `pairOut` of the pair to the trader for at most `maxUsdcIn` USDC, in one v3
 * exact-output hop (a pre-buy's pair). The path runs from the output to the input.
 */
export function pairExactOutCall({ pair, pairOut, maxUsdcIn }: { pair: V3Pair; pairOut: bigint; maxUsdcIn: bigint }): RouterCall {
  const hop = encodeAbiParameters(v3SwapInput, [
    MSG_SENDER,
    pairOut,
    maxUsdcIn,
    v3Path({ tokenIn: pair.token, fee: pair.usdcPoolFee, tokenOut: USDC_ADDRESS }),
    true,
    [],
  ]);
  return { commands: V3_SWAP_EXACT_OUT, inputs: [hop] };
}

/** The least a trade may return: the quote less the slippage, rounded down. */
export function minimumOut(quoted: bigint, slippageBps: number): bigint {
  return (quoted * BigInt(10_000 - slippageBps)) / 10_000n;
}
