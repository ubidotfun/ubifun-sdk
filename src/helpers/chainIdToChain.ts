import { Chain, defineChain } from "viem";
import { ARC_MAINNET_CHAIN_ID, ARC_TESTNET_CHAIN_ID } from "../addresses";

/**
 * Arc (Circle) chain definitions for viem. Gas is paid in USDC: msg.value is
 * 18-decimal native USDC while the ERC20 interface at 0x3600... is the same
 * asset at 6 decimals.
 *
 * Arc mainnet is in its private phase: provider endpoints (including this
 * default) reject public traffic until Circle opens access, so pass your own
 * transport url. Once the network opens, public RPCs will be plentiful.
 */
export const arc = defineChain({
  id: ARC_MAINNET_CHAIN_ID,
  name: "Arc",
  nativeCurrency: {
    name: "USD Coin",
    symbol: "USDC",
    decimals: 18,
  },
  rpcUrls: {
    default: {
      http: ["https://rpc.blockdaemon.mainnet.arc.io"],
    },
  },
  blockExplorers: {
    default: {
      name: "Arc Explorer",
      url: "https://explorer.arc.io",
    },
  },
});

export const arcTestnet = defineChain({
  id: ARC_TESTNET_CHAIN_ID,
  name: "Arc Testnet",
  testnet: true,
  nativeCurrency: {
    name: "USD Coin",
    symbol: "USDC",
    decimals: 18,
  },
  rpcUrls: {
    default: {
      http: ["https://arc-testnet.drpc.org", "https://rpc.testnet.arc.network"],
    },
  },
  blockExplorers: {
    default: {
      name: "Arcscan",
      url: "https://testnet.arcscan.app",
    },
  },
});

export const chainIdToChain: {
  [key: number]: Chain;
} = {
  [arc.id]: arc,
  [arcTestnet.id]: arcTestnet,
};
