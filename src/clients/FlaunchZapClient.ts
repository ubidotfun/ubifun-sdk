import {
  type ReadContract,
  type Address,
  type Drift,
  type ReadWriteContract,
  type ReadWriteAdapter,
  type HexString,
  createDrift,
} from "@delvtech/drift";
import { FlaunchZapAbi } from "../abi/FlaunchZap";
import { parseUnits, zeroAddress, zeroHash } from "viem";
import { encodeAbiParameters } from "viem";
import { generateTokenUri } from "../helpers/ipfs";
import { referrerHookData } from "../utils/swap";
import { IPFSParams } from "../types";
import { AddressFeeSplitManagerAddress } from "../addresses";

export type FlaunchZapABI = typeof FlaunchZapAbi;

export interface FlaunchParams {
  name: string;
  symbol: string;
  tokenUri: string;
  /** Percent of supply (0-95) sold at the fixed fair launch price first. 0 for no fair launch. */
  fairLaunchPercent: number;
  /** Fair launch window in seconds (0 when fairLaunchPercent is 0). */
  fairLaunchDuration: number;
  /** Initial market cap in whole USD; $10,000 is the on-chain minimum and currently fee-free. */
  initialMarketCapUSD: number;
  /** Receives the Flaunch NFT (the revenue claim) and the creator revenue. */
  creator: Address;
  /** Creator vs floor-bid split of the creator share, 0-100 (the app defaults to 90). */
  creatorFeeAllocationPercent: number;
  /** 0 (or omit) to launch now, or a start timestamp within 30 days. */
  flaunchAt?: bigint;
  /** Coins the creator buys at the launch price in the same transaction. */
  premineAmount?: bigint;
  /** Referrer credited on the premine swap fee (only relevant with premineAmount). */
  premineReferrer?: Address;
  treasuryManagerParams?: {
    manager?: Address;
    /** Permissions contract for a newly deployed manager; zero address = open. */
    permissions?: Address;
    initializeData?: HexString;
    depositData?: HexString;
  };
  /** Restrict the fair launch to a Merkle whitelist (zero root = open launch). */
  whitelistParams?: {
    merkleRoot: HexString;
    merkleIPFSHash: string;
    maxTokens: bigint;
  };
  /** Reserve part of the supply for a launch airdrop (zero values = none). */
  airdropParams?: {
    airdropIndex: bigint;
    airdropAmount: bigint;
    airdropEndTime: bigint;
    merkleRoot: HexString;
    merkleIPFSHash: string;
  };
}

export interface FlaunchIPFSParams
  extends Omit<FlaunchParams, "tokenUri">,
    IPFSParams {}

export interface FlaunchWithSplitManagerParams
  extends Omit<FlaunchParams, "treasuryManagerParams"> {
  /**
   * Other recipients and their percentages (0-100, fractional allowed, 5
   * decimal places of precision). The creator automatically receives the exact
   * remainder to 100%. A recipient can be an X-handle escrow address
   * (ReadXHandleClaims.escrowAddress) to pay a handle that has not claimed yet.
   */
  splitReceivers: {
    address: Address;
    percent: number;
  }[];
}

export interface FlaunchWithSplitManagerIPFSParams
  extends Omit<FlaunchWithSplitManagerParams, "tokenUri">,
    IPFSParams {}

/**
 * Base client for interacting with the FlaunchZap contract in read-only mode.
 * The zap is the one-transaction launch entry point: token, Uniswap v4 pool,
 * locked liquidity, fair launch, and the creator revenue stream.
 */
export class ReadFlaunchZap {
  drift: Drift;
  chainId: number;
  public readonly contract: ReadContract<FlaunchZapABI>;
  public readonly TOTAL_SUPPLY = 100n * 10n ** 27n; // 100 Billion tokens in wei

  constructor(chainId: number, address: Address, drift: Drift = createDrift()) {
    this.chainId = chainId;
    this.drift = drift;
    if (!address) {
      throw new Error("Address is required");
    }
    this.contract = drift.contract({
      abi: FlaunchZapAbi,
      address,
    });
  }

