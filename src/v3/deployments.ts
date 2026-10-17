import type { Address } from "viem";
import { ARC_MAINNET_CHAIN_ID } from "../addresses";

/**
 * The v3 generation: coins paired with a token other than USDC (gold, XAUm, first), on their own
 * Flaunch v1.3.3 contracts next to the v2 ones, which never change. Every coin's creator NFT sits
 * in a v3 DividendVault from its first block, and its holders earn the pair token.
 *
 * Source of truth: deployments/arc-mainnet-5042-v3.json in the contracts repo, mirrored by the
 * site's registry (apps/web/src/features/ubi/deployments.ts `v3`).
 */

/** A pair token and the USDC Uniswap v3 pool its buys and sells route through. */
export interface V3Pair {
  token: Address;
  symbol: string;
  decimals: number;
  /** The USDC/pair Uniswap v3 pool (gold: fee 500, the pool the launch price reads) */
  usdcPool: Address;
  usdcPoolFee: number;
  /** The pair's deployed TWAP price contract (UniswapV3TwapPriceCalculator) */
  priceCalculator: Address;
}

export interface V3Deployment {
  positionManager: Address;
  flaunchZap: Address;
  flaunch: Address;
  /** PairFeeCalculator: rates, size fee and anti-snipe fee per pool */
  feeCalculator: Address;
  /** The DividendVault implementation every v3 launch clones */
  dividendVault: Address;
  treasuryManagerFactory: Address;
  referralEscrow: Address;
  /** Gold first */
  pairs: V3Pair[];
}

/** From the deploy artifact (deployed 2026-10-17, block 26403042). */
export const V3_DEPLOYMENTS: { [chainId: number]: V3Deployment | undefined } = {
  [ARC_MAINNET_CHAIN_ID]: {
    positionManager: "0x01427fC5b40d6Dd3289b0052fB90DBF8dd5Ba5dc",
    flaunchZap: "0x4A08182bffbA288949a909a3794201E92d6723fC",
    flaunch: "0xe176B60D90b4b036B9E05405b0F0F86C2e624E0a",
    feeCalculator: "0x229fA6600F8C4B93B984f96A458cDFC21bC44ae4",
    dividendVault: "0x1b7a08DB3cCaAF595d8Eb4275EB7B48d996134D9",
    treasuryManagerFactory: "0x8B555dB465Be15d843132C9e90c80A6540C4277D",
    referralEscrow: "0x33c0824636F909B13bbD33E1F893C913569beD0b",
    pairs: [
      {
        token: "0x178b01f61CBeA1D2a5581Fe1621Be607835EC349",
        symbol: "XAUm",
        decimals: 18,
        usdcPool: "0x5E82892d361A6C680027A97da2280064B8FC8A52",
        usdcPoolFee: 500,
        priceCalculator: "0xe2c5E3AC7F595a7E7dC97d2fdF4dB16e9B4E9044",
      },
    ],
  },
};

/** Universal Router 2.1.2, Permit2 and Uniswap's v3 QuoterV2 on Arc. */
export const ARC_UNIVERSAL_ROUTER = "0x8702463e73f74d0b6765aBceb314Ef07aCb92650" as const;
export const PERMIT2 = "0x000000000022D473030F116dDEE9F6B43aC78BA3" as const;
export const ARC_V3_QUOTER = "0x7dfd4f31be6814d2906bde155c3e1b146eac1468" as const;

export function getV3Deployment(chainId: number): V3Deployment {
  const deployment = V3_DEPLOYMENTS[chainId];
  if (!deployment) {
    throw new Error(`ubi.fun v3 is not deployed on chain ${chainId}`);
  }
  return deployment;
}
