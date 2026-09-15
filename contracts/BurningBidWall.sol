// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {PoolKey} from '@uniswap/v4-core/src/types/PoolKey.sol';

import {BidWall} from '@flaunch/bidwall/BidWall.sol';


/**
 * BidWall that burns the memecoins it buys. Tokens withdrawn during a reposition go to
 * the dead address instead of the memecoin treasury, removing them from circulation.
 * Burning happens only on reposition: closing a disabled BidWall is unchanged, so those
 * funds, ETH and any unswept tokens included, still return to the memecoin treasury
 * through the parent implementation.
 */
contract BurningBidWall is BidWall {

    address internal constant DEAD_ADDRESS = 0x000000000000000000000000000000000000dEaD;

    constructor (address _nativeToken, address _poolManager, address _protocolOwner)
        BidWall(_nativeToken, _poolManager, _protocolOwner)
    {}

    function _getRewardsRecipient(PoolKey memory, address) internal view override returns (address) {
        return DEAD_ADDRESS;
    }

}
