// Generated from Morpho UniversalRewardsDistributor (daily USDC holder pool).
// Source artifact: IUniversalRewardsDistributor.sol/IUniversalRewardsDistributor.json (FOUNDRY_PROFILE=arc forge build). Do not hand-edit;
// regenerate from the contracts repo when the deployed bytecode changes.
export const UniversalRewardsDistributorAbi = [
  {
    "type": "function",
    "name": "acceptRoot",
    "inputs": [],
    "outputs": [],
    "stateMutability": "nonpayable"
  },
  {
    "type": "function",
    "name": "claim",
    "inputs": [
      {
        "name": "_account",
        "type": "address",
        "internalType": "address"
      },
      {
        "name": "_reward",
        "type": "address",
        "internalType": "address"
      },
      {
        "name": "_claimable",
        "type": "uint256",
        "internalType": "uint256"
      },
      {
        "name": "_proof",
        "type": "bytes32[]",
        "internalType": "bytes32[]"
      }
    ],
    "outputs": [
      {
        "name": "amount",
        "type": "uint256",
        "internalType": "uint256"
      }
    ],
    "stateMutability": "nonpayable"
  },
  {
    "type": "function",
    "name": "claimed",
    "inputs": [
      {
        "name": "_account",
        "type": "address",
        "internalType": "address"
      },
      {
        "name": "_reward",
        "type": "address",
        "internalType": "address"
      }
    ],
    "outputs": [
      {
        "name": "",
        "type": "uint256",
        "internalType": "uint256"
      }
    ],
    "stateMutability": "view"
  },
  {
    "type": "function",
    "name": "ipfsHash",
    "inputs": [],
    "outputs": [
      {
        "name": "",
        "type": "bytes32",
        "internalType": "bytes32"
      }
    ],
    "stateMutability": "view"
  },
  {
    "type": "function",
    "name": "isUpdater",
    "inputs": [
      {
        "name": "_updater",
        "type": "address",
        "internalType": "address"
      }
    ],
    "outputs": [
      {
        "name": "",
        "type": "bool",
        "internalType": "bool"
      }
    ],
    "stateMutability": "view"
  },
  {
    "type": "function",
    "name": "owner",
    "inputs": [],
    "outputs": [
      {
        "name": "",
        "type": "address",
        "internalType": "address"
      }
    ],
    "stateMutability": "view"
  },
  {
    "type": "function",
    "name": "pendingRoot",
    "inputs": [],
    "outputs": [
      {
        "name": "root",
        "type": "bytes32",
        "internalType": "bytes32"
      },
      {
        "name": "ipfsHash",
        "type": "bytes32",
        "internalType": "bytes32"
      },
      {
        "name": "validAt",
        "type": "uint256",
        "internalType": "uint256"
      }
    ],
    "stateMutability": "view"
  },
  {
    "type": "function",
    "name": "revokePendingRoot",
    "inputs": [],
    "outputs": [],
    "stateMutability": "nonpayable"
  },
  {
    "type": "function",
    "name": "root",
    "inputs": [],
    "outputs": [
      {
        "name": "",
        "type": "bytes32",
        "internalType": "bytes32"
      }
    ],
    "stateMutability": "view"
  },
  {
    "type": "function",
    "name": "setOwner",
    "inputs": [
      {
        "name": "_newOwner",
        "type": "address",
        "internalType": "address"
      }
    ],
    "outputs": [],
    "stateMutability": "nonpayable"
  },
  {
    "type": "function",
    "name": "setRoot",
    "inputs": [
      {
        "name": "_newRoot",
        "type": "bytes32",
        "internalType": "bytes32"
      },
      {
        "name": "_newIpfsHash",
        "type": "bytes32",
        "internalType": "bytes32"
      }
    ],
    "outputs": [],
    "stateMutability": "nonpayable"
  },
  {
    "type": "function",
    "name": "setRootUpdater",
    "inputs": [
      {
        "name": "_updater",
        "type": "address",
        "internalType": "address"
      },
      {
        "name": "_active",
        "type": "bool",
        "internalType": "bool"
      }
    ],
    "outputs": [],
    "stateMutability": "nonpayable"
  },
  {
    "type": "function",
    "name": "setTimelock",
    "inputs": [
      {
        "name": "_newTimelock",
        "type": "uint256",
        "internalType": "uint256"
      }
    ],
    "outputs": [],
    "stateMutability": "nonpayable"
  },
  {
    "type": "function",
    "name": "submitRoot",
    "inputs": [
      {
        "name": "_newRoot",
        "type": "bytes32",
        "internalType": "bytes32"
      },
      {
        "name": "_newIpfsHash",
        "type": "bytes32",
        "internalType": "bytes32"
      }
    ],
    "outputs": [],
    "stateMutability": "nonpayable"
  },
  {
    "type": "function",
    "name": "timelock",
    "inputs": [],
    "outputs": [
      {
        "name": "",
        "type": "uint256",
        "internalType": "uint256"
      }
    ],
    "stateMutability": "view"
  }
] as const;
