import {
  type ReadContract,
  type Address,
  type Drift,
  type HexString,
  createDrift,
} from "@delvtech/drift";
import { InitialPriceAbi } from "../abi/InitialPrice";
import { zeroAddress } from "viem";

export type InitialPriceABI = typeof InitialPriceAbi;

/**
 * Client for the deployed IInitialPrice implementation (UsdcMarketCappedPrice):
 * turns the launcher's chosen initial market cap (USDC, 6 decimals, abi-encoded
 * as a single uint256) into the pool's starting price and the flaunch fee.
 */
export class ReadInitialPrice {
  public readonly contract: ReadContract<InitialPriceABI>;

  constructor(address: Address, drift: Drift = createDrift()) {
    if (!address) {
      throw new Error("Address is required");
    }

    this.contract = drift.contract({
      abi: InitialPriceAbi,
      address,
    });
  }

  /**
   * The flaunch fee for a launch, in the chain's native units (18 decimals on
   * Arc, where msg.value is USDC at 18 decimals). Zero for market caps below
   * the on-chain threshold and for fee-exempt senders.
   * @param params.sender - The address that will send the launch
   * @param params.initialPriceParams - The abi-encoded initial market cap
   */
  getFlaunchingFee(params: { sender: Address; initialPriceParams: HexString }) {
    return this.contract.read("getFlaunchingFee", {
      _sender: params.sender,
      _initialPriceParams: params.initialPriceParams,
    });
  }

  /**
   * The starting sqrt price for a launch
   * @param params.usdcIsCurrencyZero - Whether USDC sorts as currency0
   * @param params.initialPriceParams - The abi-encoded initial market cap
   */
  getSqrtPriceX96(params: {
    usdcIsCurrencyZero: boolean;
    initialPriceParams: HexString;
  }) {
    return this.contract.read("getSqrtPriceX96", {
      _flipped: !params.usdcIsCurrencyZero,
      _initialPriceParams: params.initialPriceParams,
      0: zeroAddress, // unnamed sender param, unused by the implementation
    });
  }
}
