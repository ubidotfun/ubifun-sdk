import {
  createDrift,
  Drift,
  ReadWriteAdapter,
  type Address,
} from "@delvtech/drift";
import {
  type PublicClient,
  Hex,
  encodeAbiParameters,
  parseUnits,
  erc721Abi,
  formatUnits,
  decodeEventLog,
} from "viem";
import axios from "axios";
import {
  FlaunchPositionManagerAddress,
  PoolManagerAddress,
  NativeTokenAddress,
  USDC_ADDRESS,
  FairLaunchAddress,
  FlaunchZapAddress,
  FlaunchAddress,
  BidWallAddress,
  QuoterAddress,
  PoolSwapAddress,
  TreasuryManagerFactoryAddress,
  FeeEscrowAddress,
  ReferralEscrowAddress,
  XHandleClaimsAddress,
  UniversalRewardsDistributorAddress,
  IndexerSubscriberAddress,
  ApiBaseUrl,
} from "../addresses";
import { ReadIndexerSubscriber } from "../clients/IndexerSubscriberClient";
import {
  ReadFlaunchPositionManager,
  WatchPoolCreatedParams,
  WatchPoolSwapParams as WatchPoolSwapParamsPositionManager,
  BuySwapLog,
  SellSwapLog,
  BaseSwapLog,
} from "../clients/FlaunchPositionManagerClient";
import {
  ReadPoolManager,
  PositionInfoParams,
} from "../clients/PoolManagerClient";
import { ReadFairLaunch } from "../clients/FairLaunchClient";
import { ReadBidWall } from "../clients/BidWallClient";
import {
  ReadFlaunchZap,
  ReadWriteFlaunchZap,
  FlaunchParams,
  FlaunchIPFSParams,
  FlaunchWithSplitManagerParams,
  FlaunchWithSplitManagerIPFSParams,
} from "../clients/FlaunchZapClient";
import { ReadFlaunch } from "../clients/FlaunchClient";
import { ReadMemecoin, ReadWriteMemecoin } from "../clients/MemecoinClient";
import { ReadQuoter } from "../clients/QuoterClient";
import { ReadFeeEscrow, ReadWriteFeeEscrow } from "../clients/FeeEscrowClient";
import {
  ReadReferralEscrow,
  ReadWriteReferralEscrow,
} from "../clients/ReferralEscrowClient";
import { ReadWritePoolSwap } from "../clients/PoolSwapClient";
import {
  ReadXHandleClaims,
  ReadWriteXHandleClaims,
} from "../clients/XHandleClaimsClient";
import {
  ReadUniversalRewardsDistributor,
  ReadWriteUniversalRewardsDistributor,
} from "../clients/UniversalRewardsDistributorClient";
import { ReadWriteTreasuryManagerFactory } from "../clients/TreasuryManagerFactoryClient";
import {
  ReadTreasuryManager,
  ReadWriteTreasuryManager,
} from "../clients/TreasuryManagerClient";
import { FlaunchPositionManagerAbi } from "../abi/FlaunchPositionManager";
import { CoinMetadata, PoolCreatedEventData } from "../types";
import {
  getPoolId,
  getValidTick,
  calculateUnderlyingTokenBalances,
  TickFinder,
  TICK_SPACING,
} from "../utils/univ4";
import {
  coinPoolKey,
  usdcIsCurrencyZero,
  swapDirection,
  sqrtPriceLimit,
  expectedEndSqrtPriceX96,
} from "../utils/swap";
import {
  resolveIPFS as defaultResolveIPFS,
  resolveIPFSCandidates,
  fetchTokenUriMetadataWithFallback,
} from "../helpers/ipfs";
import { ReadMulticall } from "../clients/MulticallClient";
import { MemecoinAbi } from "../abi";

// Re-export PoolCreatedEventData so it's available as part of the SDK module
export type { PoolCreatedEventData } from "../types";

type WatchPoolSwapParams = Omit<
  WatchPoolSwapParamsPositionManager<boolean>,
  "usdcIsCurrencyZero"
> & {
  filterByCoin?: Address;
};

/** USDC (the cash side) has 6 decimals; every coin has 18. */
const USDC_DECIMALS = 6;
const COIN_DECIMALS = 18;

/** An address's daily holder pool entitlement as served by the ubi.fun API. */
export interface UbiEntitlement {
  account?: string;
  /** CUMULATIVE lifetime entitlement in USDC wei (6 decimals). */
  cumulativeWei?: string;
  proof?: Hex[];
  status?: string;
  /** The ledger root this entitlement belongs to. */
  root?: string;
  [key: string]: unknown;
}

/**
 * Base class for interacting with the ubi.fun protocol in read-only mode
 */
export class ReadFlaunchSDK {
  public readonly drift: Drift;
  public readonly chainId: number;
  public readonly publicClient: PublicClient | undefined;
  public readonly TICK_SPACING = TICK_SPACING;
  public readonly readPositionManager: ReadFlaunchPositionManager;
  public readonly readFeeEscrow: ReadFeeEscrow;
  public readonly readReferralEscrow: ReadReferralEscrow;
  public readonly readFlaunchZap: ReadFlaunchZap;
  public readonly readPoolManager: ReadPoolManager;
  public readonly readFairLaunch: ReadFairLaunch;
  public readonly readBidWall: ReadBidWall;
  public readonly readFlaunch: ReadFlaunch;
  public readonly readQuoter: ReadQuoter;
  public readonly readXHandleClaims: ReadXHandleClaims;
  public readonly readUbiPool: ReadUniversalRewardsDistributor;
  public readonly readIndexerSubscriber: ReadIndexerSubscriber;

  public resolveIPFS: (value: string) => string;

