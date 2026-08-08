import {
  type ReadContract,
  type ReadWriteContract,
  type ReadWriteAdapter,
  type Address,
  type Drift,
  createDrift,
} from "@delvtech/drift";
import { type Hex } from "viem";
import { UniversalRewardsDistributorAbi } from "../abi/UniversalRewardsDistributor";

export type UniversalRewardsDistributorABI =
  typeof UniversalRewardsDistributorAbi;

/**
 * Client for Morpho's UniversalRewardsDistributor, which pays the daily USDC
 * holder pool (24% of every swap fee). Entitlements are cumulative amounts in
 * a Merkle root the keeper submits after each daily epoch; a root becomes
 * claimable after the on-chain timelock. Fetch an address's cumulative amount
 * and proof from the ubi.fun API (GET {apiUrl}/ubi/:address), then `claim`
 * pays out the difference between the cumulative amount and what was already
 * claimed.
 */
export class ReadUniversalRewardsDistributor {
  public readonly contract: ReadContract<UniversalRewardsDistributorABI>;

  constructor(address: Address, drift: Drift = createDrift()) {
    if (!address) {
      throw new Error("Address is required");
    }

    this.contract = drift.contract({
      abi: UniversalRewardsDistributorAbi,
      address,
    });
  }

  /** The active Merkle root claims are verified against. */
  root() {
    return this.contract.read("root");
  }

  /** A submitted root still inside the timelock, if any. */
  pendingRoot() {
    return this.contract.read("pendingRoot");
  }

  /** The cumulative amount `account` has already claimed of `reward`. */
  claimed(account: Address, reward: Address) {
    return this.contract.read("claimed", {
      _account: account,
      _reward: reward,
    });
  }
}

export class ReadWriteUniversalRewardsDistributor extends ReadUniversalRewardsDistributor {
  declare contract: ReadWriteContract<UniversalRewardsDistributorABI>;

  constructor(
    address: Address,
    drift: Drift<ReadWriteAdapter> = createDrift()
  ) {
    super(address, drift);
  }

  /**
   * Claims the outstanding balance for an account. Anyone can submit; the
   * payout always goes to `account`.
   * @param params.account - The holder being claimed for
   * @param params.reward - The reward token (USDC on Arc)
   * @param params.claimable - The CUMULATIVE entitlement from the API ledger
   * @param params.proof - The Merkle proof from the API ledger
   */
  claim(params: {
    account: Address;
    reward: Address;
    claimable: bigint;
    proof: Hex[];
  }) {
    return this.contract.write("claim", {
      _account: params.account,
      _reward: params.reward,
      _claimable: params.claimable,
      _proof: params.proof,
    });
  }
}
