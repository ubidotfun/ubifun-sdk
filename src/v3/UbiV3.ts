import {
  encodeAbiParameters,
  encodeFunctionData,
  keccak256,
  parseEventLogs,
  zeroAddress,
  type Account,
  type Address,
  type Hash,
  type Hex,
  type PublicClient,
  type WalletClient,
} from "viem";
import { QuoterAddress, USDC_ADDRESS } from "../addresses";
import { getSqrtPriceX96FromTick, Q192 } from "../utils/univ4";
import {
  erc20Abi,
  pairFeeCalculatorAbi,
  permit2Abi,
  uniswapV3PoolAbi,
  uniswapV3QuoterAbi,
  universalRouterAbi,
  v3CoinAbi,
  v3DividendVaultAbi,
  v3FlaunchZapAbi,
  v3PositionManagerAbi,
  v3TreasuryManagerFactoryAbi,
  v4QuoterAbi,
} from "./abi";
import {
  goldBuyCall,
  goldSellCall,
  minimumOut,
  minV3HolderShare,
  pairExactOutCall,
  referrerHookData,
  v3FlaunchParams,
  v3PrebuyCap,
  usdToPairRaw,
  v3PremineAmount,
  v3VaultInitializeData,
  type RouterCall,
  type V3FeeSettings,
  type V3PoolKey,
} from "./calldata";
import { ARC_UNIVERSAL_ROUTER, ARC_V3_QUOTER, getV3Deployment, PERMIT2, type V3Deployment, type V3Pair } from "./deployments";

/** The pair price window v3 launches use (the price contracts' 30-minute TWAP). */
const V3_TWAP_WINDOW = 1800;

/** A router trade's deadline and its Permit2 allowance's lifetime. */
const DEADLINE_S = 30n * 60n;
/** A pre-buy's pair buy may cost at most its quote plus 1%. */
const PREBUY_BUY_SLIPPAGE_BPS = 100;

export interface V3Quote {
  /** The pair amount between the two hops */
  pairAmount: bigint;
  amountOut: bigint;
}

export interface V3CoinVault {
  vault: Address;
  holderShare: bigint;
  underwaterShare: bigint;
  renounced: boolean;
  managerOwner: Address;
}

/**
 * ubi.fun v3 coins (paired with gold first): quotes, buys and sells in USDC through the Universal
 * Router (USDC to the pair on its Uniswap v3 pool, the pair to the coin on the coin's v4 pool, in
 * one transaction), launches with a creator vault and an optional pre-buy, and dividends paid in
 * the pair token. Built on viem only; separate from the v2 SDK classes, which are unchanged.
 */
export class ReadUbiV3 {
  readonly publicClient: PublicClient;
  readonly chainId: number;
  readonly deployment: V3Deployment;

  constructor(publicClient: PublicClient) {
    if (!publicClient.chain) {
      throw new Error("publicClient must be configured with a chain");
    }
    this.publicClient = publicClient;
    this.chainId = publicClient.chain.id;
    this.deployment = getV3Deployment(this.chainId);
  }

  /** The pair a pair token address names, from the deployment (gold first). */
  pair(token?: Address): V3Pair {
    const pair = token
      ? this.deployment.pairs.find((entry) => entry.token.toLowerCase() === token.toLowerCase())
      : this.deployment.pairs[0];
    if (!pair) {
      throw new Error(`no v3 pair ${token ?? ""} on chain ${this.chainId}`);
    }
    return pair;
  }

  /** A v3 coin's v4 pool key and its pair. */
  async coinPool(coin: Address): Promise<{ poolKey: V3PoolKey; pair: V3Pair }> {
    const key = await this.publicClient.readContract({
      address: this.deployment.positionManager,
      abi: v3PositionManagerAbi,
      functionName: "poolKey",
      args: [coin],
    });
    if (key.hooks.toLowerCase() !== this.deployment.positionManager.toLowerCase()) {
      throw new Error(`${coin} is not a v3 coin`);
    }
    const pairToken = key.currency0.toLowerCase() === coin.toLowerCase() ? key.currency1 : key.currency0;
    return { poolKey: { ...key, fee: Number(key.fee), tickSpacing: Number(key.tickSpacing) }, pair: this.pair(pairToken) };
  }

