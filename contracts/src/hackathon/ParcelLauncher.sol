// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";

interface IRegenLaunchpad {
    function createParcel(
        bytes32 parcelId, IERC20 parcelToken, address regenTreasury,
        uint256 saleTokens, uint256 poolTokens, uint256 reservePriceR00T, uint64 window
    ) external;
    function clearAndLaunch(bytes32 parcelId) external;
}

/// @notice Parcel ERC20 that mints its full supply to the deployer in the constructor (no separate mint tx).
contract ParcelToken is ERC20 {
    constructor(string memory n, string memory s, uint256 supply, address to) ERC20(n, s) { _mint(to, supply); }
}

/// @title ParcelLauncher  (ETHGlobal — HACKATHON WORKSPACE)
/// @notice ONE-TRANSACTION parcel launch. Instead of the steward signing 4 txns (deploy token → mint →
///         approve → createParcel), they call `openRaise` ONCE: this contract deploys the parcel token
///         (minting sale+pool+slack to itself), approves the RegenLaunchpad, and opens the CCA — all in
///         a single call. `clear` then clears the CCA (this contract is the parcel's steward), pulling
///         the R00T pool-seed from the caller and refunding any leftover.
/// @dev The parcel's on-chain steward becomes THIS launcher (not the EOA); the LAND steward is still the
///      user, and the frontend gates on that. Requires the launchpad gatekeeper to be open (address(0))
///      OR this launcher to be an eligible steward.
contract ParcelLauncher {
    IRegenLaunchpad public immutable launchpad;
    IERC20 public immutable root;
    uint256 private constant SLACK = 10_000e18; // hook working-inventory slack (matches useLaunchParcel)

    event ParcelOpened(bytes32 indexed parcelId, address indexed steward, address token, string symbol);

    constructor(address _launchpad, address _root) {
        launchpad = IRegenLaunchpad(_launchpad);
        root = IERC20(_root);
    }

    /// @notice One tx: deploy the parcel token, mint sale+pool+slack here, approve the launchpad, open the CCA.
    /// @return token the deployed parcel ERC20.  @return parcelId the (unique) CCA id — read from the event.
    function openRaise(
        string calldata name_, string calldata symbol_,
        uint256 sale, uint256 pool, uint256 reserveR00T, uint64 window, address treasury
    ) external returns (address token, bytes32 parcelId) {
        require(sale > 0 && pool > 0 && reserveR00T > 0 && window > 0, "bad params");
        uint256 supply = sale + pool + SLACK;
        ParcelToken t = new ParcelToken(name_, symbol_, supply, address(this));
        token = address(t);
        t.approve(address(launchpad), supply);

        // unique per (symbol, caller, block) so re-launching a ticker never collides
        parcelId = keccak256(abi.encodePacked(symbol_, msg.sender, block.timestamp, token));
        launchpad.createParcel(parcelId, IERC20(token), treasury, sale, pool, reserveR00T, window);
        emit ParcelOpened(parcelId, msg.sender, token, symbol_);
    }

    /// @notice Clear a CCA this launcher opened (launcher == steward, so it can clear anytime). Pulls
    ///         `r00tSeed` R00T from the caller for the pool self-seed and refunds any unused R00T.
    /// @dev The caller must first `approve` this launcher for `r00tSeed` R00T.
    function clear(bytes32 parcelId, uint256 r00tSeed) external {
        if (r00tSeed > 0) {
            require(root.transferFrom(msg.sender, address(this), r00tSeed), "R00T pull failed");
            root.approve(address(launchpad), r00tSeed);
        }
        launchpad.clearAndLaunch(parcelId);
        uint256 leftover = root.balanceOf(address(this));
        if (leftover > 0) root.transfer(msg.sender, leftover); // refund the unused seed
    }
}
