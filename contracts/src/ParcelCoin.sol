// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";

/// @title ParcelCoin
/// @notice A global, protocol-wide parcel coin ($RICE, $CARROT, $OAK…). One token
///         per real crop — rice is rice whether grown on land A or land B. Fixed supply,
///         no mint: the entire genesis is minted once to the first grower who created it
///         via the ParcelRegistry. Everyone else must ACQUIRE it (buy from the market
///         or OTC from an existing land) to stock their own parcel.
contract ParcelCoin is ERC20 {
    /// @notice The registry that created this parcel (its genesis authority).
    address public immutable registry;
    /// @notice The first grower who tokenized this parcel.
    address public immutable genesisGrower;

    constructor(string memory name_, string memory symbol_, uint256 genesisSupply, address grower)
        ERC20(name_, symbol_)
    {
        registry = msg.sender;
        genesisGrower = grower;
        _mint(grower, genesisSupply); // fixed supply — no further minting is possible
    }
}