  /** What `usdcIn` buys now, through both hops, at the rate of the moment (anti-snipe fee included). */
  async quoteBuy({ coin, usdcIn, referrer }: { coin: Address; usdcIn: bigint; referrer?: Address }): Promise<V3Quote> {
    const { poolKey, pair } = await this.coinPool(coin);
    const pairAmount = await this.quotePairHop({ tokenIn: USDC_ADDRESS, tokenOut: pair.token, fee: pair.usdcPoolFee, amountIn: usdcIn });
    const amountOut = await this.quoteCoinHop({ poolKey, currencyIn: pair.token, amountIn: pairAmount, hookData: referrerHookData(referrer) });
    return { pairAmount, amountOut };
  }

  /** What selling `coinsIn` returns in USDC now, through both hops. */
  async quoteSell({ coin, coinsIn, referrer }: { coin: Address; coinsIn: bigint; referrer?: Address }): Promise<V3Quote> {
    const { poolKey, pair } = await this.coinPool(coin);
    const pairAmount = await this.quoteCoinHop({ poolKey, currencyIn: coin, amountIn: coinsIn, hookData: referrerHookData(referrer) });
    const amountOut = await this.quotePairHop({ tokenIn: pair.token, tokenOut: USDC_ADDRESS, fee: pair.usdcPoolFee, amountIn: pairAmount });
    return { pairAmount, amountOut };
  }

  /**
   * A v3 coin's creator vault: the holder of its creator NFT, confirmed as a clone of the v3
   * vault implementation (the factory's record) that holds this coin.
   */
  async coinVault(coin: Address): Promise<V3CoinVault> {
    const holder = await this.publicClient.readContract({ address: coin, abi: v3CoinAbi, functionName: "creator" });
    const [implementation, memecoin] = await Promise.all([
      this.publicClient.readContract({
        address: this.deployment.treasuryManagerFactory,
        abi: v3TreasuryManagerFactoryAbi,
        functionName: "managerImplementation",
        args: [holder],
      }),
      this.publicClient.readContract({ address: holder, abi: v3DividendVaultAbi, functionName: "memecoin" }),
    ]);
    if (
      implementation.toLowerCase() !== this.deployment.dividendVault.toLowerCase() ||
      memecoin.toLowerCase() !== coin.toLowerCase()
    ) {
      throw new Error(`${coin} has no v3 creator vault`);
    }
    const [holderShare, underwaterShare, renounced, managerOwner] = await Promise.all([
      this.publicClient.readContract({ address: holder, abi: v3DividendVaultAbi, functionName: "holderShare" }),
      this.publicClient.readContract({ address: holder, abi: v3DividendVaultAbi, functionName: "underwaterShare" }),
      this.publicClient.readContract({ address: holder, abi: v3DividendVaultAbi, functionName: "renounced" }),
      this.publicClient.readContract({ address: holder, abi: v3DividendVaultAbi, functionName: "managerOwner" }),
    ]);
    return { vault: holder, holderShare, underwaterShare, renounced, managerOwner };
  }

  /** A holder's withdrawable dividends on a v3 coin, in the pair token's raw units. */
  dividendsOf(coin: Address, holder: Address): Promise<bigint> {
    return this.publicClient.readContract({ address: coin, abi: v3CoinAbi, functionName: "withdrawableDividendOf", args: [holder] });
  }

  /** The rate a buy pays on a v3 coin now (FeeDistributor units), anti-snipe fee included, before any large-trade fee. */
  async buyRateNow(coin: Address): Promise<number> {
    const { poolKey } = await this.coinPool(coin);
    const poolId = this.poolId(poolKey);
    const [config, antiSnipe] = await Promise.all([
      this.publicClient.readContract({ address: this.deployment.feeCalculator, abi: pairFeeCalculatorAbi, functionName: "poolConfig", args: [poolId] }),
      this.publicClient.readContract({ address: this.deployment.feeCalculator, abi: pairFeeCalculatorAbi, functionName: "antiSnipe", args: [poolId] }),
    ]);
    return Math.max(Number(config[0]), Number(antiSnipe[3]));
  }

