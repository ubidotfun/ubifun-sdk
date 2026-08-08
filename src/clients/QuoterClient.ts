import {
  type ReadContract,
  type Address,
  type Drift,
  createDrift,
} from "@delvtech/drift";
import { QuoterAbi } from "../abi/Quoter";
import { coinPoolKey, referrerHookData, swapDirection } from "../utils/swap";

export type QuoterABI = typeof QuoterAbi;

/**
 * Client for the Uniswap V4Quoter. Every ubi.fun pool is a single hop between
 * the coin and USDC (6 decimals) with the PositionManager as the hook, so all
 * quotes are quoteExactInputSingle / quoteExactOutputSingle calls.
 *
 * Pass the SAME referrer you will swap with: the hook data changes how the fee
 * is assigned, and a quote without it will not match execution.
 */
export class ReadQuoter {
  chainId: number;
  public readonly contract: ReadContract<QuoterABI>;

  constructor(chainId: number, address: Address, drift: Drift = createDrift()) {
    this.chainId = chainId;
    if (!address) {
      throw new Error("Address is required");
    }

    this.contract = drift.contract({
      abi: QuoterAbi,
      address,
    });
  }

  /**
   * Quote for buying a coin with an exact amount of USDC
   * @param coinAddress - The coin to buy
   * @param amountIn - Exact USDC to spend (6 decimals)
   * @param positionManagerAddress - The PositionManager (pool hook)
   * @param referrer - Optional referrer address, must match the swap's referrer
   * @returns Promise<bigint> - Expected coins out (18 decimals)
   */
  async getBuyQuoteExactInput({
    coinAddress,
    amountIn,
    positionManagerAddress,
    referrer,
  }: {
    coinAddress: Address;
    amountIn: bigint;
    positionManagerAddress: Address;
    referrer?: Address;
  }) {
    const res = await this.contract.simulateWrite("quoteExactInputSingle", {
      params: {
        poolKey: coinPoolKey(coinAddress, positionManagerAddress),
        zeroForOne: swapDirection("buy", coinAddress),
        exactAmount: amountIn,
        hookData: referrerHookData(referrer),
      },
    });

    return res.amountOut;
  }

  /**
   * Quote for selling an exact amount of a coin for USDC
   * @param coinAddress - The coin to sell
   * @param amountIn - Exact coins to sell (18 decimals)
   * @param positionManagerAddress - The PositionManager (pool hook)
   * @param referrer - Optional referrer address, must match the swap's referrer
   * @returns Promise<bigint> - Expected USDC out (6 decimals)
   */
  async getSellQuoteExactInput({
    coinAddress,
    amountIn,
    positionManagerAddress,
    referrer,
  }: {
    coinAddress: Address;
    amountIn: bigint;
    positionManagerAddress: Address;
    referrer?: Address;
  }) {
    const res = await this.contract.simulateWrite("quoteExactInputSingle", {
      params: {
        poolKey: coinPoolKey(coinAddress, positionManagerAddress),
        zeroForOne: swapDirection("sell", coinAddress),
        exactAmount: amountIn,
        hookData: referrerHookData(referrer),
      },
    });

    return res.amountOut;
  }

  /**
   * Quote for buying an exact amount of a coin, answering the USDC required
   * @param coinAddress - The coin to buy
   * @param coinOut - Exact coins to receive (18 decimals)
   * @param positionManagerAddress - The PositionManager (pool hook)
   * @param referrer - Optional referrer address, must match the swap's referrer
   * @returns Promise<bigint> - Required USDC in (6 decimals)
   */
  async getBuyQuoteExactOutput({
    coinAddress,
    coinOut,
    positionManagerAddress,
    referrer,
  }: {
    coinAddress: Address;
    coinOut: bigint;
    positionManagerAddress: Address;
    referrer?: Address;
  }) {
    const res = await this.contract.simulateWrite("quoteExactOutputSingle", {
      params: {
        poolKey: coinPoolKey(coinAddress, positionManagerAddress),
        zeroForOne: swapDirection("buy", coinAddress),
        exactAmount: coinOut,
        hookData: referrerHookData(referrer),
      },
    });

    return res.amountIn;
  }
}