  /**
   * The msg.value required to flaunch: covers the premine purchase when there
   * is one, plus the flaunch fee for market caps at or above the on-chain
   * threshold. On Arc msg.value is native USDC at 18 decimals. Always send
   * exactly this; sending less reverts with InsufficientFlaunchFee.
   */
  valueRequiredToFlaunch(params: {
    premineAmount: bigint;
    initialPriceParams: HexString;
    slippagePercent?: number;
  }) {
    const slippagePercent = params.slippagePercent ?? 0;
    if (
      !Number.isFinite(slippagePercent) ||
      slippagePercent < 0 ||
      slippagePercent > 100
    ) {
      throw new Error(
        `slippagePercent must be between 0 and 100, got ${slippagePercent}`
      );
    }
    return this.contract.read("calculateFee", {
      _premineAmount: params.premineAmount ?? 0n,
      _slippage: BigInt(Math.round(slippagePercent * 100)),
      _initialPriceParams: params.initialPriceParams,
    });
  }
}

/**
 * Extended client for interacting with the FlaunchZap contract with write capabilities
 */
export class ReadWriteFlaunchZap extends ReadFlaunchZap {
  declare contract: ReadWriteContract<FlaunchZapABI>;

  constructor(
    chainId: number,
    address: Address,
    drift: Drift<ReadWriteAdapter> = createDrift()
  ) {
    super(chainId, address, drift);
  }

  /**
   * Flaunches a new token: creates the coin, its pool, locked liquidity, the
   * fair launch (if any), and the creator revenue stream in one transaction
   * @param params - Parameters for the flaunch
   * @returns Transaction response for the flaunch creation
   */
  async flaunch(params: FlaunchParams) {
    if (params.fairLaunchPercent < 0 || params.fairLaunchPercent > 95) {
      throw new Error("fairLaunchPercent must be between 0 and 95");
    }
    if (
      !Number.isFinite(params.creatorFeeAllocationPercent) ||
      params.creatorFeeAllocationPercent < 0 ||
      params.creatorFeeAllocationPercent > 100
    ) {
      throw new Error(
        `creatorFeeAllocationPercent must be between 0 and 100, got ${params.creatorFeeAllocationPercent}`
      );
    }
    if (params.fairLaunchPercent > 0 && params.fairLaunchDuration <= 0) {
      throw new Error(
        "fairLaunchDuration (seconds) is required when fairLaunchPercent > 0"
      );
    }

    const initialMCapInUSDCWei = parseUnits(
      params.initialMarketCapUSD.toString(),
      6
    );
    const initialPriceParams = encodeAbiParameters(
      [
        {
          type: "uint256",
        },
      ],
      [initialMCapInUSDCWei]
    );

    const fairLaunchInBps = BigInt(Math.round(params.fairLaunchPercent * 100));
    const creatorFeeAllocationInBps = Math.round(
      params.creatorFeeAllocationPercent * 100
    );

    const value = await this.valueRequiredToFlaunch({
      premineAmount: params.premineAmount ?? 0n,
      initialPriceParams,
      slippagePercent: params.premineAmount ? 5 : 0,
    });

    const treasuryManagerParams = {
      manager: params.treasuryManagerParams?.manager ?? zeroAddress,
      permissions: params.treasuryManagerParams?.permissions ?? zeroAddress,
      initializeData: params.treasuryManagerParams?.initializeData ?? "0x",
      depositData: params.treasuryManagerParams?.depositData ?? "0x",
    };

    return this.contract.write(
      "flaunch",
      {
        _flaunchParams: {
          name: params.name,
          symbol: params.symbol,
          tokenUri: params.tokenUri,
          initialTokenFairLaunch:
            (this.TOTAL_SUPPLY * fairLaunchInBps) / 10_000n,
          fairLaunchDuration: BigInt(params.fairLaunchDuration),
          premineAmount: params.premineAmount ?? 0n,
          creator: params.creator,
          creatorFeeAllocation: creatorFeeAllocationInBps,
          flaunchAt: params.flaunchAt ?? 0n,
          initialPriceParams,
          feeCalculatorParams: "0x",
        },
        _trustedFeeSigner: zeroAddress,
        _premineSwapHookData: referrerHookData(params.premineReferrer),
        _treasuryManagerParams: treasuryManagerParams,
        _whitelistParams: params.whitelistParams ?? {
          merkleRoot: zeroHash,
          merkleIPFSHash: "",
          maxTokens: 0n,
        },
        _airdropParams: params.airdropParams ?? {
          airdropIndex: 0n,
          airdropAmount: 0n,
          airdropEndTime: 0n,
          merkleRoot: zeroHash,
          merkleIPFSHash: "",
        },
      },
      {
        value,
      }
    );
  }

