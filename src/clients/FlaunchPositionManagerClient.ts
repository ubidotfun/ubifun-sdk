import {
  type ReadContract,
  type Address,
  type Drift,
  type EventLog,
  createDrift,
  HexString,
} from "@delvtech/drift";
import { type Hex } from "viem";
import { FlaunchPositionManagerAbi } from "../abi/FlaunchPositionManager";
import { getAmountWithSlippage } from "../utils/slippage";
import { parseSwapData, type SwapLogArgs } from "../utils/parseSwap";
import { ReadInitialPrice } from "./InitialPriceClient";

export type FlaunchPositionManagerABI = typeof FlaunchPositionManagerAbi;
export type PoolCreatedLog = EventLog<
  FlaunchPositionManagerABI,
  "PoolCreated"
> & {
  timestamp: number;
};
export type PoolCreatedLogs = PoolCreatedLog[];

export interface WatchPoolCreatedParams {
  onPoolCreated: ({
    logs,
    isFetchingFromStart,
  }: {
    logs: PoolCreatedLogs;
    isFetchingFromStart: boolean;
  }) => void;
  startBlockNumber?: bigint;
}

export type BaseSwapLog = EventLog<FlaunchPositionManagerABI, "PoolSwap"> & {
  timestamp: number;
};

export type BuySwapLog = BaseSwapLog & {
  type: "BUY";
  delta: {
    coinsBought: bigint;
    usdcSold: bigint;
    fees: {
      isInUSDC: boolean;
      amount: bigint;
    };
  };
};

export type SellSwapLog = BaseSwapLog & {
  type: "SELL";
  delta: {
    coinsSold: bigint;
    usdcBought: bigint;
    fees: {
      isInUSDC: boolean;
      amount: bigint;
    };
  };
};

export type PoolSwapLog = BuySwapLog | SellSwapLog | BaseSwapLog;
export type PoolSwapLogs = PoolSwapLog[];

export interface WatchPoolSwapParams<
  TUSDCIsCurrencyZero extends boolean | undefined = undefined
> {
  onPoolSwap: ({
    logs,
    isFetchingFromStart,
  }: {
    logs: TUSDCIsCurrencyZero extends boolean
      ? (BuySwapLog | SellSwapLog)[]
      : BaseSwapLog[];
    isFetchingFromStart: boolean;
  }) => void;
  usdcIsCurrencyZero?: TUSDCIsCurrencyZero;
  startBlockNumber?: bigint;
  filterByPoolId?: HexString;
}

/**
 * Client for the PositionManager, the Uniswap v4 hook at the center of the
 * protocol: it creates pools, collects and splits fees, and emits the
 * PoolCreated / PoolSwap events integrators index.
 *
 * Launch coins through the FlaunchZap (see ReadWriteFlaunchZap) and trade
 * through PoolSwap; this client is the read/event surface.
 */
export class ReadFlaunchPositionManager {
  public readonly contract: ReadContract<FlaunchPositionManagerABI>;
  drift: Drift;
  public pollPoolCreatedNow?: () => Promise<void>;
  public pollPoolSwapNow?: () => Promise<void>;
  public readonly TOTAL_SUPPLY = 100n * 10n ** 27n; // 100 Billion tokens in wei

  constructor(address: Address, drift: Drift = createDrift()) {
    this.drift = drift;
    if (!address) {
      throw new Error("Address is required");
    }
    this.contract = drift.contract({
      abi: FlaunchPositionManagerAbi,
      address,
    });
  }

  getFeeCalculator({ forFairLaunch }: { forFairLaunch: boolean }) {
    return this.contract.read("getFeeCalculator", {
      _isFairLaunch: forFairLaunch,
    });
  }

  async isValidCoin(coinAddress: Address) {
    const poolKey = await this.contract.read("poolKey", {
      _token: coinAddress,
    });

    return poolKey.tickSpacing !== 0;
  }

  /**
   * Reads the exact pool key for a coin, as stored by the hook. Prefer this
   * over assembling the key by hand.
   */
  poolKey(coinAddress: Address) {
    return this.contract.read("poolKey", {
      _token: coinAddress,
    });
  }

