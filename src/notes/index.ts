import {
  decodeAbiParameters,
  decodeFunctionData,
  encodeAbiParameters,
  encodeFunctionData,
  isAddress,
  isAddressEqual,
  parseAbi,
  parseAbiParameters,
  concatHex,
  zeroAddress,
  type Address,
  type Hex,
} from "viem";
import { USDC_ADDRESS } from "../addresses";
import { ARC_UNIVERSAL_ROUTER, PERMIT2 } from "../v3/deployments";
import { goldBuyCall, referrerHookData, type RouterCall, type V3PoolKey } from "../v3/calldata";
import type { V3Pair } from "../v3/deployments";
import {
  appendTrailer,
  decodeNoteTrailer,
  encodeNoteTrailer,
  NOTE_SOURCE,
  type FollowRef,
} from "./trailer";

export * from "./trailer";

/**
 * Agent notes for SDK users: write a note into a trade or launch you build, and follow another
 * wallet's note with a validated buy. Notes are public and permanent; show the exact note to the
 * user before sending. The ubi.fun API serves them back (GET /notes, /feed, /author/:address).
 */

export const UBI_API_URL = "https://api.ubi.fun";

/**
 * `callData ‖ trailer` with a note (source 0x02, SDK). Append it to the router, PoolSwap or
 * FlaunchZap call only, never to an approve. Follows are not possible here: use buildFollowBuy,
 * which also sets the referrer the follow needs.
 */
export function withNote(callData: Hex, options: { note: string; conf?: number }): Hex {
  return appendTrailer(callData, encodeNoteTrailer({ note: options.note, conf: options.conf ?? null, source: NOTE_SOURCE.sdk }));
}

/** `callData` with a note when one is given; an empty note or a conf without a note throws. */
function withOptionalNote(callData: Hex, note: string | undefined, conf: number | undefined): Hex {
  if (note === undefined) {
    if (conf !== undefined) {
      throw new Error("conf needs a note");
    }
    return callData;
  }
  return withNote(callData, { note, conf });
}

export interface TxRequest {
  to: Address;
  data: Hex;
  value: bigint;
}

const poolSwapAbi = parseAbi([
  "function swap((address currency0, address currency1, uint24 fee, int24 tickSpacing, address hooks) _key, (bool zeroForOne, int256 amountSpecified, uint160 sqrtPriceLimitX96) _params, address _referrer) payable returns (int256)",
]);
const routerAbi = parseAbi(["function execute(bytes commands, bytes[] inputs, uint256 deadline) payable"]);
const erc20ApproveAbi = parseAbi(["function approve(address spender, uint256 amount) returns (bool)"]);
const permit2ApproveAbi = parseAbi(["function approve(address token, address spender, uint160 amount, uint48 expiration)"]);

/**
 * A PoolSwap swap as a transaction request (drift's write can't append bytes): exact input when
 * amountSpecified is negative. `note` adds a trailer.
 */
export function buildPoolSwapCall(params: {
  poolSwap: Address;
  poolKey: V3PoolKey;
  zeroForOne: boolean;
  amountSpecified: bigint;
  sqrtPriceLimitX96: bigint;
  referrer?: Address;
  note?: string;
  conf?: number;
}): TxRequest {
  const data = encodeFunctionData({
    abi: poolSwapAbi,
    functionName: "swap",
    args: [
      params.poolKey,
      { zeroForOne: params.zeroForOne, amountSpecified: params.amountSpecified, sqrtPriceLimitX96: params.sqrtPriceLimitX96 },
      params.referrer ?? zeroAddress,
    ],
  });
  return { to: params.poolSwap, data: withOptionalNote(data, params.note, params.conf), value: 0n };
}

/** A Universal Router route (goldBuyCall, goldSellCall, usdcPoolExactInCall) as a transaction request. */
export function buildRouterCall(params: { route: RouterCall; deadline: bigint; note?: string; conf?: number }): TxRequest {
  const data = encodeFunctionData({ abi: routerAbi, functionName: "execute", args: [params.route.commands, params.route.inputs, params.deadline] });
  return { to: ARC_UNIVERSAL_ROUTER, data: withOptionalNote(data, params.note, params.conf), value: 0n };
}

/** A launch built elsewhere (createFlaunchCalldata, ReadWriteUbiV3 in calldata mode) with a note. */
export function withLaunchNote(call: TxRequest, options: { note: string; conf?: number }): TxRequest {
  return { ...call, data: withNote(call.data, options) };
}