  /**
   * The large-trade fee's threshold for a USD size, as the site computes it: the pair's USDC pool's
   * 30-minute average tick (truncated, as Solidity), the USDC amount converted at that price and
   * rounded up. Fixed at launch in the pair's units.
   */
  async sizeThreshold({ usd, pair }: { usd: number; pair?: V3Pair }): Promise<bigint> {
    if (!Number.isFinite(usd) || usd <= 0) {
      throw new Error("the size must be a positive USD amount");
    }
    const p = pair ?? this.pair();
    const [token0, [cumulatives]] = await Promise.all([
      this.publicClient.readContract({ address: p.usdcPool, abi: uniswapV3PoolAbi, functionName: "token0" }),
      this.publicClient.readContract({ address: p.usdcPool, abi: uniswapV3PoolAbi, functionName: "observe", args: [[V3_TWAP_WINDOW, 0]] }),
    ]);
    const tick = Number((cumulatives[1]! - cumulatives[0]!) / BigInt(V3_TWAP_WINDOW));
    const sqrtPriceX96 = getSqrtPriceX96FromTick(tick);
    const squared = sqrtPriceX96 * sqrtPriceX96;
    const pairIsToken0 = token0.toLowerCase() === p.token.toLowerCase();
    const threshold = usdToPairRaw(usd, pairIsToken0 ? { num: squared, den: Q192 } : { num: Q192, den: squared });
    if (threshold <= 0n || threshold >= 2n ** 128n) {
      throw new Error("the size converts outside the large-trade fee's range");
    }
    return threshold;
  }

  private poolId(poolKey: V3PoolKey): Hex {
    return keccak256(
      encodeAbiParameters(
        [{ type: "address" }, { type: "address" }, { type: "uint24" }, { type: "int24" }, { type: "address" }],
        [poolKey.currency0, poolKey.currency1, poolKey.fee, poolKey.tickSpacing, poolKey.hooks]
      )
    );
  }

  private async quotePairHop(params: { tokenIn: Address; tokenOut: Address; fee: number; amountIn: bigint }): Promise<bigint> {
    const { result } = await this.publicClient.simulateContract({
      address: ARC_V3_QUOTER,
      abi: uniswapV3QuoterAbi,
      functionName: "quoteExactInputSingle",
      args: [{ ...params, sqrtPriceLimitX96: 0n }],
    });
    return result[0];
  }

  private async quoteCoinHop(params: { poolKey: V3PoolKey; currencyIn: Address; amountIn: bigint; hookData: Hex }): Promise<bigint> {
    const quoter = QuoterAddress[this.chainId];
    if (!quoter) {
      throw new Error(`no v4 quoter on chain ${this.chainId}`);
    }
    const { result } = await this.publicClient.simulateContract({
      address: quoter,
      abi: v4QuoterAbi,
      functionName: "quoteExactInputSingle",
      args: [
        {
          poolKey: params.poolKey,
          zeroForOne: params.currencyIn.toLowerCase() === params.poolKey.currency0.toLowerCase(),
          exactAmount: params.amountIn,
          hookData: params.hookData,
        },
      ],
    });
    return result[0];
  }
}

export interface V3LaunchParams {
  name: string;
  symbol: string;
  /** The coin's metadata URI (ipfs://...) */
  tokenUri: string;
  /** Starting market cap in USD, e.g. "10000" */
  marketCapUsd: string;
  /** The creator side of the creator stream, whole percent; the rest is the buyback (at most 83%) */
  creatorFeePercent: number;
  /** Holders' share of what the vault receives (100_00 = 100%), at least {@link minV3HolderShare} */
  holderShare: number;
  /** Other creator wallets and their shares of the creator part (bps); the launcher takes the rest */
  others?: { recipient: Address; bps: number }[];
  /** Rates; `sizeThreshold` in the pair's raw units (see {@link ReadUbiV3.sizeThreshold}) */
  fees: V3FeeSettings;
  /** Pre-buy, % of the supply (0 or unset: none). Paid in the pair, which the wallet must hold. */
  prebuyPercent?: number;
  /** An Underwater pot (unset: none): share of what the vault receives (bps; holderShare + share <= 100_00) and the minimum holding in whole coins (1,000 to 5,000,000) */
  underwater?: { share: number; minHolding: number };
  /** Unix seconds trading opens; 0 or unset = at launch */
  flaunchAt?: number;
  pair?: V3Pair;
}

/** The write side: every transaction is sent from, and bound to, the wallet client's account. */
export class ReadWriteUbiV3 extends ReadUbiV3 {
  readonly walletClient: WalletClient;
  readonly account: Account;

  constructor(publicClient: PublicClient, walletClient: WalletClient) {
    super(publicClient);
    if (!walletClient.account) {
      throw new Error("walletClient must have an account");
    }
    // Every write goes to the public client's chain (Arc): a wallet client on another one is refused
    if (walletClient.chain && walletClient.chain.id !== this.chainId) {
      throw new Error(`walletClient is on chain ${walletClient.chain.id}, publicClient on ${this.chainId}`);
    }
    this.walletClient = walletClient;
    this.account = walletClient.account;
  }