  constructor(
    chainId: number,
    drift: Drift = createDrift(),
    publicClient?: PublicClient
  ) {
    this.chainId = chainId;
    this.drift = drift;
    this.publicClient = publicClient;
    this.resolveIPFS = defaultResolveIPFS;
    this.readPositionManager = new ReadFlaunchPositionManager(
      FlaunchPositionManagerAddress[this.chainId],
      drift
    );
    this.readFeeEscrow = new ReadFeeEscrow(
      FeeEscrowAddress[this.chainId],
      drift
    );
    this.readReferralEscrow = new ReadReferralEscrow(
      ReferralEscrowAddress[this.chainId],
      drift
    );
    this.readFlaunchZap = new ReadFlaunchZap(
      this.chainId,
      FlaunchZapAddress[this.chainId],
      drift
    );
    this.readPoolManager = new ReadPoolManager(
      PoolManagerAddress[this.chainId],
      drift
    );
    this.readFairLaunch = new ReadFairLaunch(
      FairLaunchAddress[this.chainId],
      drift
    );
    this.readBidWall = new ReadBidWall(BidWallAddress[this.chainId], drift);
    this.readFlaunch = new ReadFlaunch(FlaunchAddress[this.chainId], drift);
    this.readQuoter = new ReadQuoter(
      this.chainId,
      QuoterAddress[this.chainId],
      drift
    );
    this.readXHandleClaims = new ReadXHandleClaims(
      XHandleClaimsAddress[this.chainId],
      drift
    );
    this.readUbiPool = new ReadUniversalRewardsDistributor(
      UniversalRewardsDistributorAddress[this.chainId],
      drift
    );
    this.readIndexerSubscriber = new ReadIndexerSubscriber(
      IndexerSubscriberAddress[this.chainId],
      drift
    );
  }

  /**
   * Checks if a given coin address is a valid ubi.fun coin
   * @param coinAddress - The address of the coin to check
   * @returns Promise<boolean> - True if the coin is valid, false otherwise
   */
  isValidCoin(coinAddress: Address) {
    return this.readPositionManager.isValidCoin(coinAddress);
  }

  getPositionManagerAddress() {
    return this.readPositionManager.contract.address;
  }

  getFlaunchAddress() {
    return this.readFlaunch.contract.address;
  }

  getFairLaunchAddress() {
    return this.readFairLaunch.contract.address;
  }

  getBidWallAddress() {
    return this.readBidWall.contract.address;
  }

  /**
   * Gets the Flaunch NFT token ID for a memecoin (the NFT IS the revenue claim)
   * @param coinAddress - The address of the memecoin
   * @returns Promise<{ flaunchAddress: Address; tokenId: bigint }>
   */
  async getFlaunchTokenIdForMemecoin(
    coinAddress: Address
  ): Promise<{ flaunchAddress: Address; tokenId: bigint }> {
    const tokenId = await this.readFlaunch.tokenId(coinAddress);

    return {
      flaunchAddress: this.getFlaunchAddress(),
      tokenId,
    };
  }

  /**
   * URLs to try for a tokenURI, in order. With the default resolver an
   * ipfs:// URI fans out to every known public gateway; a custom resolver
   * from `setIPFSResolver` stays authoritative and yields exactly one URL.
   */
  private tokenUriCandidates(tokenURI: string): string[] {
    return this.resolveIPFS === defaultResolveIPFS
      ? resolveIPFSCandidates(tokenURI)
      : [this.resolveIPFS(tokenURI)];
  }

  /**
   * Retrieves metadata for a given coin
   * @param coinAddress - The address of the coin
   * @returns Promise<CoinMetadata & { symbol: string }> - The coin's metadata including name, symbol, description, and social links
   */
  async getCoinMetadata(
    coinAddress: Address
  ): Promise<CoinMetadata & { symbol: string }> {
    const memecoin = new ReadMemecoin(coinAddress, this.drift);
    const name = await memecoin.name();
    const symbol = await memecoin.symbol();
    const tokenURI = await memecoin.tokenURI();

    // get metadata from tokenURI
    const metadata = await fetchTokenUriMetadataWithFallback(
      this.tokenUriCandidates(tokenURI)
    );

    return {
      name,
      symbol,
      description: metadata.description ?? "",
      image: metadata.image ? this.resolveIPFS(metadata.image) : "",
      external_link: metadata.websiteUrl ?? metadata.website ?? "",
      collaborators: metadata.collaborators ?? [],
      discordUrl: metadata.discordUrl ?? "",
      twitterUrl: metadata.twitterUrl ?? metadata.twitter ?? "",
      telegramUrl: metadata.telegramUrl ?? metadata.telegram ?? "",
    };
  }

  /**
   * Retrieves metadata for a given coin using its token ID
   * @param flaunch - The address of the Flaunch contract
   * @param tokenId - The token ID of the coin
   * @returns The coin's metadata including name, symbol, description, and social links
   */
  async getCoinMetadataFromTokenId(
    flaunch: Address,
    tokenId: bigint
  ): Promise<CoinMetadata & { symbol: string }> {
    const _flaunch = new ReadFlaunch(flaunch, this.drift);
    const coinAddress = await _flaunch.memecoin(tokenId);
    return this.getCoinMetadata(coinAddress);
  }

