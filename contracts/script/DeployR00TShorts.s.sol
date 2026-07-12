// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "forge-std/Script.sol";
import "../src/R00TShorts.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";

/// @notice Deploy R00TShorts to Robinhood Chain (4663) and wire it to the live ZkAMM.
/// @dev One atomic broadcast: deploy → seed with ROOT → authorize on the pair via the
///      ZkAMMAdmin (deployer is the admin owner). TWAP-based liquidations, public positions.
interface IZkAMMAdminShorts {
    function setShortsContractInitial(address _shortsContract) external;
    function owner() external view returns (address);
}

contract DeployR00TShortsScript is Script {
    // Robinhood Chain (4663) live addresses.
    address constant PAIR = 0xbd34EF73b3Cb1b8Bb0fFba47a42AFdbA90Ccf511;
    address constant ROOT_TOKEN = 0x7d0bfc2145327CF98f882De2CB71f8F1D7b8f022;
    address constant ADMIN = 0x2fF206f68c68b49eBfE5D1c39B26281669bcB851;

    // Seed the shorts contract with ROOT to sell when positions open (1M = ~1.45% of supply).
    uint256 constant SHORTS_TOKEN_ALLOCATION = 1_000_000 * 1e18;

    function run() external {
        uint256 pk = vm.envUint("PRIVATE_KEY");
        address deployer = vm.addr(pk);
        address treasury = deployer;

        console.log("Deployer:", deployer);
        console.log("Balance (ETH):", deployer.balance / 1e18);
        require(IZkAMMAdminShorts(ADMIN).owner() == deployer, "deployer must be admin owner");

        vm.startBroadcast(pk);

        // 1. Deploy shorts
        R00TShorts shorts = new R00TShorts(PAIR, ROOT_TOKEN, treasury);
        console.log("R00TShorts:", address(shorts));

        // 2. Seed with ROOT (contract sells these on openShort)
        uint256 bal = IERC20(ROOT_TOKEN).balanceOf(deployer);
        uint256 seed = bal >= SHORTS_TOKEN_ALLOCATION ? SHORTS_TOKEN_ALLOCATION : bal;
        require(seed > 0, "no ROOT to seed");
        IERC20(ROOT_TOKEN).transfer(address(shorts), seed);
        console.log("Seeded ROOT:", seed / 1e18);

        // 3. Authorize on the pair via admin (deployer owns the admin)
        IZkAMMAdminShorts(ADMIN).setShortsContractInitial(address(shorts));
        console.log("Authorized shorts on pair via admin");

        vm.stopBroadcast();

        console.log("Available tokens:", shorts.getAvailableTokens() / 1e18);
        console.log("DONE. Set VITE frontend shortsContract to:", address(shorts));
    }
}