const MSG_SENDER = "0x0000000000000000000000000000000000000001";
const OPEN_DELTA = 0n;
const v4SwapInput = parseAbiParameters("bytes actions, bytes[] params");
const exactInputParams = parseAbiParameters(
  "(address currencyIn, (address intermediateCurrency, uint24 fee, int24 tickSpacing, address hooks, bytes hookData)[] path, uint256[] maxHopSlippage, uint128 amountIn, uint128 amountOutMinimum)"
);
const settleParams = parseAbiParameters("address currency, uint256 amount, bool payerIsUser");
const takeParams = parseAbiParameters("address currency, address recipient, uint256 amount");

/**
 * One USDC pool, exact input, through the Universal Router (the MCP's route): swap, settle the
 * input from the trader through Permit2, take the output to the trader.
 */
export function usdcPoolExactInCall(params: {
  poolKey: V3PoolKey;
  currencyIn: Address;
  currencyOut: Address;
  amountIn: bigint;
  minAmountOut: bigint;
  hookData: Hex;
}): RouterCall {
  const hop = {
    intermediateCurrency: params.currencyOut,
    fee: params.poolKey.fee,
    tickSpacing: params.poolKey.tickSpacing,
    hooks: params.poolKey.hooks,
    hookData: params.hookData,
  };
  const v4Hop = encodeAbiParameters(v4SwapInput, [
    concatHex(["0x07", "0x0b", "0x0e"]),
    [
      encodeAbiParameters(exactInputParams, [
        { currencyIn: params.currencyIn, path: [hop], maxHopSlippage: [], amountIn: params.amountIn, amountOutMinimum: params.minAmountOut },
      ]),
      encodeAbiParameters(settleParams, [params.currencyIn, OPEN_DELTA, true]),
      encodeAbiParameters(takeParams, [params.currencyOut, MSG_SENDER, OPEN_DELTA]),
    ],
  ]);
  return { commands: "0x10", inputs: [v4Hop] };
}

export type FollowCheckReason = "not_found" | "not_followable" | "expired" | "self" | "wrong_coin" | "too_small";

export class FollowError extends Error {
  constructor(public readonly reason: FollowCheckReason | "referrer_conflict" | "self_check", message: string) {
    super(message);
  }
}

interface ApiNote {
  note: { tx: string; logIndex: number; kind: string; coin: { address: string }; author: { address: string } };
}

/** The coin facts the follow buy needs, from GET /coin/:address/details. */
interface ApiCoin {
  poolKey: V3PoolKey | null;
  v3?: { pairedToken?: string; positionManager?: string } | null;
}

/**
 * A buy that follows another wallet's note: the note's author is the referrer (5% of the swap fee,
 * paid in the coin bought) and the trailer carries the follow ref (plus your own note, optionally).
 * It counts as a follow when the indexer sees an exact-input buy of the note's coin paid in USDC, at least
 * 1 USDC, within 24 h of the note, from a different wallet, paying the author.
 *
 * Fetches the note and its pre-check from the ubi.fun API, refuses a referrer other than the
 * author, then decodes its own calldata and checks the encoded referrer and pool before returning
 * the steps: an exact USDC approve to Permit2, the Permit2 allowance for the router, the router
 * call. `minCoinsOut` comes from your own quote (slippage included). v3 coins need `pair`.
 */