  /**
   * Retrieves metadata for multiple coins using their token IDs
   * @param params - An array of objects containing flaunch contract address and token ID
   * @param batchSize - Optional, the number of ipfs requests to process in each batch
   * @param batchDelay - Optional, the delay in milliseconds between batches
   * @returns An array of objects containing coin address, name, symbol, description, and social links
   */
  async getCoinMetadataFromTokenIds(
    params: {
      flaunch: Address;
      tokenId: bigint;
    }[],
    batchSize: number = 9,
    batchDelay: number = 500
  ): Promise<
    {
      coinAddress: Address;
      name: string;
      symbol: string;
      description: any;
      image: string;
      external_link: any;
      collaborators: any;
      discordUrl: any;
      twitterUrl: any;
      telegramUrl: any;
    }[]
  > {
    if (!Number.isInteger(batchSize) || batchSize < 1) {
      throw new Error(`batchSize must be a positive integer, got ${batchSize}`);
    }
    if (!Number.isFinite(batchDelay) || batchDelay < 0) {
      throw new Error(`batchDelay must be >= 0, got ${batchDelay}`);
    }

    const multicall = new ReadMulticall(this.drift);

    // get coin addresses via multicall
    const coinAddresses_calldata = params.map((p) =>
      this.readFlaunch.contract.encodeFunctionData("memecoin", {
        _tokenId: p.tokenId,
      })
    );
    const coinAddresses_result = await multicall.aggregate3(
      coinAddresses_calldata.map((calldata, i) => ({
        target: params[i].flaunch,
        callData: calldata,
      }))
    );
    const coinAddresses = coinAddresses_result.map((r) =>
      this.readFlaunch.contract.decodeFunctionReturn("memecoin", r.returnData)
    );

    /// get coin metadata for each coin address via multicall
    const coinMetadata_calldata: Hex[] = [];
    // name, symbol, tokenURI for each coin
    coinAddresses.forEach(() => {
      coinMetadata_calldata.push(
        this.drift.adapter.encodeFunctionData({
          abi: MemecoinAbi,
          fn: "name",
        })
      );
      coinMetadata_calldata.push(
        this.drift.adapter.encodeFunctionData({
          abi: MemecoinAbi,
          fn: "symbol",
        })
      );
      coinMetadata_calldata.push(
        this.drift.adapter.encodeFunctionData({
          abi: MemecoinAbi,
          fn: "tokenURI",
        })
      );
    });
    const coinMetadata_result = await multicall.aggregate3(
      coinMetadata_calldata.map((calldata, i) => ({
        target: coinAddresses[Math.floor(i / 3)],
        callData: calldata,
      }))
    );

    // First decode all the results
    const results = [];
    for (let i = 0; i < coinAddresses.length; i++) {
      const name = this.drift.adapter.decodeFunctionReturn({
        abi: MemecoinAbi,
        fn: "name",
        data: coinMetadata_result[i * 3].returnData,
      });
      const symbol = this.drift.adapter.decodeFunctionReturn({
        abi: MemecoinAbi,
        fn: "symbol",
        data: coinMetadata_result[i * 3 + 1].returnData,
      });
      const tokenURI = this.drift.adapter.decodeFunctionReturn({
        abi: MemecoinAbi,
        fn: "tokenURI",
        data: coinMetadata_result[i * 3 + 2].returnData,
      });

      results.push({ name, symbol, tokenURI, coinAddress: coinAddresses[i] });
    }

    // Process IPFS requests in batches to avoid rate limiting
    const processedResults = [];
    for (let i = 0; i < results.length; i += batchSize) {
      const batch = results.slice(i, i + batchSize);
      const batchResults = await Promise.all(
        batch.map(async ({ name, symbol, tokenURI, coinAddress }) => {
          const metadata = await fetchTokenUriMetadataWithFallback(
            this.tokenUriCandidates(tokenURI)
          );

          return {
            coinAddress,
            name,
            symbol,
            description: metadata.description ?? "",
            image: metadata.image ? this.resolveIPFS(metadata.image) : "",
            external_link: metadata.websiteUrl ?? metadata.website ?? "",
            collaborators: metadata.collaborators ?? [],
            discordUrl: metadata.discordUrl ?? "",
            twitterUrl: metadata.twitterUrl ?? metadata.twitter ?? "",
            telegramUrl: metadata.telegramUrl ?? metadata.telegram ?? "",
          };
        })
      );
      processedResults.push(...batchResults);

      // Add a small delay between batches to avoid rate limiting
      if (i + batchSize < results.length) {
        await new Promise((resolve) => setTimeout(resolve, batchDelay));
      }
    }

    return processedResults;
  }

  /**
   * Watches for pool creation events
   * @param params - Parameters for watching pool creation
   * @returns Subscription to pool creation events
   */
  watchPoolCreated(params: WatchPoolCreatedParams) {
    return this.readPositionManager.watchPoolCreated(params);
  }

  /**
   * Parses a transaction to extract PoolCreated event data
   * @param txHash - The transaction hash to parse
   * @returns PoolCreated event parameters or null if not found
   */
  async getPoolCreatedFromTx(
    txHash: Hex
  ): Promise<PoolCreatedEventData | null> {
    if (!this.publicClient) {
      throw new Error("Public client is required to fetch transaction data");
    }

    // Get transaction receipt
    const receipt = await this.publicClient.getTransactionReceipt({
      hash: txHash,
    });

    if (!receipt) {
      throw new Error(`Transaction not found: ${txHash}`);
    }

    // Find PoolCreated event in logs by trying to decode each log
    for (const log of receipt.logs) {
      try {
        const decodedLog = decodeEventLog({
          abi: FlaunchPositionManagerAbi,
          data: log.data,
          topics: log.topics,
        });

        if (decodedLog.eventName === "PoolCreated") {
          return {
            poolId: decodedLog.args._poolId as Hex,
            memecoin: decodedLog.args._memecoin as Address,
            memecoinTreasury: decodedLog.args._memecoinTreasury as Address,
            tokenId: decodedLog.args._tokenId as bigint,
            currencyFlipped: decodedLog.args._currencyFlipped as boolean,
            flaunchFee: decodedLog.args._flaunchFee as bigint,
            params: decodedLog.args._params as any,
          };
        }
      } catch (error) {
        // Not a PoolCreated event or decoding failed, continue to next log
        continue;
      }
    }

    return null;
  }

  /**
   * Watches for pool swap events
   * @param params - Parameters for watching pool swaps including optional coin filter
   * @returns Subscription to pool swap events
   */
  async watchPoolSwap(params: WatchPoolSwapParams) {
    return this.readPositionManager.watchPoolSwap<boolean>({
      ...params,
      filterByPoolId: params.filterByCoin
        ? await this.poolId(params.filterByCoin)
        : undefined,
      usdcIsCurrencyZero: params.filterByCoin
        ? this.usdcIsCurrencyZero(params.filterByCoin)
        : undefined,
    });
  }

  /**
   * Gets information about a liquidity position (read via PoolManager extsload)
   * @param params - Parameters for querying position info
   * @returns Position information
   */
  positionInfo(params: PositionInfoParams) {
    return this.readPoolManager.positionInfo(params);
  }

  /**
   * Gets the current tick for a given coin's pool
   * @param coinAddress - The address of the coin
   * @returns Promise<number> - The current tick of the pool
   */
  async currentTick(coinAddress: Address) {
    const poolId = await this.poolId(coinAddress);

    const poolState = await this.readPoolManager.poolSlot0({ poolId });
    return poolState.tick;
  }