  /** Buys a v3 coin with exactly `usdcIn` USDC; at least the quote less `slippageBps` comes out. */
  async buy({ coin, usdcIn, slippageBps, referrer }: { coin: Address; usdcIn: bigint; slippageBps: number; referrer?: Address }): Promise<Hash> {
    const { poolKey, pair } = await this.coinPool(coin);
    const quote = await this.quoteBuy({ coin, usdcIn, referrer });
    const minCoinsOut = minimumOut(quote.amountOut, slippageBps);
    if (minCoinsOut <= 0n) {
      throw new Error("the quote is too small to trade");
    }
    const route = goldBuyCall({ pair, poolKey, coin, usdcIn, minCoinsOut, hookData: referrerHookData(referrer) });
    return this.routerTrade({ token: USDC_ADDRESS, amount: usdcIn, route });
  }

  /** Sells exactly `coinsIn` of a v3 coin for USDC; at least the quote less `slippageBps` comes out. */
  async sell({ coin, coinsIn, slippageBps, referrer }: { coin: Address; coinsIn: bigint; slippageBps: number; referrer?: Address }): Promise<Hash> {
    const { poolKey, pair } = await this.coinPool(coin);
    const quote = await this.quoteSell({ coin, coinsIn, referrer });
    const minUsdcOut = minimumOut(quote.amountOut, slippageBps);
    if (minUsdcOut <= 0n) {
      throw new Error("the quote is too small to trade");
    }
    const route = goldSellCall({ pair, poolKey, coin, coinsIn, minUsdcOut, hookData: referrerHookData(referrer) });
    return this.routerTrade({ token: coin, amount: coinsIn, route });
  }

  /**
   * Buys exactly `pairOut` of the pair with USDC, at most its quote plus 1% (for a pre-buy, or
   * anything else paid in the pair).
   */
  async buyPair({ pairOut, pair }: { pairOut: bigint; pair?: V3Pair }): Promise<Hash> {
    const target = pair ?? this.pair();
    const { result } = await this.publicClient.simulateContract({
      address: ARC_V3_QUOTER,
      abi: uniswapV3QuoterAbi,
      functionName: "quoteExactOutputSingle",
      args: [{ tokenIn: USDC_ADDRESS, tokenOut: target.token, amount: pairOut, fee: target.usdcPoolFee, sqrtPriceLimitX96: 0n }],
    });
    const maxUsdcIn = (result[0] * BigInt(10_000 + PREBUY_BUY_SLIPPAGE_BPS) + 9_999n) / 10_000n;
    return this.routerTrade({ token: USDC_ADDRESS, amount: maxUsdcIn, route: pairExactOutCall({ pair: target, pairOut, maxUsdcIn }) });
  }

