import {
  type ReadContract,
  type Address,
  type Drift,
  type ReadWriteContract,
  type ReadWriteAdapter,
  createDrift,
} from "@delvtech/drift";
import { MemecoinDividendsAbi } from "../abi/MemecoinDividends";

export type MemecoinDividendsABI = typeof MemecoinDividendsAbi;

/** Read client for the holder dividends of a creator vault token (6-decimal USDC amounts). */
export class ReadMemecoinDividends {
  public readonly contract: ReadContract<MemecoinDividendsABI>;

  constructor(address: Address, drift: Drift = createDrift()) {
    if (!address) {
      throw new Error("Address is required");
    }
    this.contract = drift.contract({ abi: MemecoinDividendsAbi, address });
  }

  // These figures change every block (drip) and with every withdrawal, so they are read fresh
  // rather than from the read cache.

  /** USDC the holder can withdraw now. */
  async withdrawableDividendOf(holder: Address) {
    await this.contract.cache.invalidateRead("withdrawableDividendOf", { _holder: holder });
    return this.contract.read("withdrawableDividendOf", { _holder: holder });
  }

  /** USDC still dripping out over the current 24-hour window. */
  async dividendsDripping() {
    await this.contract.cache.invalidateRead("dividendsDripping");
    return this.contract.read("dividendsDripping");
  }

  /** USDC committed to holders so far, still dripping included. */
  async totalDividendsDistributed() {
    await this.contract.cache.invalidateRead("totalDividendsDistributed");
    return this.contract.read("totalDividendsDistributed");
  }
}

/** Write client for the holder dividends of a creator vault token. */
export class ReadWriteMemecoinDividends extends ReadMemecoinDividends {
  declare contract: ReadWriteContract<MemecoinDividendsABI>;

  constructor(address: Address, drift: Drift<ReadWriteAdapter> = createDrift()) {
    super(address, drift);
  }

  /** Withdraws the caller's dividends. */
  withdrawDividend() {
    return this.contract.write("withdrawDividend", {});
  }

  /** Pays a holder their dividends (anyone can call; the USDC always goes to the holder). */
  withdrawDividendFor(holder: Address) {
    return this.contract.write("withdrawDividendFor", { _holder: holder });
  }
}