  /**
   * Gets the current sqrt price for a given coin's pool
   * @param coinAddress - The address of the coin
   * @returns Promise<bigint> - sqrtPriceX96, zero if the pool has no price yet
   */
  async currentSqrtPriceX96(coinAddress: Address) {
    const poolId = await this.poolId(coinAddress);

    const poolState = await this.readPoolManager.poolSlot0({ poolId });
    return poolState.sqrtPriceX96;
  }

  /**
   * Calculates the coin price in USDC based on the current tick. The pool
   * pairs an 18-decimal coin against 6-decimal USDC, so the raw tick price is
   * scaled by 1e12 to get a human dollar price.
   * @param coinAddress - The address of the coin
   * @returns Promise<string> - The price of one coin in USDC (18 decimal string)
   */
  async coinPriceInUSDC(coinAddress: Address) {
    const isUSDCZero = this.usdcIsCurrencyZero(coinAddress);
    const currentTick = await this.currentTick(coinAddress);

    // raw price = currency1 per currency0 in wei terms
    const price = Math.pow(1.0001, currentTick);

    const usdcRawPerCoinRaw = isUSDCZero ? 1 / price : price;
    const usdcPerCoin =
      usdcRawPerCoinRaw * Math.pow(10, COIN_DECIMALS - USDC_DECIMALS);

    return usdcPerCoin.toFixed(18);
  }

  /**
   * Calculates the coin's market cap in USDC (price x the fixed 100 Billion supply)
   * @param coinAddress - The address of the coin
   * @returns Promise<string> - The market cap in USDC with 2 decimal precision
   */
  async coinMarketCapInUSDC(coinAddress: Address) {
    const totalSupply = 100_000_000_000; // 100 Billion tokens
    const priceInUSDC = await this.coinPriceInUSDC(coinAddress);
    return (parseFloat(priceInUSDC) * totalSupply).toFixed(2);
  }

  async fairLaunchInfo(coinAddress: Address) {
    const poolId = await this.poolId(coinAddress);
    return this.readFairLaunch.fairLaunchInfo({ poolId });
  }

  /**
   * Checks if a fair launch is currently active for a given coin
   * @param coinAddress - The address of the coin
   * @returns Promise<boolean> - True if fair launch is active, false otherwise
   */
  async isFairLaunchActive(coinAddress: Address) {
    const poolId = await this.poolId(coinAddress);
    return this.readFairLaunch.isFairLaunchActive({ poolId });
  }

  /** The fair launch window length in seconds for a coin (chosen at launch). */
  async fairLaunchDuration(coinAddress: Address) {
    const poolId = await this.poolId(coinAddress);
    return this.readFairLaunch.fairLaunchDuration({ poolId });
  }

  /**
   * Gets the initial tick for a fair launch
   * @param coinAddress - The address of the coin
   * @returns Promise<number> - The initial tick value
   */
  async initialTick(coinAddress: Address) {
    const poolId = await this.poolId(coinAddress);

    const fairLaunchInfo = await this.readFairLaunch.fairLaunchInfo({
      poolId,
    });
    return fairLaunchInfo.initialTick;
  }

  /**
   * Gets the USDC-only position in a fair launch (the side selling at the
   * fixed fair launch price)
   * @param coinAddress - The address of the coin
   * @returns Promise<{usdcAmount, coinAmount, tickLower, tickUpper}>
   */
  async fairLaunchUSDCOnlyPosition(coinAddress: Address) {
    const poolId = await this.poolId(coinAddress);
    const initialTick = await this.initialTick(coinAddress);
    const currentTick = await this.currentTick(coinAddress);
    const isUSDCZero = this.usdcIsCurrencyZero(coinAddress);

    let tickLower: number;
    let tickUpper: number;

    if (isUSDCZero) {
      tickLower = getValidTick({
        tick: initialTick + 1,
        roundDown: false,
        tickSpacing: this.TICK_SPACING,
      });
      tickUpper = tickLower + this.TICK_SPACING;
    } else {
      tickUpper = getValidTick({
        tick: initialTick - 1,
        roundDown: true,
        tickSpacing: this.TICK_SPACING,
      });
      tickLower = tickUpper - this.TICK_SPACING;
    }

    const { liquidity } = await this.readPoolManager.positionInfo({
      poolId,
      owner: this.getFairLaunchAddress(),
      tickLower,
      tickUpper,
      salt: "",
    });

    const { amount0, amount1 } = calculateUnderlyingTokenBalances(
      liquidity,
      tickLower,
      tickUpper,
      currentTick
    );

    const [usdcAmount, coinAmount] = isUSDCZero
      ? [amount0, amount1]
      : [amount1, amount0];

    return {
      usdcAmount,
      coinAmount,
      tickLower,
      tickUpper,
    };
  }

  /**
   * Gets the coin-only position in a fair launch
   * @param coinAddress - The address of the coin
   * @returns Promise<{usdcAmount, coinAmount, tickLower, tickUpper}>
   */
  async fairLaunchCoinOnlyPosition(coinAddress: Address) {
    const poolId = await this.poolId(coinAddress);
    const initialTick = await this.initialTick(coinAddress);
    const currentTick = await this.currentTick(coinAddress);
    const isUSDCZero = this.usdcIsCurrencyZero(coinAddress);

    let tickLower: number;
    let tickUpper: number;

    if (isUSDCZero) {
      tickLower = TickFinder.MIN_TICK;
      tickUpper = getValidTick({
        tick: initialTick - 1,
        roundDown: true,
        tickSpacing: this.TICK_SPACING,
      });
    } else {
      tickLower = getValidTick({
        tick: initialTick + 1,
        roundDown: false,
        tickSpacing: this.TICK_SPACING,
      });
      tickUpper = TickFinder.MAX_TICK;
    }

    const { liquidity } = await this.readPoolManager.positionInfo({
      poolId,
      owner: this.getFairLaunchAddress(),
      tickLower,
      tickUpper,
      salt: "",
    });

    const { amount0, amount1 } = calculateUnderlyingTokenBalances(
      liquidity,
      tickLower,
      tickUpper,
      currentTick
    );

    const [usdcAmount, coinAmount] = isUSDCZero
      ? [amount0, amount1]
      : [amount1, amount0];

    return {
      usdcAmount,
      coinAmount,
      tickLower,
      tickUpper,
    };
  }

