import {
  type ReadContract,
  type ReadWriteContract,
  type ReadWriteAdapter,
  type Address,
  type Drift,
  createDrift,
} from "@delvtech/drift";
import { keccak256, stringToBytes, type Hex } from "viem";
import { XHandleClaimsAbi } from "../abi/XHandleClaims";

export type XHandleClaimsABI = typeof XHandleClaimsAbi;

/** Allowed X handle shape, with or without the leading @. */
export const HANDLE_RE = /^@?[A-Za-z0-9_]{1,15}$/;

/** Lowercase, no leading @. The canonical form links and hashes use. */
export function normalizeHandle(handle: string): string {
  return handle.trim().replace(/^@/, "").toLowerCase();
}

/**
 * keccak256 of the normalized handle: the on-chain key of the XHandleClaims
 * registry. Must match the app and backend (it does; same normalization).
 * Throws on anything outside HANDLE_RE: the OAuth backend only attests real X
 * usernames, so an escrow derived from an invalid handle could never be bound
 * and any revenue routed to it would be stuck forever.
 */
export function handleHashOf(handle: string): Hex {
  const trimmed = handle.trim();
  if (!HANDLE_RE.test(trimmed)) {
    throw new Error(
      `Invalid X handle "${handle}": expected 1-15 letters, digits or ` +
        `underscores, with an optional leading @`
    );
  }
  return keccak256(stringToBytes(normalizeHandle(trimmed)));
}

/**
 * Client for the XHandleClaims registry: launches can route earnings-split
 * shares to an X handle instead of an address. Each handle maps to a
 * deterministic CREATE2 escrow (predictable before deployment, so it can be a
 * split recipient at launch). The handle's owner proves control through the
 * ubi.fun X OAuth flow, which returns an attestation signature for `bind`;
 * after binding, `claim` pulls the escrowed USDC to the bound wallet.
 */
export class ReadXHandleClaims {
  public readonly contract: ReadContract<XHandleClaimsABI>;

  constructor(address: Address, drift: Drift = createDrift()) {
    if (!address) {
      throw new Error("Address is required");
    }

    this.contract = drift.contract({
      abi: XHandleClaimsAbi,
      address,
    });
  }

  /**
   * The deterministic escrow address for a handle, valid before the escrow is
   * deployed. Use this as a split recipient at launch time.
   */
  escrowAddress(handle: string) {
    return this.contract.read("escrowAddress", {
      _handleHash: handleHashOf(handle),
    });
  }

  /** The wallet a handle is bound to (zero address if unbound). */
  boundWallet(handle: string) {
    return this.contract.read("walletOf", {
      _handleHash: handleHashOf(handle),
    });
  }

  /** The current bind nonce for a handle (increments on each re-bind). */
  bindNonce(handle: string) {
    return this.contract.read("bindNonce", {
      _handleHash: handleHashOf(handle),
    });
  }
}

export class ReadWriteXHandleClaims extends ReadXHandleClaims {
  declare contract: ReadWriteContract<XHandleClaimsABI>;

  constructor(
    address: Address,
    drift: Drift<ReadWriteAdapter> = createDrift()
  ) {
    super(address, drift);
  }

  /**
   * Binds a handle to a wallet using the attestation from the ubi.fun X OAuth
   * flow (GET /auth/x/start on the API starts it; the callback returns this
   * signature). Anyone can submit the bind once signed.
   */
  bind(params: {
    handle: string;
    wallet: Address;
    deadline: bigint;
    signature: Hex;
  }) {
    return this.contract.write("bind", {
      _handleHash: handleHashOf(params.handle),
      _wallet: params.wallet,
      _deadline: params.deadline,
      _signature: params.signature,
    });
  }

  /**
   * Claims a bound handle's share out of a launch's split manager and forwards
   * it to the bound wallet as USDC.
   * @param handle - The X handle
   * @param manager - The AddressFeeSplitManager instance holding the share
   */
  claim(handle: string, manager: Address) {
    return this.contract.write("claim", {
      _handleHash: handleHashOf(handle),
      _manager: manager,
    });
  }

  /**
   * Sweeps a token balance sitting directly on the handle's escrow (e.g. USDC
   * sent to it outside a split manager) to the bound wallet.
   */
  sweep(handle: string, token: Address) {
    return this.contract.write("sweep", {
      _handleHash: handleHashOf(handle),
      _token: token,
    });
  }
}
