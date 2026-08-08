import { parseEther } from "viem";

/**
 * Applies a slippage tolerance to an amount.
 *
 * @dev EXACT_OUT adds the slippage, EXACT_IN removes it. `slippage` is a
 * fraction string, e.g. "0.05" for 5%.
 */
export const getAmountWithSlippage = ({
  amount,
  slippage,
  swapType,
}: {
  amount: bigint | undefined;
  slippage: string;
  swapType: "EXACT_IN" | "EXACT_OUT";
}) => {
  if (amount == null) {
    return 0n;
  }

  const absAmount = amount < 0n ? -amount : amount;
  const slippageMultiplier =
    swapType === "EXACT_IN"
      ? BigInt(1e18) - parseEther(slippage)
      : BigInt(1e18) + parseEther(slippage);

  return (absAmount * slippageMultiplier) / BigInt(1e18);
};