  /**
   * Gets the bid wall (progressive floor) position for a coin
   * @param coinAddress - The address of the coin
   * @returns Promise<{usdcAmount, coinAmount, pendingUsdc, tickLower, tickUpper}>
   */
  async bidWallPosition(coinAddress: Address) {
    const poolId = await this.poolId(coinAddress);
    const isUSDCZero = this.usdcIsCurrencyZero(coinAddress);

    const {
      amount0_: amount0,
      amount1_: amount1,
      pendingEth_: pendingUsdc,
    } = await this.readBidWall.position({ poolId });
    const { tickLower, tickUpper } = await this.readBidWall.poolInfo({
      poolId,
    });

    const [usdcAmount, coinAmount] = isUSDCZero
      ? [amount0, amount1]
      : [amount1, amount0];

    return {
      usdcAmount,
      coinAmount,
      pendingUsdc,
      tickLower,
      tickUpper,
    };
  }

  /**
   * Gets the USDC balance the creator (or split manager) can claim from the
   * FeeEscrow
   * @param creator - The address to check
   * @returns Promise<bigint> - The claimable balance (USDC, 6 decimals)
   */
  creatorRevenue(creator: Address) {
    return this.readFeeEscrow.balances(creator);
  }

  /**
   * Gets the referral escrow balance of a recipient for a given token.
   * Referral rewards accrue in the OUTPUT token of each swap: buys accrue the
   * coin, sells accrue USDC.
   * @param recipient - The address of the recipient to check
   * @param token - The token to check (a coin address or USDC)
   * @returns Promise<bigint> - The balance of the recipient
   */
  referralBalance(recipient: Address, token: Address) {
    return this.readReferralEscrow.allocations(recipient, token);
  }

  /**
   * Gets a recipient's claimable share inside an earnings-split manager
   * @param managerAddress - The AddressFeeSplitManager instance
   * @param recipient - The recipient to check
   * @returns Promise<bigint> - The claimable balance (USDC, 6 decimals)
   */
  splitBalance(managerAddress: Address, recipient: Address) {
    const readTreasuryManager = new ReadTreasuryManager(
      managerAddress,
      this.drift
    );
    return readTreasuryManager.balances(recipient);
  }

  async treasuryManagerInfo(treasuryManagerAddress: Address) {
    const readTreasuryManager = new ReadTreasuryManager(
      treasuryManagerAddress,
      this.drift
    );

    const [managerOwner, permissions] = await Promise.all([
      readTreasuryManager.managerOwner(),
      readTreasuryManager.permissions(),
    ]);

    return {
      managerOwner,
      permissions,
    };
  }

  /**
   * Fetches an address's daily holder pool entitlement from the ubi.fun API.
   * The returned cumulativeWei/proof pair is what the on-chain claim takes.
   * @param account - The holder address
   */
  async getUbiEntitlement(account: Address): Promise<UbiEntitlement> {
    const apiUrl = ApiBaseUrl[this.chainId];
    if (!apiUrl) {
      throw new Error(`No ubi.fun API for chain ${this.chainId}`);
    }
    const response = await axios.get(
      `${apiUrl}/ubi/${account.toLowerCase()}`
    );
    return response.data as UbiEntitlement;
  }

  /**
   * An address's claimable holder pool balance right now: the API entitlement
   * minus what was already claimed on-chain. Returns zero while the
   * entitlement's ledger root is still pending the URD timelock (a claim
   * against it would revert).
   * @param account - The holder address
   */
  async claimableUbi(account: Address): Promise<{
    claimable: bigint;
    entitlement: UbiEntitlement;
  }> {
    const entitlement = await this.getUbiEntitlement(account);
    if (!entitlement.cumulativeWei || !entitlement.proof) {
      return { claimable: 0n, entitlement };
    }

    if (entitlement.root) {
      const onChainRoot = await this.readUbiPool.root();
      if (entitlement.root.toLowerCase() !== onChainRoot.toLowerCase()) {
        // Root still inside the URD timelock; retry once it activates.
        return { claimable: 0n, entitlement };
      }
    }

    const cumulative = BigInt(entitlement.cumulativeWei);
    const claimed = await this.readUbiPool.claimed(account, USDC_ADDRESS);
    return {
      claimable: cumulative > claimed ? cumulative - claimed : 0n,
      entitlement,
    };
  }

  /**
   * Gets the pool ID for a given coin
   * @param coinAddress - The address of the coin
   * @returns Promise<string> - The pool ID
   */
  async poolId(coinAddress: Address) {
    return getPoolId(
      coinPoolKey(coinAddress, this.getPositionManagerAddress())
    );
  }

  /**
   * Gets the flaunching fee for a given initial price, in native units
   * (msg.value; USDC at 18 decimals on Arc). Zero at the $10k minimum market
   * cap.
   * @param params.sender - The address of the sender
   * @param params.initialMarketCapUSD - The initial market cap in USD
   * @param params.slippagePercent - The slippage percent
   * @returns Promise<bigint> - The flaunching fee
   */
  getFlaunchingFee(params: {
    sender: Address;
    initialMarketCapUSD: number;
    slippagePercent?: number;
  }) {
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

    return this.readPositionManager.getFlaunchingFee({
      sender: params.sender,
      initialPriceParams,
      slippagePercent: params.slippagePercent,
    });
  }

  /**
   * Calculates the msg.value required to flaunch a token: the premine cost (if
   * any) plus the flaunching fee. Native units (USDC at 18 decimals on Arc).
   * @param params.premineAmount - The amount of coins to be premined
   * @param params.initialMarketCapUSD - The initial market cap in USD
   * @param params.slippagePercent - The slippage percent
   * @returns Promise<bigint> - The value required to flaunch
   */
  valueRequiredToFlaunch(params: {
    premineAmount: bigint;
    initialMarketCapUSD: number;
    slippagePercent?: number;
  }) {
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

    return this.readFlaunchZap.valueRequiredToFlaunch({
      premineAmount: params.premineAmount,
      initialPriceParams,
      slippagePercent: params.slippagePercent,
    });
  }