  /**
   * Launches a v3 coin with its creator vault, the launching account as the last creator wallet.
   * With a pre-buy, the wallet must already hold its cost in the pair (see {@link buyPair} and
   * {@link prebuyCost}); this approves the zap for exactly the cap, and the zap refunds what is unspent.
   */
  async launch(params: V3LaunchParams): Promise<{ hash: Hash; coin: Address }> {
    const pair = params.pair ?? this.pair();
    const creatorFeeAllocation = params.creatorFeePercent * 100;
    if (params.holderShare < minV3HolderShare(creatorFeeAllocation)) {
      throw new Error(`holder share must be at least ${minV3HolderShare(creatorFeeAllocation)} for this creator side`);
    }
    const prebuyPercent = params.prebuyPercent ?? 0;
    const premineAmount = v3PremineAmount(prebuyPercent);
    const flaunchParams = v3FlaunchParams({
      name: params.name,
      symbol: params.symbol,
      tokenUri: params.tokenUri,
      creator: this.account.address,
      creatorFeePercent: params.creatorFeePercent,
      flaunchAt: params.flaunchAt ?? 0,
      marketCapUsd: params.marketCapUsd,
      fees: params.fees,
      pair,
      premineAmount,
    });
    const [value, premineQuote] = await this.publicClient.readContract({
      address: this.deployment.flaunchZap,
      abi: v3FlaunchZapAbi,
      functionName: "calculateFee",
      args: [flaunchParams, 0n],
    });
    const managerParams = {
      manager: this.deployment.dividendVault,
      permissions: zeroAddress,
      initializeData: v3VaultInitializeData({ holderShare: params.holderShare, others: params.others ?? [], launcher: this.account.address, underwater: params.underwater }),
      depositData: "0x" as const,
    };
    // The vault must be the one the calculator binds and the factory approves: otherwise the zap
    // hands the creator NFT to the implementation itself and the coin can never trade
    const [approved, boundVault] = await Promise.all([
      this.publicClient.readContract({
        address: this.deployment.treasuryManagerFactory,
        abi: v3TreasuryManagerFactoryAbi,
        functionName: "approvedManagerImplementation",
        args: [this.deployment.dividendVault],
      }),
      this.publicClient.readContract({ address: this.deployment.feeCalculator, abi: pairFeeCalculatorAbi, functionName: "dividendVaultImplementation" }),
    ]);
    if (!approved || boundVault.toLowerCase() !== this.deployment.dividendVault.toLowerCase()) {
      throw new Error("the v3 vault implementation is not approved and bound; launching now would strand the creator NFT");
    }
    const checkManager = (deployedManager: Address) => {
      if (deployedManager === zeroAddress || deployedManager.toLowerCase() === this.deployment.dividendVault.toLowerCase()) {
        throw new Error("the simulated launch does not deposit the creator NFT into a fresh vault");
      }
    };
    let sent: Hash;
    if (premineAmount > 0n) {
      const maxPremineCost = v3PrebuyCap(premineQuote, prebuyPercent);
      const balance = await this.publicClient.readContract({ address: pair.token, abi: erc20Abi, functionName: "balanceOf", args: [this.account.address] });
      if (balance < maxPremineCost) {
        throw new Error(`the pre-buy needs ${maxPremineCost} of ${pair.symbol} (raw) in the wallet; it holds ${balance}`);
      }
      await this.ensureAllowance({ token: pair.token, spender: this.deployment.flaunchZap, amount: maxPremineCost });
      const { request, result } = await this.publicClient.simulateContract({
        account: this.account,
        address: this.deployment.flaunchZap,
        abi: v3FlaunchZapAbi,
        functionName: "flaunch",
        args: [flaunchParams, managerParams, zeroAddress, maxPremineCost],
        value,
      });
      checkManager(result[2]);
      sent = await this.walletClient.writeContract({ ...request, chain: this.publicClient.chain });
    } else {
      const { request, result } = await this.publicClient.simulateContract({
        account: this.account,
        address: this.deployment.flaunchZap,
        abi: v3FlaunchZapAbi,
        functionName: "flaunch",
        args: [flaunchParams, managerParams, zeroAddress],
        value,
      });
      checkManager(result[2]);
      sent = await this.walletClient.writeContract({ ...request, chain: this.publicClient.chain });
    }
    const receipt = await this.confirmed(sent);
    const hash = receipt.transactionHash;
    const created = parseEventLogs({ abi: v3PositionManagerAbi, eventName: "PoolCreated", logs: receipt.logs }).find(
      (log) => log.address.toLowerCase() === this.deployment.positionManager.toLowerCase()
    );
    if (!created) {
      throw new Error(`launch ${hash} has no PoolCreated`);
    }
    return { hash, coin: created.args._memecoin };
  }

  /** The most a pre-buy of `percent`% may pull, in the pair's raw units, for these launch settings. */
  async prebuyCost(params: Omit<V3LaunchParams, "prebuyPercent"> & { prebuyPercent: number }): Promise<bigint> {
    const pair = params.pair ?? this.pair();
    const [, quote] = await this.publicClient.readContract({
      address: this.deployment.flaunchZap,
      abi: v3FlaunchZapAbi,
      functionName: "calculateFee",
      args: [
        v3FlaunchParams({
          name: params.name,
          symbol: params.symbol,
          tokenUri: params.tokenUri,
          creator: this.account.address,
          creatorFeePercent: params.creatorFeePercent,
          flaunchAt: params.flaunchAt ?? 0,
          marketCapUsd: params.marketCapUsd,
          fees: params.fees,
          pair,
          premineAmount: v3PremineAmount(params.prebuyPercent),
        }),
        0n,
      ],
    });
    return v3PrebuyCap(quote, params.prebuyPercent);
  }

