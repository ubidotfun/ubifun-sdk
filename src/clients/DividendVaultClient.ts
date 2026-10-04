import {
  type ReadContract,
  type Address,
  type Drift,
  type ReadWriteContract,
  type ReadWriteAdapter,
  createDrift,
} from "@delvtech/drift";
import { DividendVaultAbi } from "../abi/DividendVault";

export type DividendVaultABI = typeof DividendVaultAbi;

/**
 * Read client for a creator vault (DividendVault clone): it holds one token's
 * creator NFT forever and splits the creator side of its fees between the
 * token's holders and the creator recipients.
 */
export class ReadDividendVault {
  public readonly contract: ReadContract<DividendVaultABI>;

  constructor(address: Address, drift: Drift = createDrift()) {
    if (!address) {
      throw new Error("Address is required");
    }
    this.contract = drift.contract({ abi: DividendVaultAbi, address });
  }

  // Every read is fresh: an empty or uninitialized clone reports zero for memecoin and
  // holderShare until its first deposit, and renounced, managerOwner and balances change with
  // transactions.

  /** The token whose creator NFT this vault holds. */
  async memecoin() {
    await this.contract.cache.invalidateRead("memecoin");
    return this.contract.read("memecoin");
  }

  /** Holder share of what the vault receives, in 100_00 = 100% units. */
  async holderShare() {
    await this.contract.cache.invalidateRead("holderShare");
    return this.contract.read("holderShare");
  }

  /** Whether the whole creator side goes to holders for good. */
  async renounced() {
    await this.contract.cache.invalidateRead("renounced");
    return this.contract.read("renounced");
  }

  async managerOwner() {
    await this.contract.cache.invalidateRead("managerOwner");
    return this.contract.read("managerOwner");
  }

  /** USDC a creator recipient can claim now (after the latest harvest). */
  async balances(recipient: Address) {
    await this.contract.cache.invalidateRead("balances", { _recipient: recipient });
    return this.contract.read("balances", { _recipient: recipient });
  }
}

/** Write client for a creator vault. */
export class ReadWriteDividendVault extends ReadDividendVault {
  declare contract: ReadWriteContract<DividendVaultABI>;

  constructor(address: Address, drift: Drift<ReadWriteAdapter> = createDrift()) {
    super(address, drift);
  }

  /** Moves the vault's fees in and splits them (holders' part drips over 24 hours). Anyone can call. */
  harvest() {
    return this.contract.write("harvest", {});
  }

  /** Pays the caller's creator credit. */
  claim() {
    return this.contract.write("claim", {});
  }

  /** Manager owner only: every creator fee goes to holders from now on. Cannot be undone. */
  renounce() {
    return this.contract.write("renounce", {});
  }
}