  /**
   * Gets a quote for selling an exact amount of a coin for USDC
   * @param coinAddress - The address of the coin to sell
   * @param amountIn - The exact amount of coins to sell (18 decimals)
   * @param referrer - Optional referrer; must match the referrer used to swap
   * @returns Promise<bigint> - The expected USDC out (6 decimals)
   */
  getSellQuoteExactInput({
    coinAddress,
    amountIn,
    referrer,
  }: {
    coinAddress: Address;
    amountIn: bigint;
    referrer?: Address;
  }) {
    return this.readQuoter.getSellQuoteExactInput({
      coinAddress,
      amountIn,
      positionManagerAddress: this.getPositionManagerAddress(),
      referrer,
    });
  }

  /**
   * Gets a quote for buying a coin with an exact amount of USDC
   * @param coinAddress - The address of the coin to buy
   * @param amountIn - The exact amount of USDC to spend (6 decimals)
   * @param referrer - Optional referrer; must match the referrer used to swap
   * @returns Promise<bigint> - The expected coins out (18 decimals)
   */
  getBuyQuoteExactInput({
    coinAddress,
    amountIn,
    referrer,
  }: {
    coinAddress: Address;
    amountIn: bigint;
    referrer?: Address;
  }) {
    return this.readQuoter.getBuyQuoteExactInput({
      coinAddress,
      amountIn,
      positionManagerAddress: this.getPositionManagerAddress(),
      referrer,
    });
  }

  /**
   * Gets a quote for buying an exact amount of a coin, answering the USDC in
   * @param coinAddress - The address of the coin to buy
   * @param amountOut - The exact amount of coins to receive (18 decimals)
   * @param referrer - Optional referrer; must match the referrer used to swap
   * @returns Promise<bigint> - The required USDC in (6 decimals)
   */
  getBuyQuoteExactOutput({
    coinAddress,
    amountOut,
    referrer,
  }: {
    coinAddress: Address;
    amountOut: bigint;
    referrer?: Address;
  }) {
    return this.readQuoter.getBuyQuoteExactOutput({
      coinAddress,
      coinOut: amountOut,
      positionManagerAddress: this.getPositionManagerAddress(),
      referrer,
    });
  }

  /**
   * Determines if USDC is currency0 in the coin's pool
   * @param coinAddress - The address of the coin
   * @returns boolean - True if USDC is currency0, false otherwise
   */
  usdcIsCurrencyZero(coinAddress: Address) {
    return usdcIsCurrencyZero(coinAddress);
  }

  /**
   * Sets a custom IPFS resolver function
   * @dev this is used to resolve IPFS hash to a gateway URL
   * eg: input: Qabc, output: https://ipfs.io/ipfs/Qabc
   * @param resolverFn - Custom function to resolve IPFS URIs
   */
  setIPFSResolver(resolverFn: (ipfsHash: string) => string): void {
    this.resolveIPFS = resolverFn;
  }

  /**
   * Parses a transaction hash to extract PoolSwap events and return parsed swap data
   * @param params.txHash - The transaction hash to parse
   * @param params.usdcIsCurrencyZero - Whether USDC is currency0 in the pool (optional;
   *        when provided, returns typed BUY/SELL data)
   * @returns Parsed swap log or undefined if no PoolSwap event found
   */
  async parseSwapTx<T extends boolean | undefined = undefined>(params: {
    txHash: Hex;
    usdcIsCurrencyZero?: T;
  }): Promise<
    T extends boolean
      ? BuySwapLog | SellSwapLog | undefined
      : BaseSwapLog | undefined
  > {
    return this.readPositionManager.parseSwapTx(
      params.txHash,
      params.usdcIsCurrencyZero
    ) as any;
  }

  async getCoinInfo(coinAddress: Address): Promise<{
    totalSupply: bigint;
    decimals: number;
    formattedTotalSupplyInDecimals: number;
  }> {
    const memecoin = new ReadMemecoin(coinAddress, this.drift);
    const [totalSupply, decimals] = await Promise.all([
      memecoin.totalSupply(),
      memecoin.decimals(),
    ]);
    const formattedTotalSupplyInDecimals = parseFloat(
      formatUnits(totalSupply, decimals)
    );
    return { totalSupply, decimals, formattedTotalSupplyInDecimals };
  }

  isFlaunchTokenApprovedForAll(owner: Address, operator: Address) {
    return this.drift.read({
      abi: erc721Abi,
      address: this.getFlaunchAddress(),
      fn: "isApprovedForAll",
      args: { owner, operator },
    });
  }
}

export class ReadWriteFlaunchSDK extends ReadFlaunchSDK {
  declare drift: Drift<ReadWriteAdapter>;
  public readonly readWriteFeeEscrow: ReadWriteFeeEscrow;
  public readonly readWriteReferralEscrow: ReadWriteReferralEscrow;
  public readonly readWriteFlaunchZap: ReadWriteFlaunchZap;
  public readonly readWritePoolSwap: ReadWritePoolSwap;
  public readonly readWriteXHandleClaims: ReadWriteXHandleClaims;
  public readonly readWriteUbiPool: ReadWriteUniversalRewardsDistributor;
  public readonly readWriteTreasuryManagerFactory: ReadWriteTreasuryManagerFactory;

  constructor(
    chainId: number,
    drift: Drift<ReadWriteAdapter> = createDrift(),
    publicClient?: PublicClient
  ) {
    super(chainId, drift, publicClient);
    this.readWriteFeeEscrow = new ReadWriteFeeEscrow(
      FeeEscrowAddress[this.chainId],
      drift
    );
    this.readWriteReferralEscrow = new ReadWriteReferralEscrow(
      ReferralEscrowAddress[this.chainId],
      drift
    );
    this.readWriteFlaunchZap = new ReadWriteFlaunchZap(
      this.chainId,
      FlaunchZapAddress[this.chainId],
      drift
    );
    this.readWritePoolSwap = new ReadWritePoolSwap(
      PoolSwapAddress[this.chainId],
      drift
    );
    this.readWriteXHandleClaims = new ReadWriteXHandleClaims(
      XHandleClaimsAddress[this.chainId],
      drift
    );
    this.readWriteUbiPool = new ReadWriteUniversalRewardsDistributor(
      UniversalRewardsDistributorAddress[this.chainId],
      drift
    );
    this.readWriteTreasuryManagerFactory = new ReadWriteTreasuryManagerFactory(
      this.chainId,
      TreasuryManagerFactoryAddress[this.chainId],
      drift,
      this.publicClient
    );
  }

