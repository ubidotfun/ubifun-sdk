import { parseAbi } from "viem";

/** ABIs the v3 helpers use, as the ubi.fun site reads them (apps/web/src/features/ubi/v3.ts). */

const FLAUNCH_PARAMS_V3 =
  "(string name, string symbol, string tokenUri, uint256 premineAmount, address creator, uint24 creatorFeeAllocation, uint256 flaunchAt, bytes initialPriceParams, bytes feeCalculatorParams, address pairedToken)";
const TREASURY_MANAGER_PARAMS = "(address manager, address permissions, bytes initializeData, bytes depositData)";

/** The v3 FlaunchZap (v1.3.3): launch with a manager (with or without a pre-buy) and its quote. */
export const v3FlaunchZapAbi = parseAbi([
  `function flaunch(${FLAUNCH_PARAMS_V3} _flaunchParams, ${TREASURY_MANAGER_PARAMS} _treasuryManagerParams, address _trustedFeeSigner) payable returns (address memecoin_, uint256 ethSpent_, address deployedManager_)`,
  `function flaunch(${FLAUNCH_PARAMS_V3} _flaunchParams, ${TREASURY_MANAGER_PARAMS} _treasuryManagerParams, address _trustedFeeSigner, uint256 _maxPremineCost) payable returns (address memecoin_, uint256 ethSpent_, address deployedManager_)`,
  `function calculateFee(${FLAUNCH_PARAMS_V3} _flaunchParams, uint256 _slippage) view returns (uint256 ethRequired_, uint256 pairedPremineCost_)`,
] as const);

export const v3PositionManagerAbi = parseAbi([
  "function poolKey(address) view returns ((address currency0,address currency1,uint24 fee,int24 tickSpacing,address hooks))",
  `event PoolCreated(bytes32 indexed _poolId, address _memecoin, address _memecoinTreasury, uint256 _tokenId, bool _currencyFlipped, uint256 _flaunchFee, ${FLAUNCH_PARAMS_V3} _params)`,
] as const);

/** PairFeeCalculator views: the registration, the anti-snipe rate now, the bound vault. */
export const pairFeeCalculatorAbi = parseAbi([
  "function dividendVaultImplementation() view returns (address)",
  "function poolConfig(bytes32) view returns (uint16 buyFee, uint16 sellFee, uint128 sizeThreshold, uint16 sizeFee, uint256 tokenId, address memecoin, bool pairIsCurrency0)",
  "function antiSnipe(bytes32) view returns (uint16 fee, uint16 duration, uint64 start, uint256 rateNow)",
] as const);

export const v3TreasuryManagerFactoryAbi = parseAbi([
  "function approvedManagerImplementation(address) view returns (bool)",
  "function managerImplementation(address) view returns (address)",
] as const);

/** The v3 DividendVault: the coin's creator NFT, creator credit and holder dividends source. */
export const v3DividendVaultAbi = parseAbi([
  "function memecoin() view returns (address)",
  "function holderShare() view returns (uint256)",
  "function underwaterShare() view returns (uint256)",
  "function renounced() view returns (bool)",
  "function managerOwner() view returns (address)",
  "function balances(address) view returns (uint256)",
  "function harvest() returns (uint256)",
  "function claim() returns (uint256)",
] as const);

/** The v3 coin's dividend side (MemecoinDividends), paid in the coin's pair token. */
export const v3CoinAbi = parseAbi([
  "function creator() view returns (address)",
  "function withdrawableDividendOf(address) view returns (uint256)",
  "function withdrawDividend() returns (uint256)",
] as const);

/** The pair's USDC Uniswap v3 pool: its token order and price history (for the 30-minute average tick). */
export const uniswapV3PoolAbi = parseAbi([
  "function token0() view returns (address)",
  "function observe(uint32[] secondsAgos) view returns (int56[] tickCumulatives, uint160[] secondsPerLiquidityCumulativeX128s)",
] as const);

/** The pair's price contract (UniswapV3TwapPriceCalculator): USDC raw in, pair raw out, at its TWAP. */
export const pairPriceCalculatorAbi = parseAbi([
  "function ethToPairedToken(uint256 _ethAmount) view returns (uint256 pairedAmount_)",
] as const);

/** Uniswap's v3 QuoterV2 and v4 Quoter, quoted via eth_call. */
export const uniswapV3QuoterAbi = parseAbi([
  "function quoteExactInputSingle((address tokenIn, address tokenOut, uint256 amountIn, uint24 fee, uint160 sqrtPriceLimitX96) params) returns (uint256 amountOut, uint160 sqrtPriceX96After, uint32 initializedTicksCrossed, uint256 gasEstimate)",
  "function quoteExactOutputSingle((address tokenIn, address tokenOut, uint256 amount, uint24 fee, uint160 sqrtPriceLimitX96) params) returns (uint256 amountIn, uint160 sqrtPriceX96After, uint32 initializedTicksCrossed, uint256 gasEstimate)",
] as const);
export const v4QuoterAbi = parseAbi([
  "function quoteExactInputSingle(((address currency0, address currency1, uint24 fee, int24 tickSpacing, address hooks) poolKey, bool zeroForOne, uint128 exactAmount, bytes hookData) params) returns (uint256 amountOut, uint256 gasEstimate)",
] as const);

export const universalRouterAbi = parseAbi([
  "function execute(bytes commands, bytes[] inputs, uint256 deadline) payable",
] as const);

export const permit2Abi = parseAbi([
  "function approve(address token, address spender, uint160 amount, uint48 expiration)",
  "function allowance(address user, address token, address spender) view returns (uint160 amount, uint48 expiration, uint48 nonce)",
] as const);

export const erc20Abi = parseAbi([
  "function balanceOf(address) view returns (uint256)",
  "function allowance(address,address) view returns (uint256)",
  "function approve(address,uint256) returns (bool)",
] as const);