  /**
   * Internal Swap Pool inventory for a pool: swap fees the hook is holding
   * that have not yet been distributed. `amount0` is always the USDC side,
   * `amount1` the coin side, regardless of currency ordering in the PoolKey.
   * Coin-side fees are sold to the next buyer before the v4 pool is touched,
   * so this inventory is real liquidity that active v4 positions do not show.
   * See contracts/README.md for the full reserve accounting.
   */
  poolFees(poolKey: {
    currency0: Address;
    currency1: Address;
    fee: number;
    tickSpacing: number;
    hooks: Address;
  }) {
    return this.contract.read("poolFees", {
      _poolKey: poolKey,
    });
  }

  /**
   * The live fee distribution for a pool (swapFee, referrer, protocol shares
   * in hundredths of a percent)
   */
  getPoolFeeDistribution(poolId: HexString) {
    return this.contract.read("getPoolFeeDistribution", {
      _poolId: poolId,
    });
  }

  /**
   * The flaunch fee a launch would owe, in native units (msg.value; USDC at 18
   * decimals on Arc). Reads through the initial price contract so sender fee
   * exemptions apply.
   */
  async getFlaunchingFee(params: {
    sender: Address;
    initialPriceParams: HexString;
    slippagePercent?: number;
  }) {
    const readInitialPrice = new ReadInitialPrice(
      await this.contract.read("initialPrice"),
      this.drift
    );
    const flaunchingFee = await readInitialPrice.getFlaunchingFee(params);

    // pad the fee by the slippage percent so a price move between quote and
    // send does not revert the launch (excess is refunded on-chain)
    const flaunchingFeeWithSlippage = getAmountWithSlippage({
      amount: flaunchingFee,
      slippage: ((params.slippagePercent ?? 0) / 100).toFixed(18).toString(),
      swapType: "EXACT_OUT",
    });
    return flaunchingFeeWithSlippage;
  }

  async watchPoolCreated({
    onPoolCreated,
    startBlockNumber,
  }: WatchPoolCreatedParams) {
    let intervalId: ReturnType<typeof setInterval>;

    if (startBlockNumber !== undefined) {
      onPoolCreated({
        logs: [],
        isFetchingFromStart: true,
      });
    }

    let lastBlockNumber = startBlockNumber
      ? startBlockNumber - 1n
      : await this.drift.getBlockNumber();

    const pollEvents = async () => {
      try {
        const currentBlockNumber = await this.drift.getBlockNumber();

        if (currentBlockNumber > lastBlockNumber) {
          const _logs = await this.contract.getEvents("PoolCreated", {
            fromBlock: lastBlockNumber + 1n,
            toBlock: currentBlockNumber,
          });

          // Get timestamps for each log
          const logsWithTimestamps = await Promise.all(
            [..._logs].reverse().map(async (log) => {
              const block = await this.drift.getBlock(log.blockNumber);
              return {
                ...log,
                timestamp: Number(block?.timestamp) * 1_000, // convert to ms for js
              };
            })
          );

          if (logsWithTimestamps.length > 0) {
            onPoolCreated({
              logs: logsWithTimestamps,
              isFetchingFromStart: false,
            });
          } else {
            onPoolCreated({
              logs: [],
              isFetchingFromStart: false,
            });
          }

          lastBlockNumber = currentBlockNumber;
        }
      } catch (error) {
        console.error("Error polling events:", error);
      }
    };

    intervalId = setInterval(pollEvents, 5_000);

    this.pollPoolCreatedNow = pollEvents;

    // Return both cleanup function and immediate poll function
    return {
      cleanup: () => {
        if (intervalId) {
          clearInterval(intervalId);
        }
        // Clear the pollNow function when cleaning up
        this.pollPoolCreatedNow = undefined;
      },
      pollPoolCreatedNow: pollEvents,
    };
  }

