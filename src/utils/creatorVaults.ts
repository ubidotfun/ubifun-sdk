import { encodeAbiParameters, isAddressEqual, type Address, type Hex } from "viem";

/**
 * Creator vault rules, mirrored from the contracts (and the ubi.fun app):
 * HolderShareFeeCalculator fees are FeeDistributor units (100_00 = 100%),
 * DividendVault shares are SHARE_DENOMINATOR units (100_00 = 100%).
 */
export const VAULT_MIN_FEE = 150;
export const VAULT_MAX_FEE = 500;
export const VAULT_MIN_HOLDER_SHARE = 16_67;
export const VAULT_SHARE_DENOMINATOR = 100_00;
/** The calculator only registers launches whose creator side is 90% or more. */
export const VAULT_MIN_CREATOR_ALLOCATION_PERCENT = 90;
/** DividendVault.MAX_RECIPIENTS is 5, and the creator always takes one of them. */
export const VAULT_MAX_SPLIT_RECEIVERS = 4;

/**
 * `feeCalculatorParams` for a launch WITHOUT a vault: a fee of 0. With no fee
 * calculator set the PositionManager never reads them; the vault calculator
 * refuses them (`FeeOutOfRange(0)`), so a launch without a vault that lands
 * after activation reverts instead of creating a token that can never trade.
 */
export const NO_VAULT_FEE_CALCULATOR_PARAMS: Hex = encodeAbiParameters(
  [{ type: "uint256" }],
  [0n]
);

/** `feeCalculatorParams` registering a vault launch at `fee` (FeeDistributor units). */
export function vaultFeeCalculatorParams(fee: number): Hex {
  return encodeAbiParameters([{ type: "uint256" }], [BigInt(fee)]);
}

/** Basis points of a percent with at most two decimals, at least 1; throws otherwise. */
export function percentToVaultBps(percent: number, label: string): number {
  const bps = Math.round(percent * 100);
  if (!Number.isFinite(percent) || bps < 1 || Math.abs(bps - percent * 100) > 1e-6) {
    throw new Error(
      `${label} must be a positive percent with at most 2 decimals, got ${percent}`
    );
  }
  return bps;
}

/**
 * DividendVault initialize data: `abi.encode(holderShare, recipients, shares)`.
 * Receivers come first and the creator last with the remainder (the vault pays
 * rounding dust to the last recipient), so shares always sum to exactly 100_00.
 */
export function encodeVaultInitializeData(params: {
  holderShare: number;
  receivers: { address: Address; bps: number }[];
  creator: Address;
}): Hex {
  const total = params.receivers.reduce((sum, receiver) => sum + receiver.bps, 0);
  if (total >= VAULT_SHARE_DENOMINATOR) {
    throw new Error("splitReceivers total 100% or more; the creator must keep a share");
  }
  return encodeAbiParameters(
    [{ type: "uint256" }, { type: "address[]" }, { type: "uint256[]" }],
    [
      BigInt(params.holderShare),
      [...params.receivers.map((receiver) => receiver.address), params.creator],
      [
        ...params.receivers.map((receiver) => BigInt(receiver.bps)),
        BigInt(VAULT_SHARE_DENOMINATOR - total),
      ],
    ]
  );
}

/** What a launch must look like under the calculators set on-chain right now. */
export interface LaunchCalculatorState {
  /** The vault calculator is live: every launch must attach its DividendVault. */
  vault: boolean;
  /** `feeCalculatorParams` for a launch without a vault in this state. */
  noVaultParams: Hex;
}

/**
 * Classifies the PositionManager's two calculator slots. The vault flow is live
 * when this SDK knows the vault and calculator and that calculator is the one
 * set. A launch without a vault sends the no-vault marker while no calculator
 * is set or when the SDK cannot place what is set (fail closed), and empty
 * params only beside a calculator that is certainly not the vault one.
 */
export function launchCalculatorState(params: {
  standard: Address;
  fairLaunch: Address;
  vaultCalculator?: Address;
  vaultImplementation?: Address;
  /**
   * TreasuryManagerFactory approval of the vault implementation: the zap only
   * clones an approved one, and would hand the creator NFT to an unapproved
   * implementation itself (no clone, a token that can never trade).
   */
  vaultApproved?: boolean;
}): LaunchCalculatorState {
  const zero = "0x0000000000000000000000000000000000000000";
  const { standard, fairLaunch, vaultCalculator, vaultImplementation, vaultApproved } = params;
  const isZero = (address: Address) => isAddressEqual(address, zero);
  const isOurs = (address: Address) =>
    vaultCalculator !== undefined && isAddressEqual(address, vaultCalculator);
  if (
    vaultImplementation &&
    vaultApproved === true &&
    isOurs(standard) &&
    (isZero(fairLaunch) || isOurs(fairLaunch))
  ) {
    return { vault: true, noVaultParams: NO_VAULT_FEE_CALCULATOR_PARAMS };
  }
  if (
    vaultCalculator &&
    !(isZero(standard) && isZero(fairLaunch)) &&
    !isOurs(standard) &&
    !isOurs(fairLaunch)
  ) {
    return { vault: false, noVaultParams: "0x" };
  }
  return { vault: false, noVaultParams: NO_VAULT_FEE_CALCULATOR_PARAMS };
}
