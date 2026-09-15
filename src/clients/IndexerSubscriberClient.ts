import {
  type ReadContract,
  type Address,
  type Drift,
  type HexString,
  createDrift,
} from "@delvtech/drift";
import { IndexerSubscriberAbi } from "../abi/IndexerSubscriber";

export type IndexerSubscriberABI = typeof IndexerSubscriberAbi;

/**
 * Read-only client for the IndexerSubscriber: the on-chain reverse index from
 * a Uniswap v4 PoolId to the coin that owns the pool.
 *
 * The protocol's own lookups are one-directional (coin address to PoolKey via
 * `PositionManager.poolKey`). This subscriber listens to the PositionManager's
 * Notifier on `afterInitialize` and stores the inverse, so an indexer that only
 * has a PoolId (from a PoolManager `Initialize` or `Swap` log) can resolve the
 * coin, its treasury, and its Flaunch tokenId without replaying our events.
 */
export class ReadIndexerSubscriber {
  public readonly contract: ReadContract<IndexerSubscriberABI>;

  /**
   * @param address - The IndexerSubscriber address for the chain
   * @param drift - Optional drift instance (creates a new one if not provided)
   * @throws Error if address is not provided
   */
  constructor(address: Address, drift: Drift = createDrift()) {
    if (!address) {
      throw new Error("Address is required");
    }

    this.contract = drift.contract({
      abi: IndexerSubscriberAbi,
      address,
    });
  }

  /**
   * Resolves a PoolId to the coin behind it.
   *
   * Returns zero addresses for a PoolId that was never initialised through our
   * PositionManager hook (a foreign v4 pool, or a pool created before the
   * subscriber was attached and not back-filled with `addIndex`).
   *
   * `tokenId_` is 0 when the creator has burned the Flaunch NFT: the pool is
   * still live, but creator fees route to the treasury from then on.
   */
  poolIndex({ poolId }: { poolId: HexString }) {
    return this.contract.read("poolIndex", {
      _poolId: poolId,
    });
  }

  /**
   * True when the PoolId belongs to a coin launched through this deployment.
   */
  async isUbiPool({ poolId }: { poolId: HexString }): Promise<boolean> {
    const { memecoin_ } = await this.poolIndex({ poolId });
    return memecoin_ !== "0x0000000000000000000000000000000000000000";
  }
}