  /**
   * Parses a transaction hash to extract PoolSwap events and return parsed swap data
   * @param txHash - The transaction hash to parse
   * @param usdcIsCurrencyZero - Whether USDC is currency0 in the pool (optional)
   * @returns Parsed swap log or undefined if no PoolSwap event found
   */
  async parseSwapTx(
    txHash: Hex,
    usdcIsCurrencyZero?: boolean
  ): Promise<PoolSwapLog | undefined> {
    try {
      // Get transaction to get block number
      const tx = await this.drift.getTransaction({ hash: txHash });
      if (!tx) {
        return undefined;
      }

      // Get block to get timestamp
      const block = await this.drift.getBlock(tx.blockNumber);
      const timestamp = Number(block?.timestamp) * 1_000; // convert to ms for js

      // Get PoolSwap events from the specific transaction
      const swapLogs = await this.contract.getEvents("PoolSwap", {
        fromBlock: tx.blockNumber,
        toBlock: tx.blockNumber,
      });

      // Find the first swap log that matches our transaction hash
      const targetLog = swapLogs.find((log) => log.transactionHash === txHash);
      if (!targetLog) {
        return undefined;
      }

      // If usdcIsCurrencyZero is not provided, return basic log
      if (usdcIsCurrencyZero === undefined) {
        return {
          ...targetLog,
          timestamp,
        };
      }

      // Parse the swap data using the utility function
      const swapData = parseSwapData(
        targetLog.args as SwapLogArgs,
        usdcIsCurrencyZero
      );

      return {
        ...targetLog,
        timestamp,
        type: swapData.type,
        delta: swapData.delta,
      };
    } catch (error) {
      console.error("Error parsing swap transaction:", error);
      return undefined;
    }
  }

  async watchPoolSwap<T extends boolean | undefined = undefined>({
    onPoolSwap,
    usdcIsCurrencyZero,
    startBlockNumber,
    filterByPoolId,
  }: WatchPoolSwapParams<T>) {
    let intervalId: ReturnType<typeof setInterval>;

    if (startBlockNumber !== undefined) {
      onPoolSwap({
        logs: [],
        isFetchingFromStart: true,
      });
    }

    let lastBlockNumber = startBlockNumber
      ? startBlockNumber - 1n
      : await this.drift.getBlockNumber();

    const pollEvents = async () => {
      try {
        const currentBlockNumber = await this.drift.getBlockNumber();

        if (currentBlockNumber > lastBlockNumber) {
          const _logs = await this.contract.getEvents("PoolSwap", {
            fromBlock: lastBlockNumber + 1n,
            toBlock: currentBlockNumber,
            filter: {
              poolId: filterByPoolId,
            },
          });

          // Get timestamps for each log
          const logsWithTimestamps = await Promise.all(
            [..._logs].reverse().map(async (log): Promise<PoolSwapLog> => {
              const block = await this.drift.getBlock(log.blockNumber);
              const timestamp = Number(block?.timestamp) * 1_000; // convert to ms for js

              if (usdcIsCurrencyZero === undefined) {
                return {
                  ...log,
                  timestamp,
                };
              }

              // parse swap data
              const swapData = parseSwapData(
                log.args as SwapLogArgs,
                usdcIsCurrencyZero
              );

              return {
                ...log,
                timestamp,
                type: swapData.type,
                delta: swapData.delta,
              };
            })
          );

          if (logsWithTimestamps.length > 0) {
            onPoolSwap({
              logs: logsWithTimestamps as T extends boolean
                ? (BuySwapLog | SellSwapLog)[]
                : BaseSwapLog[],
              isFetchingFromStart: false,
            });
          } else {
            onPoolSwap({
              logs: [],
              isFetchingFromStart: false,
            });
          }

          lastBlockNumber = currentBlockNumber;
        }
      } catch (error) {
        console.error("Error polling events:", error);
      }
    };

    intervalId = setInterval(pollEvents, 5_000);

    this.pollPoolSwapNow = pollEvents;

    // Return both cleanup function and immediate poll function
    return {
      cleanup: () => {
        if (intervalId) {
          clearInterval(intervalId);
        }
        // Clear the pollNow function when cleaning up
        this.pollPoolSwapNow = undefined;
      },
      pollPoolSwapNow: pollEvents,
    };
  }
}
