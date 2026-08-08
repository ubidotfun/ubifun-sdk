import {
  type ReadContract,
  type ReadWriteContract,
  type ReadWriteAdapter,
  type Address,
  type Drift,
  createDrift,
} from "@delvtech/drift";
import { zeroAddress } from "viem";
import { PoolSwapAbi } from "../abi/PoolSwap";
import { PoolKey } from "../types";

export type PoolSwapABI = typeof PoolSwapAbi;

/**
 * Client for the PoolSwap contract, the supported way to trade ubi.fun pools:
 * unlike a generic v4 router it forwards a referrer to the hook, which assigns
 * that address 5% of the swap fee in the ReferralEscrow.
 *
 * Approve the input token to PoolSwap before swapping: USDC for buys, the coin
 * for sells. Amounts are USDC 6 decimals on the cash side and 18 decimals on
 * the coin side.
 */
export class ReadPoolSwap {
  public readonly contract: ReadContract<PoolSwapABI>;

  constructor(address: Address, drift: Drift = createDrift()) {
    if (!address) {
      throw new Error("Address is required");
    }

    this.contract = drift.contract({
      abi: PoolSwapAbi,
      address,
    });
  }
}

export class ReadWritePoolSwap extends ReadPoolSwap {
  declare contract: ReadWriteContract<PoolSwapABI>;

  constructor(
    address: Address,
    drift: Drift<ReadWriteAdapter> = createDrift()
  ) {
    super(address, drift);
  }

  /**
   * Executes a swap against a ubi.fun pool
   * @param params.poolKey - The pool key (read it back with PositionManager.poolKey)
   * @param params.zeroForOne - v4 direction against the pool key ordering
   * @param params.amountSpecified - Negative for exact-in, positive for exact-out
   * @param params.sqrtPriceLimitX96 - Slippage bound on the pool price
   * @param params.referrer - Optional referrer credited with 5% of the swap fee
   * @returns Transaction response
   */
  swap(params: {
    poolKey: PoolKey;
    zeroForOne: boolean;
    amountSpecified: bigint;
    sqrtPriceLimitX96: bigint;
    referrer?: Address;
  }) {
    return this.contract.write("swap", {
      _key: params.poolKey,
      _params: {
        zeroForOne: params.zeroForOne,
        amountSpecified: params.amountSpecified,
        sqrtPriceLimitX96: params.sqrtPriceLimitX96,
      },
      _referrer: params.referrer ?? zeroAddress,
    });
  }
}