  /**
   * Launches a new coin through the FlaunchZap
   * @param params - Parameters for the launch
   * @returns Transaction response
   */
  flaunch(params: FlaunchParams) {
    return this.readWriteFlaunchZap.flaunch(params);
  }

  /**
   * Launches a new coin, pinning the image + metadata first to produce the tokenUri
   * @param params - Parameters for the launch with IPFS data
   * @returns Transaction response
   */
  flaunchIPFS(params: FlaunchIPFSParams) {
    return this.readWriteFlaunchZap.flaunchIPFS(params);
  }

  flaunchWithSplitManager(params: FlaunchWithSplitManagerParams) {
    return this.readWriteFlaunchZap.flaunchWithSplitManager(params);
  }

  /**
   * Launches a new coin that splits the creator revenue between the creator and a
   * list of recipients, storing the token metadata on IPFS
   * @param params - Parameters including all IPFS metadata
   * @returns Transaction response
   */
  flaunchIPFSWithSplitManager(params: FlaunchWithSplitManagerIPFSParams) {
    return this.readWriteFlaunchZap.flaunchIPFSWithSplitManager(params);
  }

  /** ubi.fun-branded alias of {@link flaunch}. */
  createUBI(params: FlaunchParams) {
    return this.flaunch(params);
  }

  /** ubi.fun-branded alias of {@link flaunchIPFS}. */
  createUBIIPFS(params: FlaunchIPFSParams) {
    return this.flaunchIPFS(params);
  }

  /** ubi.fun-branded alias of {@link flaunchWithSplitManager}. */
  createUBIWithSplitManager(params: FlaunchWithSplitManagerParams) {
    return this.flaunchWithSplitManager(params);
  }

  /** ubi.fun-branded alias of {@link flaunchIPFSWithSplitManager}. */
  createUBIIPFSWithSplitManager(params: FlaunchWithSplitManagerIPFSParams) {
    return this.flaunchIPFSWithSplitManager(params);
  }

  async coinBalance(coinAddress: Address) {
    const user = await this.drift.getSignerAddress();
    const memecoin = new ReadMemecoin(coinAddress, this.drift);
    await memecoin.contract.cache.clear();
    return memecoin.balanceOf(user);
  }

  /** The connected wallet's USDC (6 decimals) balance. */
  async usdcBalance() {
    const user = await this.drift.getSignerAddress();
    const usdc = new ReadMemecoin(USDC_ADDRESS, this.drift);
    await usdc.contract.cache.clear();
    return usdc.balanceOf(user);
  }

  /**
   * The connected wallet's allowance of `token` to PoolSwap. Pass USDC_ADDRESS
   * before a buy, the coin address before a sell.
   */
  async swapAllowance(token: Address) {
    const owner = await this.drift.getSignerAddress();
    const erc20 = new ReadMemecoin(token, this.drift);
    await erc20.contract.cache.clear();
    return erc20.allowance(owner, this.readWritePoolSwap.contract.address);
  }

  /**
   * Approves `amount` of `token` to PoolSwap. Pass USDC_ADDRESS before a buy,
   * the coin address before a sell.
   * @returns Transaction response
   */
  approveSwapInput(token: Address, amount: bigint) {
    const erc20 = new ReadWriteMemecoin(token, this.drift);
    return erc20.approve(this.readWritePoolSwap.contract.address, amount);
  }

  /**
   * Buys a coin with USDC through PoolSwap. Requires a prior USDC approval to
   * PoolSwap (see approveSwapInput); throws before sending if the allowance is
   * short.
   * @param params.coinAddress - The coin to buy
   * @param params.amountIn - Exact USDC to spend (6 decimals)
   * @param params.slippagePercent - Max price movement beyond the quoted fill, default 5 (%)
   * @param params.referrer - Optional referrer credited with 5% of the swap fee
   * @returns Transaction response
   */
  async buyCoin(params: {
    coinAddress: Address;
    amountIn: bigint;
    slippagePercent?: number;
    referrer?: Address;
  }) {
    return this.executeSwap({
      coinAddress: params.coinAddress,
      side: "buy",
      amountIn: params.amountIn,
      slippagePercent: params.slippagePercent,
      referrer: params.referrer,
    });
  }

  /**
   * Sells a coin for USDC through PoolSwap. Requires a prior coin approval to
   * PoolSwap (see approveSwapInput); throws before sending if the allowance is
   * short.
   * @param params.coinAddress - The coin to sell
   * @param params.amountIn - Exact coins to sell (18 decimals)
   * @param params.slippagePercent - Max price movement beyond the quoted fill, default 5 (%)
   * @param params.referrer - Optional referrer credited with 5% of the swap fee
   * @returns Transaction response
   */
  async sellCoin(params: {
    coinAddress: Address;
    amountIn: bigint;
    slippagePercent?: number;
    referrer?: Address;
  }) {
    return this.executeSwap({
      coinAddress: params.coinAddress,
      side: "sell",
      amountIn: params.amountIn,
      slippagePercent: params.slippagePercent,
      referrer: params.referrer,
    });
  }

