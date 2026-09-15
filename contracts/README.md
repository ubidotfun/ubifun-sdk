# Contract sources, reserve accounting, and cold discovery

This folder ships the Solidity sources an indexer needs that are not
recoverable from the ABIs alone, plus a description of where each pool's
inventory actually sits. Everything here is the code behind the deployed
bytecode on Arc mainnet (5042) and Arc testnet (5042002); addresses are in
[`src/addresses.ts`](../src/addresses.ts).

| File | Deployed as | What it owns |
| --- | --- | --- |
| `IndexerSubscriber.sol` | `IndexerSubscriberAddress` | PoolId to coin reverse index |
| `FairLaunch.sol` | `FairLaunchAddress` | Fair-launch escrow accounting and the two immutable post-launch positions |
| `InternalSwapPool.sol` | inherited by PositionManager | Per-pool undistributed fee inventory (`poolFees`) |
| `BidWall.sol` | base of BurningBidWall | Bid wall position, pending USDC, reposition logic |
| `BurningBidWall.sol` | `BidWallAddress` | The deployed BidWall: coins it buys are burned on reposition |
| `TokenSupply.sol` | library | `INITIAL_SUPPLY = 100e27` minted to the PositionManager at launch |

The protocol is a fork of [Flaunch](https://github.com/flaunchgg/contracts)
(MIT). `IndexerSubscriber`, `FairLaunch`, `InternalSwapPool` and `BidWall` are
upstream files; `BurningBidWall` is ours. The PositionManager (the v4 hook) is
not reproduced here in full; the relevant call sites are quoted below.

## Build settings for bytecode verification

All contracts were compiled with one profile:

| Setting | Value |
| --- | --- |
| solc | 0.8.26 (commit 8a97fa7a) |
| via_ir | true |
| optimizer | enabled |
| evm_version | cancun |
| bytecode_hash | none |
| cbor_metadata | false |

Metadata is stripped, so a rebuild with these settings reproduces the runtime
bytecode byte for byte.

## IndexerSubscriber

`PositionManager.poolKey(coin)` is the only lookup the core protocol keeps, and
it goes coin to pool. The IndexerSubscriber is a `Notifier` subscriber that
stores the inverse when a pool is initialised:

```
poolIndex(bytes32 poolId)
  -> (address flaunch, address memecoin, address memecoinTreasury, uint256 tokenId)
```

- Zero addresses mean the PoolId was not initialised through our hook. Use
  this to reject foreign v4 pools during cold discovery.
- `tokenId` comes back as 0 when the creator has burned the Flaunch NFT. The
  pool is still live; creator fees route to the treasury from then on.
- `addIndex` back-fills pools that predate the subscriber. It validates
  against `Flaunch.tokenId(memecoin)` and reverts on mismatch, so it cannot be
  used to poison the index.

With the SDK:

```ts
const sdk = createUbiSDK({ chainId: 5042, publicClient });
const { memecoin_, memecoinTreasury_, tokenId_ } =
  await sdk.readIndexerSubscriber.poolIndex({ poolId });
```

## Cold discovery

Start from the deployment block (mainnet 12226732, testnet 52401162) and take
either source; they are equivalent:

1. `PositionManager.PoolCreated(poolId, memecoin, memecoinTreasury, tokenId,
   currencyFlipped, flaunchFee, params)` logs, one per launch
   (`currencyFlipped == true` means USDC is `currency1`), or
2. `PoolManager.Initialize` logs filtered on `hooks == PositionManager`.

Then confirm each PoolId with `IndexerSubscriber.poolIndex` and fetch the exact
PoolKey with `PositionManager.poolKey(coin)` rather than assembling it by hand.
Every pool is `fee: 0, tickSpacing: 60, hooks: PositionManager`, and the two
currencies are native USDC (`0x3600...0000`, 6 decimals through its ERC20
interface) and the coin (18 decimals), ordered by address. USDC is `currency0`
when the coin address sorts above it; check `nativeIsZero` per pool, do not
assume a side.

## Where a pool's reserves live

Active v4 liquidity in the PoolManager is only part of the picture. A pool's
inventory is spread over four places, and two of them are tradable liquidity
that `getLiquidity` never shows.

### 1. Fair-launch escrow (PositionManager balance, not the PoolManager)

At launch `Flaunch.flaunch` mints `INITIAL_SUPPLY` (100e27) of the coin to the
PositionManager. No v4 liquidity is created. The fair-launch allocation is held
as an accounting entry on the FairLaunch contract:

```
fairLaunchInfo(poolId) -> { startsAt, endsAt, initialTick, revenue, supply, closed }
initialSupply(poolId)  -> tokens originally allocated to the fair launch
```

During the window (`startsAt <= now < endsAt`, `closed == false`):

- Buys fill from `supply` at the fixed price of `initialTick`, through
  `FairLaunch.fillFromPosition`. `supply` goes down, `revenue` (USDC) goes up.
  `initialSupply - supply` is the cumulative amount sold.
- Sells revert (`CannotSellTokenDuringFairLaunch`), and liquidity cannot be
  modified (`CannotModifyLiquidityDuringFairLaunch`).
- v4 liquidity is zero. If you only read the PoolManager you will see an empty
  pool with a price and no depth; the real depth is `supply` coins at
  `initialTick`.

When the window ends (first swap after `endsAt`, or the allocation sells out),
`PositionManager` calls `FairLaunch.closePosition` and:

- The unsold `supply` is transferred to `0x...dEaD` and `FairLaunchBurn(poolId,
  amount)` is emitted. It is gone from circulation.
- `revenue` USDC becomes an immutable single-sided v4 position one tick
  spacing wide, immediately on the USDC side of `initialTick`. Owner is the
  FairLaunch contract, salt `bytes32(0)`.
- The rest of the coin supply held by the PositionManager, minus undistributed
  coin fees (`poolFees.amount1`) and minus the burned amount, becomes an
  immutable single-sided v4 position from `initialTick` out to MIN_TICK or
  MAX_TICK on the coin side. Same owner and salt.
- `FairLaunchEnded(poolId, revenue, supply, endedAt)` is emitted.

Both positions are permanent: nothing in the protocol can remove them.

### 2. Internal Swap Pool inventory (PositionManager balance)

Swap fees are captured in the currency the swap produced. They are not sent to
the v4 pool; they are booked per pool on the hook:

```
PositionManager.poolFees(poolKey) -> { amount0, amount1 }
```

`amount0` is always the USDC side and `amount1` always the coin side, whatever
the PoolKey ordering. The mechanics:

- `PoolFeesReceived(poolId, amount0, amount1)` on every fee capture.
- On the next USDC to coin buy, before the v4 pool is touched, the hook sells
  `amount1` coins to the buyer at the current pool price with zero fee
  (`_internalSwap`). `amount1` falls, `amount0` rises, and
  `PoolFeesSwapped(poolId, zeroForOne, amount0, amount1)` is emitted. The
  buyer's remaining size then goes through v4 as normal.
- `amount0` is periodically distributed to the fee recipients (creator escrow,
  bid wall, the UBI holder pool, referrer, protocol) and
  `PoolFeesDistributed` reports the split.

So `poolFees.amount1` is real coin liquidity at the spot price that a v4-only
model misses, and `poolFees.amount0` is USDC that will leave the pool system on
distribution rather than being depth.

Ordering inside one buy: fair-launch fill first (window open only), then the
internal swap, then the v4 pool. While the window is open the pool has no v4
liquidity, so the internal swap step moves nothing and coin-side fees simply
accumulate in `amount1` until the window closes; from then on they are sold to
buyers ahead of v4.

### 3. Bid wall (BurningBidWall)

A fixed share of USDC fees is deposited to the bid wall each distribution:

```
BidWall.poolInfo(poolId) -> { disabled, initialized, tickLower, tickUpper, pendingETHFees, cumulativeSwapFees }
BidWall.position(poolId) -> (amount0, amount1, pendingEth)
```

- `pendingETHFees` is USDC the bid wall holds but has not deployed yet; it
  waits until the deposit crosses `_swapFeeThreshold`, then the position is
  created or repositioned one tick spacing below the current price on the USDC
  side. `BidWallDeposit`, `BidWallInitialized` and `BidWallRepositioned`
  report this.
- The deployed position is a v4 position owned by the BidWall contract with
  salt `"bidwall"` and the ticks from `poolInfo`. `position()` converts its
  liquidity to token amounts at the current price for you.
- When price trades through the wall it accumulates coins. On the next
  reposition those coins are withdrawn and, in the deployed BurningBidWall,
  sent to `0x...dEaD` instead of the treasury. That is the only difference
  from upstream; `closeBidWall` (creator disables the wall) still returns
  everything to the coin's treasury.

### 4. Ordinary v4 positions

Anyone may add liquidity once the fair-launch window has closed. Read those
positions off the PoolManager as usual.

## Putting it together

For a pool at time `t`:

```
USDC depth      = v4 USDC across all positions (FairLaunch revenue position,
                  BidWall position, third parties)
                + BidWall.pendingETHFees            (not yet at any tick)
coin depth      = v4 coin across all positions
                + fairLaunchInfo.supply             (at initialTick, window open only)
                + poolFees.amount1                  (at spot, sold before v4)
not depth       = poolFees.amount0                  (USDC awaiting distribution)
burned          = balanceOf(0x...dEaD)              (unsold fair launch + bid wall buys)
circulating     = INITIAL_SUPPLY - burned - coin held by PositionManager
                  - coin in v4 positions
```

Coin held by the PositionManager equals `fairLaunchInfo.supply` (window open)
plus `poolFees.amount1`, plus, before the window closes, the not-yet-deployed
remainder of the supply.

## StateView

Arc mainnet has the canonical Uniswap v4 StateView at
`0xf3334192d15450cdd385c8b70e03f9a6bd9e673b` (`StateViewAddress`) over the
canonical PoolManager. Arc testnet runs our own PoolManager instance
(`0x5fb24c800133a0930280788c5eb3468764154309`) and no StateView was deployed
against it. There is no testnet StateView address to give.

The SDK does not need one on either network. `ReadPoolManager` (exported as
`sdk.readPoolManager`) reads slot0, liquidity, ticks and position info straight
out of PoolManager storage with `extsload`, using the same slot layout as
Uniswap's StateLibrary, so the same code runs on both chains. If you want a
single discovery path, use that.