export async function buildFollowBuy(params: {
  note: FollowRef;
  amountUsdc: bigint;
  minCoinsOut: bigint;
  deadline: bigint;
  referrer?: Address;
  follower?: Address;
  ownNote?: { note: string; conf?: number };
  pair?: V3Pair;
  apiUrl?: string;
  fetchJson?: (url: string) => Promise<unknown>;
}): Promise<{ steps: TxRequest[]; author: Address; coin: Address }> {
  const api = (params.apiUrl ?? UBI_API_URL).replace(/\/$/, "");
  const fetchJson =
    params.fetchJson ??
    (async (url: string) => {
      const response = await fetch(url);
      if (!response.ok) throw new FollowError("not_found", `${url} answered ${response.status}`);
      return response.json();
    });
  const id = `${params.note.tx.toLowerCase()}/${params.note.logIndex}`;
  const { note } = (await fetchJson(`${api}/note/${id}`)) as ApiNote;
  const author = note.author.address as Address;
  const coin = note.coin.address as Address;
  const query = new URLSearchParams({ coin, amountUsdc: params.amountUsdc.toString() });
  if (params.follower) query.set("follower", params.follower);
  const check = (await fetchJson(`${api}/note/${id}/followable?${query.toString()}`)) as { followable: boolean; reason?: FollowCheckReason };
  if (!check.followable) {
    throw new FollowError(check.reason ?? "not_found", `This buy cannot follow that note: ${check.reason ?? "not_found"}`);
  }
  if (params.referrer && !isAddressEqual(params.referrer, author)) {
    throw new FollowError("referrer_conflict", `A follow pays the note's author (${author}) as referrer`);
  }
  const details = (await fetchJson(`${api}/coin/${coin}/details`)) as ApiCoin;
  const poolKey = details.poolKey;
  if (!poolKey) throw new FollowError("not_found", `No verified pool key for ${coin}`);
  const hookData = referrerHookData(author);
  const pairToken = details.v3?.pairedToken;
  let route: RouterCall;
  if (pairToken) {
    if (!params.pair || !isAddressEqual(params.pair.token, pairToken as Address)) {
      throw new FollowError("wrong_coin", `${coin} pairs with ${pairToken}: pass that pair`);
    }
    route = goldBuyCall({ pair: params.pair, poolKey, coin, usdcIn: params.amountUsdc, minCoinsOut: params.minCoinsOut, hookData });
  } else {
    route = usdcPoolExactInCall({ poolKey, currencyIn: USDC_ADDRESS, currencyOut: coin, amountIn: params.amountUsdc, minAmountOut: params.minCoinsOut, hookData });
  }
  const trailer = encodeNoteTrailer({
    note: params.ownNote?.note ?? null,
    conf: params.ownNote?.conf ?? null,
    source: NOTE_SOURCE.sdk,
    follow: { tx: params.note.tx, logIndex: params.note.logIndex },
  });
  const call = encodeFunctionData({ abi: routerAbi, functionName: "execute", args: [route.commands, route.inputs, params.deadline] });
  const data = appendTrailer(call, trailer);
  assertFollowCall(data, call, { author, poolKey, coin, note: params.note });
  return {
    author,
    coin,
    steps: [
      { to: USDC_ADDRESS, data: encodeFunctionData({ abi: erc20ApproveAbi, functionName: "approve", args: [PERMIT2, params.amountUsdc] }), value: 0n },
      {
        to: PERMIT2,
        data: encodeFunctionData({ abi: permit2ApproveAbi, functionName: "approve", args: [USDC_ADDRESS, ARC_UNIVERSAL_ROUTER, params.amountUsdc, Number(params.deadline)] }),
        value: 0n,
      },
      { to: ARC_UNIVERSAL_ROUTER, data, value: 0n },
    ],
  };
}

/** Decodes the built router call and checks what a follow needs: author as referrer, the note's pool, the follow ref. */
function assertFollowCall(data: Hex, canonical: Hex, expected: { author: Address; poolKey: V3PoolKey; coin: Address; note: FollowRef }): void {
  const fail = (what: string): never => {
    throw new FollowError("self_check", `follow buy self-check failed: ${what}`);
  };
  if (!data.startsWith(canonical)) fail("calldata prefix");
  const decodedTrailer = decodeNoteTrailer(`0x${data.slice(canonical.length)}` as Hex);
  if (!decodedTrailer.ok || !decodedTrailer.trailer.follow) fail("trailer");
  const follow = decodedTrailer.ok ? decodedTrailer.trailer.follow : null;
  if (!follow || follow.tx !== expected.note.tx.toLowerCase() || follow.logIndex !== expected.note.logIndex) fail("follow ref");
  const { args } = decodeFunctionData({ abi: routerAbi, data: canonical });
  const [commands, inputs] = args as [Hex, readonly Hex[], bigint];
  const v4Index = commands.slice(2).match(/../g)!.indexOf("10");
  if (v4Index < 0) fail("no v4 swap");
  const [actions, actionParams] = decodeAbiParameters(v4SwapInput, inputs[v4Index]!);
  const swapIndex = actions.slice(2).match(/../g)!.indexOf("07");
  if (swapIndex < 0) fail("no exact-input swap");
  const [swap] = decodeAbiParameters(exactInputParams, actionParams[swapIndex]!);
  const hop = swap.path[swap.path.length - 1];
  if (!hop) fail("empty path");
  if (!isAddressEqual(hop!.intermediateCurrency, expected.coin)) fail("output is not the note's coin");
  if (!isAddressEqual(hop!.hooks, expected.poolKey.hooks) || hop!.fee !== expected.poolKey.fee || hop!.tickSpacing !== expected.poolKey.tickSpacing) {
    fail("pool");
  }
  const [referrer] = decodeAbiParameters([{ type: "address" }], hop!.hookData);
  if (!isAddress(referrer) || !isAddressEqual(referrer, expected.author)) fail("referrer");
}
