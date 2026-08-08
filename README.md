# ubi.fun SDK

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

A TypeScript SDK for the [ubi.fun](https://ubi.fun) protocol on [Arc](https://www.arc.network) (Circle's chain): launch coins, trade their Uniswap v4 USDC pools, and claim creator, referral, split, X-handle, and daily holder rewards.

Derived from the [Flaunch SDK](https://github.com/flayerlabs/flaunch-sdk) and reworked for the ubi.fun v5 contracts, where the cash asset is native USDC (6 decimals) rather than flETH.

## Features

- 🚀 Launch memecoins through FlaunchZap, the same one-transaction entry point the app uses
- 💱 Buy and sell coins through PoolSwap with a referrer address that earns you 5% of the swap fee
- 📊 Quotes from the V4Quoter, pool/tick reads, fair launch and bid wall positions
- 💰 Claims for every revenue leg: creator revenue, referral rewards, earnings splits, X-handle shares, and the daily USDC holder pool
- 🔗 Works on Arc mainnet (5042) and Arc testnet (5042002)

Protocol docs: [ubi.fun/docs/integrate](https://ubi.fun/docs/integrate/overview). If you are building an AI agent, the hosted MCP server at `https://api.ubi.fun/mcp` exposes the same surface without keys.

## Installation

```bash
pnpm add @ubi.fun/sdk
# or: npm install @ubi.fun/sdk
```

## Quick Start

```ts
import { createUbiSDK, arc } from "@ubi.fun/sdk";
import { createPublicClient, http } from "viem";

const publicClient = createPublicClient({
  chain: arc,
  transport: http("<ARC_RPC_URL>"),
});

const sdkRead = createUbiSDK({ publicClient });

const { symbol, name, image } = await sdkRead.getCoinMetadata(coinAddress);
const price = await sdkRead.coinPriceInUSDC(coinAddress);
const marketCap = await sdkRead.coinMarketCapInUSDC(coinAddress);
```

Amounts follow the chain: **USDC is 6 decimals, every coin is 18 decimals**. One Arc quirk to know: `msg.value` is the same USDC at 18 decimals; the SDK computes any required transaction value for you.

### Write operations (Viem + Wagmi)

```ts
import { createUbiSDK, ReadWriteUbiSDK } from "@ubi.fun/sdk";
import { useWalletClient } from "wagmi";
import { useMemo } from "react";

const { data: walletClient } = useWalletClient();

const sdkWrite = useMemo(() => {
  if (!publicClient || !walletClient) return null;

  return createUbiSDK({
    publicClient,
    walletClient,
  }) as ReadWriteUbiSDK;
}, [publicClient, walletClient]);
```

## Launching a coin

Launches at the minimum $10,000 initial market cap are currently fee-free (gas only). Fair launch is optional: the chosen percent of supply sells at a fixed price for the chosen duration before normal trading starts.

```ts
const hash = await sdkWrite.createUBIIPFS({
  name: "Test",
  symbol: "TEST",
  fairLaunchPercent: 40,
  fairLaunchDuration: 30 * 60, // seconds
  initialMarketCapUSD: 10_000,
  creator: address, // receives the Flaunch NFT = the revenue claim
  creatorFeeAllocationPercent: 90, // creator vs floor-bid split, app default 90
  metadata: {
    base64Image: imageData,
    description: "Your memecoin description",
    // optional: websiteUrl, discordUrl, twitterUrl, telegramUrl
  },
});

// parse the receipt for the coin address and NFT tokenId
const poolCreated = await sdkRead.getPoolCreatedFromTx(hash);
if (poolCreated) {
  console.log("Coin:", poolCreated.memecoin, "tokenId:", poolCreated.tokenId);
}
```

`createUBIIPFS` pins the image and metadata through the ubi.fun API (IP rate limited, 5MB image cap).

To host metadata yourself, on any provider or your own storage, skip the IPFS helpers entirely: upload however you like, then pass the resulting URI to `createUBI({ tokenUri, ... })`. That is the provider neutral route and it keeps any storage credentials on your side rather than in the browser.

```ts
const tokenUri = await yourUploader(image, metadata); // ipfs://..., https://..., anything
const hash = await sdk.createUBI({ name, symbol, tokenUri, creator, ... });
```

### Earnings splits (and X handles)

Route parts of the creator revenue to other addresses, fixed at launch. The creator automatically keeps the exact remainder. A recipient can be the escrow of an X handle that has not even claimed yet:

```ts
const escrow = await sdkRead.readXHandleClaims.escrowAddress("@friend");

await sdkWrite.createUBIIPFSWithSplitManager({
  // ...same launch params as above...
  splitReceivers: [
    { address: "0x123...", percent: 30 },
    { address: escrow, percent: 10 }, // @friend claims after verifying on ubi.fun
  ],
});
```

Note: split launches deposit the revenue NFT into the split manager escrow, so "the NFT stays in your wallet" only holds for non-split launches.

## Trading

Approve the input token to PoolSwap once (USDC for buys, the coin for sells), then swap. **Always pass your address as `referrer`: 5% of the swap fee accrues to it on-chain.**

```ts
import { USDC_ADDRESS } from "@ubi.fun/sdk";
import { parseUnits, parseEther } from "viem";

// buy with 100 USDC
const amountIn = parseUnits("100", 6);
if ((await sdkWrite.swapAllowance(USDC_ADDRESS)) < amountIn) {
  await sdkWrite.approveSwapInput(USDC_ADDRESS, amountIn);
}
const hash = await sdkWrite.buyCoin({
  coinAddress,
  amountIn,
  slippagePercent: 5,
  referrer: myAddress,
});

// sell 1M coins
const sellIn = parseEther("1000000");
if ((await sdkWrite.swapAllowance(coinAddress)) < sellIn) {
  await sdkWrite.approveSwapInput(coinAddress, sellIn);
}
await sdkWrite.sellCoin({
  coinAddress,
  amountIn: sellIn,
  slippagePercent: 5,
  referrer: myAddress,
});
```

### Quotes

Use the same referrer in the quote and the swap, or they will not match:

```ts
const coinsOut = await sdkRead.getBuyQuoteExactInput({
  coinAddress,
  amountIn: parseUnits("100", 6), // USDC in
  referrer: myAddress,
});

const usdcOut = await sdkRead.getSellQuoteExactInput({
  coinAddress,
  amountIn: parseEther("1000000"), // coins in
  referrer: myAddress,
});
```

## Claims

Everything pays out in USDC.

```ts
// creator revenue (accrues in the FeeEscrow, follows the Flaunch NFT)
const balance = await sdkRead.creatorRevenue(myAddress);
await sdkWrite.withdrawCreatorRevenue();

// referral rewards (accrue in the OUTPUT token of each swap you routed:
// buys accrue the coin, sells accrue USDC)
const owed = await sdkRead.referralBalance(myAddress, USDC_ADDRESS);
await sdkWrite.claimReferralBalance([USDC_ADDRESS, coinAddress], myAddress);

// earnings-split share (managerAddress from the launch's deployedManager)
const share = await sdkRead.splitBalance(managerAddress, myAddress);
await sdkWrite.claimSplitEarnings(managerAddress);

// daily holder pool (24% of every swap fee, split across coin holders daily;
// entitlement + Merkle proof come from the ubi.fun API)
const { claimable } = await sdkRead.claimableUbi(myAddress);
if (claimable > 0n) {
  await sdkWrite.claimUbi();
}

// X-handle share: after verifying the handle through the ubi.fun OAuth flow
// (which submits the on-chain bind), pull the share to the bound wallet
await sdkWrite.readWriteXHandleClaims.claim("@myhandle", managerAddress);
```

## Watching events

```ts
const { cleanup } = await sdkRead.watchPoolCreated({
  onPoolCreated: ({ logs }) => console.log(logs),
});

const swaps = await sdkRead.watchPoolSwap({
  onPoolSwap: ({ logs }) => console.log(logs), // typed BUY/SELL with USDC/coin deltas
  filterByCoin: coinAddress,
});
```

React hooks are available from the `hooks` subpath:

```tsx
import { usePoolCreatedEvents, usePoolSwapEvents } from "@ubi.fun/sdk/hooks";

const { logs: poolCreatedLogs } = usePoolCreatedEvents(sdkRead);
const { logs: poolSwapLogs } = usePoolSwapEvents(sdkRead, coinAddress);
```

## `createUBICalldata`: calldata instead of broadcasting

For custom signers, account abstraction, or batching, `createUBICalldata` returns `{ to, value, data }` call objects instead of sending transactions:

```ts
import { createUBICalldata, parseCall } from "@ubi.fun/sdk";

const sdkCalldata = createUBICalldata({ publicClient, walletAddress });

const call = await parseCall(() =>
  sdkCalldata.buyCoin({ coinAddress, amountIn, referrer })
);
// call.to, call.value, call.data
```

## Fetching coin metadata from a server

`getCoinMetadata`, `getCoinMetadataFromTokenId`, and `getCoinMetadataFromTokenIds` fetch a coin's `tokenURI` over HTTP. The SDK applies a 15 second timeout, a 3 redirect cap, a 5MB response cap, and rejects non HTTP(S) protocols.

A coin's `tokenURI` is arbitrary onchain data that anyone can set when launching. In the browser this is harmless because requests are CORS and sandbox gated. On a server it is not: the URL can point at private or link local addresses that your server can reach, which is a server side request forgery risk.

If you call these methods from a server against coins you do not control, put the fetch behind your own egress policy. Two options:

```ts
// 1. Point the resolver at a gateway or proxy you control
sdkRead.setIPFSResolver((value) =>
  value.startsWith("ipfs://")
    ? `https://your-gateway.example/ipfs/${value.slice(7)}`
    : value
);

// 2. Or read the tokenURI yourself and fetch it under your own policy
import { MemecoinAbi } from "@ubi.fun/sdk/abi";

const tokenURI = await publicClient.readContract({
  address: coinAddress,
  abi: MemecoinAbi,
  functionName: "tokenURI",
});
const metadata = await yourVettedFetch(tokenURI);
```

For untrusted input, validate the resolved address against your blocklist before connecting, or route the request through a proxy restricted to public destinations.

## Naming: ubi vs Flaunch

The protocol is a fork of [Flaunch](https://flaunch.gg), and the deployed contracts keep the upstream names (`FlaunchPositionManager`, `Flaunched` events, and so on). The SDK therefore exposes both: the branded names used in this README (`createUbiSDK`, `ReadUbiSDK`, `ReadWriteUbiSDK`, `createUBI*`, `createUBICalldata`) and the upstream originals (`createFlaunch`, `ReadFlaunchSDK`, `ReadWriteFlaunchSDK`, `flaunch*`, `createFlaunchCalldata`). Each pair is the same object, so use whichever matches your mental model; the Flaunch names line up 1:1 with what you see on the block explorer.

## All SDK functions

For a list of all the functions in the SDK, refer to: [FlaunchSDK.ts](./src/sdk/FlaunchSDK.ts)

## Reference

- Protocol docs: [ubi.fun/docs](https://ubi.fun/docs/integrate/overview)
- Contract addresses ship in [`src/addresses.ts`](./src/addresses.ts) for Arc mainnet (5042) and testnet (5042002)
- REST data API: [ubi.fun/docs/integrate/api](https://ubi.fun/docs/integrate/api)
- MCP server for agents: [ubi.fun/docs/integrate/agents](https://ubi.fun/docs/integrate/agents)
