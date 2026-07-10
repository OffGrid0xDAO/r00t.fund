// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "@openzeppelin/contracts/token/ERC20/ERC20.sol";

/// @title ParcelToken
/// @notice A per-parcel culture token ($OAK, $CARROT, …) paired with $R00T.
///         Minted directly to pledgers by the ParcelLaunchpad at pledge time —
///         the token is near-worthless pre-market, so backers get it instantly;
///         value comes when the $R00T pool opens at TGE.
contract ParcelToken is ERC20 {
    /// @notice The only address allowed to mint (the launchpad).
    address public immutable launchpad;

    error OnlyLaunchpad();

    constructor(string memory name_, string memory symbol_, address launchpad_)
        ERC20(name_, symbol_)
    {
        launchpad = launchpad_;
    }

    function mint(address to, uint256 amount) external {
        if (msg.sender != launchpad) revert OnlyLaunchpad();
        _mint(to, amount);
    }
}
