// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "forge-std/Script.sol";
import "../src/R00TShorts.sol";
import "../src/RootToken.sol";
import "../src/ZkAMMAdmin.sol";

/**
 * @notice Redeploy R00TShorts with OI accounting fix.
 *         Run on Tenderly VNet with --unlocked deployer.
 *
 * Step 1: Deploy + propose (this script)
 * Step 2: Wait 60s, then run RedeployShortsExecute
 */
contract RedeployShorts is Script {
    function run() external {
        address deployer = 0x42069c220DD72541C2C7Cb7620f2094f1601430A;
        address pair     = 0xE9D2De4bfEadC1923B90B09C3c8b197Ae5eE979d;
        address rootToken = 0x89eb61a19B55257a91B3a5FCE7e36fC1668A1C29;
        address admin    = 0xe99aD5A43ed5Fa986d396b18deE1ceFb48630A79;

        vm.startBroadcast(deployer);

        // Deploy new R00TShorts with OI fix
        R00TShorts shorts = new R00TShorts(pair, rootToken, deployer);
        console.log("New R00TShorts:", address(shorts));

        // Propose shorts contract change (60s timelock)
        ZkAMMAdmin(admin).proposeShortsContract(address(shorts));
        console.log("Proposed shorts contract change");

        vm.stopBroadcast();
    }
}

/**
 * @notice Execute the shorts contract change after timelock expires,
 *         then fund the new contract with ROOT tokens.
 */
contract RedeployShortsExecute is Script {
    function run() external {
        address deployer = 0x42069c220DD72541C2C7Cb7620f2094f1601430A;
        address rootToken = 0x89eb61a19B55257a91B3a5FCE7e36fC1668A1C29;
        address admin    = 0xe99aD5A43ed5Fa986d396b18deE1ceFb48630A79;

        vm.startBroadcast(deployer);

        // Execute after timelock
        ZkAMMAdmin adminContract = ZkAMMAdmin(admin);
        adminContract.executeShortsContractChange();

        address newShorts = address(adminContract.pendingShortsContract());
        console.log("Shorts contract changed");

        // Transfer ROOT tokens from deployer to new shorts contract
        uint256 balance = RootToken(rootToken).balanceOf(deployer);
        if (balance > 0) {
            // Need to send to the new shorts via allocateTokensForShorts
            // First send back to admin, then allocate
            // Actually, just transfer directly
            RootToken(rootToken).transfer(adminContract.pendingShortsContract(), balance);
            console.log("Transferred ROOT tokens:", balance);
        }

        vm.stopBroadcast();
    }
}
