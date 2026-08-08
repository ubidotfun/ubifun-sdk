import {
  type ReadContract,
  type Address,
  type Drift,
  type HexString,
  createDrift,
} from "@delvtech/drift";
import {
  keccak256,
  encodePacked,
  stringToHex,
  pad,
  hexToBigInt,
  sliceHex,
  type Hex,
} from "viem";
import { bytes32ToUint256, uint256ToBytes32 } from "../helpers/hex";
import { PoolManagerAbi } from "../abi/PoolManager";

export type PoolManagerABI = typeof PoolManagerAbi;

export interface PositionInfoParams {
  poolId: HexString;
  owner: Address;
  tickLower: number;
  tickUpper: number;
  salt: string;
}

/**
 * Client for the Uniswap v4 PoolManager. Pool state is read straight off the
 * singleton's storage via extsload (StateView is not deployed on Arc), using
 * the same slot derivations as Uniswap's StateLibrary.
 */
export class ReadPoolManager {
  public readonly contract: ReadContract<PoolManagerABI>;

  constructor(address: Address, drift: Drift = createDrift()) {
    if (!address) {
      throw new Error("Address is required");
    }

    this.contract = drift.contract({
      abi: PoolManagerAbi,
      address,
    });
  }

  /** The base storage slot of a pool's State struct (_pools is at slot 6). */
  poolStateSlot({ poolId }: { poolId: HexString }) {
    const POOLS_SLOT = uint256ToBytes32(6n);

    return keccak256(
      encodePacked(["bytes32", "bytes32"], [poolId, POOLS_SLOT])
    );
  }

  /**
   * Reads a pool's Slot0: current sqrt price, tick, and fee configuration
   * @param poolId - The ID of the pool
   * @returns Promise<{sqrtPriceX96: bigint, tick: number, protocolFee: number, lpFee: number}>
   */
  async poolSlot0({ poolId }: { poolId: HexString }) {
    const stateSlot = this.poolStateSlot({ poolId });

    const result = await this.contract.read("extsload", {
      slot: stateSlot,
    });

    const data = (Array.isArray(result) ? result[0] : result) as HexString;
    const dataAsBigInt = BigInt(data);

    // Slot0 packing (bottom to top): uint160 sqrtPriceX96, int24 tick,
    // uint24 protocolFee, uint24 lpFee.
    const sqrtPriceX96 = dataAsBigInt & ((1n << 160n) - 1n);

    const tickRaw = Number((dataAsBigInt >> 160n) & 0xffffffn);
    const tick = tickRaw > 0x7fffff ? tickRaw - 0x1000000 : tickRaw;

    const protocolFee = Number((dataAsBigInt >> 184n) & 0xffffffn);
    const lpFee = Number((dataAsBigInt >> 208n) & 0xffffffn);

    return { sqrtPriceX96, tick, protocolFee, lpFee };
  }

  /**
   * Reads a liquidity position's state
   * @param poolId - The ID of the pool
   * @param owner - The address of the position owner
   * @param tickLower - The lower tick of the position
   * @param tickUpper - The upper tick of the position
   * @param salt - The salt used to identify the position
   * @returns Promise<{liquidity, feeGrowthInside0LastX128, feeGrowthInside1LastX128}>
   */
  async positionInfo({
    poolId,
    owner,
    tickLower,
    tickUpper,
    salt,
  }: PositionInfoParams): Promise<{
    liquidity: bigint;
    feeGrowthInside0LastX128: bigint;
    feeGrowthInside1LastX128: bigint;
  }> {
    const saltBytes32 = pad(stringToHex(salt), { size: 32, dir: "right" });

    const positionKey = keccak256(
      encodePacked(
        ["address", "int24", "int24", "bytes32"],
        [owner, tickLower, tickUpper, saltBytes32]
      )
    );

    const stateSlot = this.poolStateSlot({ poolId });

    // Pool.State layout: slot0(+0), feeGrowthGlobal0(+1), feeGrowthGlobal1(+2),
    // liquidity(+3), ticks(+4), tickBitmap(+5), positions(+6).
    const POSITIONS_OFFSET = 6n;
    const positionMapping = uint256ToBytes32(
      bytes32ToUint256(stateSlot) + POSITIONS_OFFSET
    );

    const positionInfoSlot = keccak256(
      encodePacked(["bytes32", "bytes32"], [positionKey, positionMapping])
    );

    const result = await this.contract.read("extsload", {
      startSlot: positionInfoSlot,
      nSlots: 3n,
    });

    // Adapters differ on whether bytes32[] comes back as an array of words or
    // one concatenated hex blob; accept both.
    let words: Hex[];
    if (Array.isArray(result)) {
      words = result as Hex[];
    } else {
      const blob = result as unknown as Hex;
      words = [0, 1, 2].map((i) =>
        sliceHex(blob, i * 32, (i + 1) * 32)
      );
    }

    return {
      liquidity: hexToBigInt(words[0]),
      feeGrowthInside0LastX128: hexToBigInt(words[1]),
      feeGrowthInside1LastX128: hexToBigInt(words[2]),
    };
  }
}
