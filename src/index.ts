import { ReadFlaunchSDK, ReadWriteFlaunchSDK } from "./sdk/FlaunchSDK";

export * from "./abi";
export * from "./addresses";
export * from "./helpers";
export * from "./utils/univ4";
export * from "./utils/parseSwap";
export * from "./utils/slippage";
export * from "./utils/swap";
export * from "./types";

export type {
  BuySwapLog,
  SellSwapLog,
  BaseSwapLog,
  PoolCreatedLogs,
  PoolSwapLog,
} from "./clients/FlaunchPositionManagerClient";

export {
  handleHashOf,
  normalizeHandle,
  HANDLE_RE,
} from "./clients/XHandleClaimsClient";

export { ReadIndexerSubscriber } from "./clients/IndexerSubscriberClient";
export { ReadPoolManager } from "./clients/PoolManagerClient";

export type { UbiEntitlement } from "./sdk/FlaunchSDK";

export { ReadFlaunchSDK, ReadWriteFlaunchSDK };
export { createFlaunch } from "./sdk/factory";
export type { CreateFlaunchParams } from "./sdk/factory";
export { createDrift } from "./sdk/drift";

// Calldata generation exports
export {
  createFlaunchCalldata,
  decodeCallData,
  parseCall,
  createCallDataWalletClient,
  encodedCallAbi,
} from "./sdk/calldata";
export type {
  CreateFlaunchCalldataParams,
  CallData,
  CallDataMethod,
  CallDataResult,
} from "./sdk/calldata";

export const FlaunchSDK = {
  ReadFlaunchSDK,
  ReadWriteFlaunchSDK,
};

// ubi.fun-branded aliases. Internals keep the upstream Flaunch names so they
// match the deployed contract ABIs and stay diffable against flaunch-sdk.
export {
  ReadFlaunchSDK as ReadUbiSDK,
  ReadWriteFlaunchSDK as ReadWriteUbiSDK,
};
export { createFlaunch as createUbiSDK } from "./sdk/factory";
export type { CreateFlaunchParams as CreateUbiSDKParams } from "./sdk/factory";
export { createFlaunchCalldata as createUBICalldata } from "./sdk/calldata";
export type { CreateFlaunchCalldataParams as CreateUBICalldataParams } from "./sdk/calldata";

export const UbiSDK = {
  ReadUbiSDK: ReadFlaunchSDK,
  ReadWriteUbiSDK: ReadWriteFlaunchSDK,
};
