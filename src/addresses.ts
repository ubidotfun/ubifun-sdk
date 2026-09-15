import { Addresses } from "./types";

/**
 * ubi.fun deployments on Arc (Circle).
 *
 * Source of truth: deployments/arc-mainnet-5042.json and
 * deployments/arc-testnet-5042002.json in the contracts repo, mirrored by the
 * committed frontend registry. The cash / native asset on Arc is native USDC
 * (6 decimals through its ERC20 interface) at
 * 0x3600000000000000000000000000000000000000: the position manager's
 * "nativeToken" slot IS this USDC, and every pool pairs a coin against it.
 * There is no flETH, no WETH wrapping, and no unwrap step on this chain.
 */
export const ARC_MAINNET_CHAIN_ID = 5042;
export const ARC_TESTNET_CHAIN_ID = 5042002;

/** Arc native USDC (ERC20 interface, 6 decimals). The cash side of every pool. */
export const USDC_ADDRESS =
  "0x3600000000000000000000000000000000000000" as const;

/**
 * The pool "native token": Arc native USDC on both networks. Kept as an
 * Addresses map so client code stays chain-keyed like every other contract.
 */
export const NativeTokenAddress: Addresses = {
  [ARC_MAINNET_CHAIN_ID]: USDC_ADDRESS,
  [ARC_TESTNET_CHAIN_ID]: USDC_ADDRESS,
};

export const FlaunchZapAddress: Addresses = {
  [ARC_MAINNET_CHAIN_ID]: "0xe07F7cA66EC795592385018Dd998F0B50b8A2834",
  [ARC_TESTNET_CHAIN_ID]: "0x3fd667aaa89519772bb44e984de408bfcd40e285",
};

// SDK "FlaunchPositionManager" maps to our deployment "PositionManager".
export const FlaunchPositionManagerAddress: Addresses = {
  [ARC_MAINNET_CHAIN_ID]: "0xC780c0f4aAc690908854D351b8bFda2812daeFDc",
  [ARC_TESTNET_CHAIN_ID]: "0x88af0b76752ff31aa351cea2cc2e43a1b7c32fdc",
};

export const FlaunchAddress: Addresses = {
  [ARC_MAINNET_CHAIN_ID]: "0x93E5A7565008db9688BA5211Fa552d8b108B9c75",
  [ARC_TESTNET_CHAIN_ID]: "0x55a0e1a458f1c13023dbd6b204e2a439c3b44663",
};

export const FairLaunchAddress: Addresses = {
  [ARC_MAINNET_CHAIN_ID]: "0xdCDADa707264d9e2B0E8c2feC467860C97434Bd4",
  [ARC_TESTNET_CHAIN_ID]: "0xd2ea5591fe0b5820b6de33afbc3b468d070038ea",
};

// SDK "BidWall" maps to our deployment "BurningBidWall" (a modified BidWall).
export const BidWallAddress: Addresses = {
  [ARC_MAINNET_CHAIN_ID]: "0xC5DD30802fefab789Cd9b1e835Bd7301a8D23F8A",
  [ARC_TESTNET_CHAIN_ID]: "0x04f947e5fc0ac42836f880d45705af7483a2c4c0",
};

/** Referrer-aware swap router: the supported way to trade ubi.fun pools. */
export const PoolSwapAddress: Addresses = {
  [ARC_MAINNET_CHAIN_ID]: "0x3A61B6E86fde5Fc657a48819837F346C7E2Fffa7",
  [ARC_TESTNET_CHAIN_ID]: "0x396d41eb4d110d64491d01cd186548fdc82b1b4a",
};

export const TreasuryManagerFactoryAddress: Addresses = {
  [ARC_MAINNET_CHAIN_ID]: "0xE25C132F379DB49C463328eF427E28DBCbD3a2F0",
  [ARC_TESTNET_CHAIN_ID]: "0x093c10b780f7cf8fca9aa7dbc83a64cddf55215f",
};

// The approved AddressFeeSplitManager IMPLEMENTATION (factory deploys clones).
export const AddressFeeSplitManagerAddress: Addresses = {
  [ARC_MAINNET_CHAIN_ID]: "0xde10818344f5ab75ecfA772887cE5751D6Cb91C7",
  [ARC_TESTNET_CHAIN_ID]: "0xA7d182B81aF7B40b6d09Da88A12a4f7ad770e162",
};