  /**
   * Flaunches a new token, first pinning the image + metadata through the
   * ubi.fun API to produce the tokenUri. To host the metadata yourself, pin
   * it however you like and call `flaunch({ tokenUri })` instead.
   */
  async flaunchIPFS(params: FlaunchIPFSParams) {
    const tokenUri = await generateTokenUri(params.name, params.symbol, {
      chainId: this.chainId,
      metadata: params.metadata,
    });

    return this.flaunch({
      ...params,
      tokenUri,
    });
  }

  /**
   * Flaunches a new token that splits the creator revenue between the creator
   * and a list of recipients through the approved AddressFeeSplitManager.
   * Shares are fixed at launch (5-decimal precision); the revenue NFT is
   * deposited into the manager escrow rather than staying in the creator's
   * wallet.
   *
   * Same layout the app uses: creatorShare/ownerShare are 0 and every payee is
   * a recipient row (the manager requires recipient shares to total exactly
   * 100%); the creator's row is the exact remainder after the listed
   * receivers, so rounding can never brick the launch.
   * @returns Transaction response for the flaunch creation
   */
  async flaunchWithSplitManager(params: FlaunchWithSplitManagerParams) {
    const VALID_SHARE_TOTAL = 100_00000n; // 100% at 5 decimals
    const toShare = (percent: number) => BigInt(Math.round(percent * 100000));

    const receiverShares = params.splitReceivers.map((receiver) => {
      if (
        !Number.isFinite(receiver.percent) ||
        receiver.percent <= 0 ||
        receiver.percent >= 100
      ) {
        throw new Error(
          `splitReceiver percent must be in (0, 100), got ${receiver.percent} for ${receiver.address}`
        );
      }
      return {
        recipient: receiver.address,
        share: toShare(receiver.percent),
      };
    });

    const totalReceiverShares = receiverShares.reduce(
      (acc, curr) => acc + curr.share,
      0n
    );

    if (totalReceiverShares >= VALID_SHARE_TOTAL) {
      throw new Error(
        "splitReceivers total 100% or more; the creator must keep a share"
      );
    }

    const recipientShares = [
      // The creator receives the exact remainder to 100%.
      {
        recipient: params.creator,
        share: VALID_SHARE_TOTAL - totalReceiverShares,
      },
      ...receiverShares,
    ];

    const initializeData = encodeAbiParameters(
      [
        {
          type: "tuple",
          name: "params",
          components: [
            { type: "uint256", name: "creatorShare" },
            { type: "uint256", name: "ownerShare" },
            {
              type: "tuple[]",
              name: "recipientShares",
              components: [
                { type: "address", name: "recipient" },
                { type: "uint256", name: "share" },
              ],
            },
          ],
        },
      ],
      [
        {
          creatorShare: 0n,
          ownerShare: 0n,
          recipientShares,
        },
      ]
    );

    return this.flaunch({
      ...params,
      treasuryManagerParams: {
        manager: AddressFeeSplitManagerAddress[this.chainId],
        initializeData,
        depositData: "0x",
      },
    });
  }

  /**
   * Flaunches a new token that splits the creator fees to the creator and a
   * list of recipients, pinning the token metadata through the ubi.fun API
   * first. To host the metadata yourself, pin it however you like and call
   * `flaunchWithSplitManager({ tokenUri })` instead.
   * @returns Promise resolving to the transaction response for the flaunch creation
   */
  async flaunchIPFSWithSplitManager(params: FlaunchWithSplitManagerIPFSParams) {
    const tokenUri = await generateTokenUri(params.name, params.symbol, {
      chainId: this.chainId,
      metadata: params.metadata,
    });

    return this.flaunchWithSplitManager({
      ...params,
      tokenUri,
    });
  }
}