  private async executeSwap(params: {
    coinAddress: Address;
    side: "buy" | "sell";
    amountIn: bigint;
    slippagePercent?: number;
    referrer?: Address;
  }) {
    const inputToken =
      params.side === "buy" ? USDC_ADDRESS : params.coinAddress;

    const allowance = await this.swapAllowance(inputToken);
    if (allowance < params.amountIn) {
      throw new Error(
        `Insufficient ${params.side === "buy" ? "USDC" : "coin"} allowance to PoolSwap: ` +
          `have ${allowance}, need ${params.amountIn}. Call approveSwapInput first.`
      );
    }

    const sqrtPriceX96 = await this.currentSqrtPriceX96(params.coinAddress);
    if (sqrtPriceX96 === 0n) {
      throw new Error(
        "Pool has no observed price yet; try again after the first swap"
      );
    }

    const quotedAmountOut =
      params.side === "buy"
        ? await this.getBuyQuoteExactInput({
            coinAddress: params.coinAddress,
            amountIn: params.amountIn,
            referrer: params.referrer,
          })
        : await this.getSellQuoteExactInput({
            coinAddress: params.coinAddress,
            amountIn: params.amountIn,
            referrer: params.referrer,
          });

    const zeroForOne = swapDirection(params.side, params.coinAddress);

    return this.readWritePoolSwap.swap({
      poolKey: coinPoolKey(
        params.coinAddress,
        this.getPositionManagerAddress()
      ),
      zeroForOne,
      // Exact-in is negative amountSpecified in v4 semantics.
      amountSpecified: -params.amountIn,
      // Anchor the bound on the quoted end price, not spot: a large trade's
      // own impact must not consume the slippage budget, or PoolSwap would
      // stop at the limit and settle a partial fill.
      sqrtPriceLimitX96: sqrtPriceLimit({
        current: expectedEndSqrtPriceX96({
          current: sqrtPriceX96,
          zeroForOne,
          amountIn: params.amountIn,
          amountOut: quotedAmountOut,
        }),
        zeroForOne,
        slippageBps: Math.round((params.slippagePercent ?? 5) * 100),
      }),
      referrer: params.referrer,
    });
  }

  /**
   * Withdraws the connected creator's accrued revenue from the FeeEscrow as
   * USDC
   * @param recipient - Optional recipient; defaults to the connected wallet
   * @returns Transaction response
   */
  async withdrawCreatorRevenue(params?: { recipient?: Address }) {
    const recipient =
      params?.recipient ?? (await this.drift.getSignerAddress());
    return this.readWriteFeeEscrow.withdrawFees(recipient);
  }

  /**
   * Claims the referral balance for a given recipient
   * @param tokens - The tokens to claim (coin addresses and/or USDC)
   * @param recipient - The address to receive the claimed tokens
   * @returns Transaction response
   */
  claimReferralBalance(tokens: Address[], recipient: Address) {
    return this.readWriteReferralEscrow.claimTokens(tokens, recipient);
  }

  /**
   * Claims the connected wallet's share from an earnings-split manager (paid
   * as USDC)
   * @param managerAddress - The AddressFeeSplitManager instance
   * @returns Transaction response
   */
  claimSplitEarnings(managerAddress: Address) {
    const readWriteTreasuryManager = new ReadWriteTreasuryManager(
      managerAddress,
      this.drift
    );
    return readWriteTreasuryManager.claim();
  }

  /**
   * Claims an address's outstanding daily holder pool balance from the
   * UniversalRewardsDistributor. Fetches the entitlement + proof from the
   * ubi.fun API; throws if nothing is claimable (including while the ledger
   * root is timelocked).
   * @param account - Optional holder; defaults to the connected wallet
   * @returns Transaction response
   */
  async claimUbi(account?: Address) {
    const holder = account ?? (await this.drift.getSignerAddress());
    const { claimable, entitlement } = await this.claimableUbi(holder);
    if (claimable === 0n || !entitlement.cumulativeWei || !entitlement.proof) {
      throw new Error("Nothing claimable for this address right now");
    }

    return this.readWriteUbiPool.claim({
      account: holder,
      reward: USDC_ADDRESS,
      claimable: BigInt(entitlement.cumulativeWei),
      proof: entitlement.proof,
    });
  }

  treasuryManagerSetPermissions(
    treasuryManagerAddress: Address,
    permissionsAddress: Address
  ) {
    const readWriteTreasuryManager = new ReadWriteTreasuryManager(
      treasuryManagerAddress,
      this.drift
    );
    return readWriteTreasuryManager.setPermissions(permissionsAddress);
  }

  /**
   * Transfers the ownership of a treasury manager to a new address
   * @param treasuryManagerAddress - The address of the treasury manager
   * @param newManagerOwner - The address of the new manager owner
   * @returns Transaction response
   */
  treasuryManagerTransferOwnership(
    treasuryManagerAddress: Address,
    newManagerOwner: Address
  ) {
    const readWriteTreasuryManager = new ReadWriteTreasuryManager(
      treasuryManagerAddress,
      this.drift
    );
    return readWriteTreasuryManager.transferManagerOwnership(newManagerOwner);
  }

  /**
   * Sets approval for all Flaunch NFTs to an operator
   * @param operator - The operator address to approve/revoke
   * @param approved - Whether to approve or revoke approval
   * @returns Transaction response
   */
  setFlaunchTokenApprovalForAll(operator: Address, approved: boolean) {
    return this.drift.write({
      abi: erc721Abi,
      address: this.getFlaunchAddress(),
      fn: "setApprovalForAll",
      args: { operator, approved },
    });
  }

  /**
   * Adds an existing Flaunch NFT to a treasury manager. NFT approval must be
   * given prior to calling this function.
   * @param treasuryManagerAddress - The address of the treasury manager
   * @param tokenId - The token ID to deposit
   * @param creator - Optional creator address. If not provided, uses the connected wallet address
   * @param data - Optional additional data for the deposit (defaults to empty bytes)
   * @returns Transaction response
   */
  async addToTreasuryManager(
    treasuryManagerAddress: Address,
    tokenId: bigint,
    creator?: Address,
    data: `0x${string}` = "0x"
  ) {
    const readWriteTreasuryManager = new ReadWriteTreasuryManager(
      treasuryManagerAddress,
      this.drift
    );

    const flaunchToken = {
      flaunch: this.getFlaunchAddress(),
      tokenId,
    };

    const creatorAddress = creator ?? (await this.drift.getSignerAddress());

    return readWriteTreasuryManager.deposit(flaunchToken, creatorAddress, data);
  }
}