/** Creator revenue escrow: balances accrue here, claimed as USDC (unwrap=false). */
export const FeeEscrowAddress: Addresses = {
  [ARC_MAINNET_CHAIN_ID]: "0x678f0D1C045e820Ec1d4806749f2629e1035550e",
  [ARC_TESTNET_CHAIN_ID]: "0x59b3269aaf9db83bd3029c84d8b5226fa5702f78",
};

/** Referrer rewards escrow: 5% of every swap fee routed with your address. */
export const ReferralEscrowAddress: Addresses = {
  [ARC_MAINNET_CHAIN_ID]: "0xf25B9ceAba005CcCb0cefC4e323e6e519F111eB3",
  [ARC_TESTNET_CHAIN_ID]: "0x51b6a4759f9c9a681349c857f6fd912cdfeb8fef",
};

/** X-handle earnings registry: per-handle CREATE2 escrows + attested claims. */
export const XHandleClaimsAddress: Addresses = {
  [ARC_MAINNET_CHAIN_ID]: "0xfC38298590893c39E46D319aEd9EC3bf6CB17A3E",
  [ARC_TESTNET_CHAIN_ID]: "0x6fE2b9e1Da493E4584e742C03e1926a4CD8AC2A1",
};

/**
 * Morpho UniversalRewardsDistributor paying the daily USDC holder pool
 * (24% of every swap fee). Claims are Merkle-proofed cumulative amounts.
 */
export const UniversalRewardsDistributorAddress: Addresses = {
  [ARC_MAINNET_CHAIN_ID]: "0x66003091e723778d7D3285BB6c24ff3F0Ddcc7F7",
  [ARC_TESTNET_CHAIN_ID]: "0x7a8e9dA46db2be8436c4404476b40F07a31A6d95",
};

/** Uniswap v4 PoolManager (canonical deployment on mainnet, ours on testnet). */
export const PoolManagerAddress: Addresses = {
  [ARC_MAINNET_CHAIN_ID]: "0x8366a39CC670B4001A1121B8F6A443A643e40951",
  [ARC_TESTNET_CHAIN_ID]: "0x5fb24c800133a0930280788c5eb3468764154309",
};

export const QuoterAddress: Addresses = {
  [ARC_MAINNET_CHAIN_ID]: "0x4595D3CD7A6D98d83A719934e829db5076fF1d0d",
  [ARC_TESTNET_CHAIN_ID]: "0xf517623f178Ba90e5b3299cb121D38F5A0733ac4",
};

/**
 * Uniswap v4 StateView (canonical periphery view over PoolManager storage).
 *
 * MAINNET ONLY. Arc testnet runs our own PoolManager instance, and no StateView
 * was deployed against it, so there is no testnet entry. The SDK does not
 * depend on StateView on either network: `ReadPoolManager` reads slot0,
 * liquidity, positions and tick data straight from PoolManager storage with
 * `extsload`, using the same slot derivations as Uniswap's StateLibrary. Use
 * that path if you need one code path across both chains.
 */
export const StateViewAddress: Addresses = {
  [ARC_MAINNET_CHAIN_ID]: "0xf3334192d15450cdd385c8b70e03f9a6bd9e673b",
};

/**
 * IndexerSubscriber: on-chain reverse index PoolId -> (flaunch, memecoin,
 * memecoinTreasury, tokenId). Attached to the PositionManager's Notifier, so it
 * is populated at pool initialisation. See contracts/IndexerSubscriber.sol.
 */
export const IndexerSubscriberAddress: Addresses = {
  [ARC_MAINNET_CHAIN_ID]: "0x2c68B21C9f8b899a662A71dd188C1c919D578a9F",
  [ARC_TESTNET_CHAIN_ID]: "0xe6d8164d67c60ff860e1a0d90636f5f65b665be7",
};

/** Base URL of the ubi.fun read/upload API serving each network. */
export const ApiBaseUrl: { [chainId: number]: string } = {
  [ARC_MAINNET_CHAIN_ID]: "https://api.ubi.fun",
  [ARC_TESTNET_CHAIN_ID]: "https://api-dev.ubi.fun",
};
