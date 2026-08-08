import { Address, Hex } from "viem";

export interface Addresses {
  [chainId: number]: Address;
}

export interface PoolKey {
  currency0: Address;
  currency1: Address;
  fee: number;
  tickSpacing: number;
  hooks: Address;
}

export interface CoinMetadata {
  name: string;
  description: string;
  image: string;
  external_link: string;
  collaborators: string[];
  discordUrl: string;
  twitterUrl: string;
  telegramUrl: string;
}

export interface IPFSParams {
  metadata: {
    base64Image: string;
    description: string;
    websiteUrl?: string;
    discordUrl?: string;
    twitterUrl?: string;
    telegramUrl?: string;
  };
}

/**
 * Parsed data from a PoolCreated event (the ubi.fun v5 PositionManager shape:
 * FlaunchParams carries fairLaunchDuration).
 */
export type PoolCreatedEventData = {
  poolId: Hex;
  memecoin: Address;
  memecoinTreasury: Address;
  tokenId: bigint;
  currencyFlipped: boolean;
  flaunchFee: bigint;
  params: {
    name: string;
    symbol: string;
    tokenUri: string;
    initialTokenFairLaunch: bigint;
    fairLaunchDuration: bigint;
    premineAmount: bigint;
    creator: Address;
    creatorFeeAllocation: number;
    flaunchAt: bigint;
    initialPriceParams: Hex;
    feeCalculatorParams: Hex;
  };
};
