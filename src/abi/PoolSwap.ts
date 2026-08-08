// Generated from PoolSwap (referrer-aware swap router).
// Source artifact: PoolSwap.sol/PoolSwap.json (FOUNDRY_PROFILE=arc forge build). Do not hand-edit;
// regenerate from the contracts repo when the deployed bytecode changes.
// NOTE: the 2-arg and hookData swap overloads are stripped so drift name-keyed
// calls resolve unambiguously; the SDK always swaps with an explicit referrer.
export const PoolSwapAbi = [
  {
    "type": "constructor",
    "inputs": [
      {
        "name": "_manager",
        "type": "address",
        "internalType": "contract IPoolManager"
      }
    ],
    "stateMutability": "nonpayable"
  },
  {
    "type": "function",
    "name": "manager",
    "inputs": [],
    "outputs": [
      {
        "name": "",
        "type": "address",
        "internalType": "contract IPoolManager"
      }
    ],
    "stateMutability": "view"
  },
  {
    "type": "function",
    "name": "swap",
    "inputs": [
      {
        "name": "_key",
        "type": "tuple",
        "internalType": "struct PoolKey",
        "components": [
          {
            "name": "currency0",
            "type": "address",
            "internalType": "Currency"
          },
          {
            "name": "currency1",
            "type": "address",
            "internalType": "Currency"
          },
          {
            "name": "fee",
            "type": "uint24",
            "internalType": "uint24"
          },
          {
            "name": "tickSpacing",
            "type": "int24",
            "internalType": "int24"
          },
          {
            "name": "hooks",
            "type": "address",
            "internalType": "contract IHooks"
          }
        ]
      },
      {
        "name": "_params",
        "type": "tuple",
        "internalType": "struct IPoolManager.SwapParams",
        "components": [
          {
            "name": "zeroForOne",
            "type": "bool",
            "internalType": "bool"
          },
          {
            "name": "amountSpecified",
            "type": "int256",
            "internalType": "int256"
          },
          {
            "name": "sqrtPriceLimitX96",
            "type": "uint160",
            "internalType": "uint160"
          }
        ]
      },
      {
        "name": "_referrer",
        "type": "address",
        "internalType": "address"
      }
    ],
    "outputs": [
      {
        "name": "delta_",
        "type": "int256",
        "internalType": "BalanceDelta"
      }
    ],
    "stateMutability": "payable"
  },
  {
    "type": "function",
    "name": "unlockCallback",
    "inputs": [
      {
        "name": "rawData",
        "type": "bytes",
        "internalType": "bytes"
      }
    ],
    "outputs": [
      {
        "name": "",
        "type": "bytes",
        "internalType": "bytes"
      }
    ],
    "stateMutability": "nonpayable"
  }
] as const;