  /** Withdraws the account's dividends on a v3 coin (paid in the pair token). */
  async withdrawDividends(coin: Address): Promise<Hash> {
    return this.send({ address: coin, data: encodeFunctionData({ abi: v3CoinAbi, functionName: "withdrawDividend" }) });
  }

  /** Harvests a v3 coin's fees into its vault (anyone may). */
  async harvest(coin: Address): Promise<Hash> {
    const { vault } = await this.coinVault(coin);
    return this.send({ address: vault, data: encodeFunctionData({ abi: v3DividendVaultAbi, functionName: "harvest" }) });
  }

  /** Claims the account's creator credit from a v3 coin's vault. */
  async claimCreator(coin: Address): Promise<Hash> {
    const { vault } = await this.coinVault(coin);
    return this.send({ address: vault, data: encodeFunctionData({ abi: v3DividendVaultAbi, functionName: "claim" }) });
  }

  /** Exact-amount approval to Permit2 and the Permit2 allowance for the router, then the trade. */
  private async routerTrade({ token, amount, route }: { token: Address; amount: bigint; route: RouterCall }): Promise<Hash> {
    const owner = this.account.address;
    const balance = await this.publicClient.readContract({ address: token, abi: erc20Abi, functionName: "balanceOf", args: [owner] });
    if (balance < amount) {
      throw new Error(`insufficient balance of ${token}: ${balance} < ${amount}`);
    }
    await this.ensureAllowance({ token, spender: PERMIT2, amount });
    const block = await this.publicClient.getBlock();
    const deadline = block.timestamp + DEADLINE_S;
    const [permitAmount, permitExpiration] = await this.publicClient.readContract({
      address: PERMIT2,
      abi: permit2Abi,
      functionName: "allowance",
      args: [owner, token, ARC_UNIVERSAL_ROUTER],
    });
    if (permitAmount < amount || BigInt(permitExpiration) < deadline) {
      await this.send({
        address: PERMIT2,
        data: encodeFunctionData({ abi: permit2Abi, functionName: "approve", args: [token, ARC_UNIVERSAL_ROUTER, amount, Number(deadline)] }),
      });
    }
    return this.send({
      address: ARC_UNIVERSAL_ROUTER,
      data: encodeFunctionData({ abi: universalRouterAbi, functionName: "execute", args: [route.commands, route.inputs, deadline] }),
    });
  }

  private async ensureAllowance({ token, spender, amount }: { token: Address; spender: Address; amount: bigint }): Promise<void> {
    const allowance = await this.publicClient.readContract({
      address: token,
      abi: erc20Abi,
      functionName: "allowance",
      args: [this.account.address, spender],
    });
    if (allowance < amount) {
      await this.send({ address: token, data: encodeFunctionData({ abi: erc20Abi, functionName: "approve", args: [spender, amount] }) });
    }
  }

  /** Simulates, sends from the account on the public client's chain, and waits for it to land. */
  private async send({ address, data }: { address: Address; data: Hex }): Promise<Hash> {
    await this.publicClient.call({ account: this.account, to: address, data });
    const hash = await this.walletClient.sendTransaction({ account: this.account, chain: this.publicClient.chain, to: address, data });
    return (await this.confirmed(hash)).transactionHash;
  }

  /**
   * The receipt of the transaction that ran: a gas bump (repriced) lands under a new hash and is
   * returned as such; a cancellation or a different transaction under the same nonce means the
   * requested one never ran, and throws, as does a revert.
   */
  private async confirmed(hash: Hash) {
    let replaced: string | undefined;
    const receipt = await this.publicClient.waitForTransactionReceipt({
      hash,
      onReplaced: ({ reason }) => {
        replaced = reason;
      },
    });
    if (replaced !== undefined && replaced !== "repriced") {
      throw new Error(`transaction ${hash} was ${replaced} in the wallet and did not run`);
    }
    if (receipt.status !== "success") {
      throw new Error(`transaction ${receipt.transactionHash} reverted`);
    }
    return receipt;
  }
}

/** A v3 SDK instance: read-only with a public client, read-write with a wallet client too. */
export function createUbiV3(params: { publicClient: PublicClient; walletClient: WalletClient }): ReadWriteUbiV3;
export function createUbiV3(params: { publicClient: PublicClient }): ReadUbiV3;
export function createUbiV3({ publicClient, walletClient }: { publicClient: PublicClient; walletClient?: WalletClient }) {
  return walletClient ? new ReadWriteUbiV3(publicClient, walletClient) : new ReadUbiV3(publicClient);
}
