// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "forge-std/Script.sol";

/// @title AuthorizeCRECallback
/// @notice Proposes + executes CRE callback authorization on ZkAMMAdmin
/// @dev Run in two steps with Tenderly evm_increaseTime in between:
///
///   Step 1 (propose):
///     source .env && forge script script/AuthorizeCRECallback.s.sol --sig "propose()" \
///       --rpc-url $TENDERLY_VIRTUAL_TESTNET_RPC --broadcast --slow
///
///   Step 2 (advance time 61s on Tenderly):
///     curl -X POST $TENDERLY_VIRTUAL_TESTNET_RPC -H "Content-Type: application/json" \
///       -d '{"jsonrpc":"2.0","method":"evm_increaseTime","params":["0x3D"],"id":1}'
///     curl -X POST $TENDERLY_VIRTUAL_TESTNET_RPC -H "Content-Type: application/json" \
///       -d '{"jsonrpc":"2.0","method":"evm_mine","params":[],"id":2}'
///
///   Step 3 (execute):
///     source .env && forge script script/AuthorizeCRECallback.s.sol --sig "execute()" \
///       --rpc-url $TENDERLY_VIRTUAL_TESTNET_RPC --broadcast --slow

interface IZkAMMAdmin {
    function proposeCRECallback(address _callback) external;
    function executeCRECallbackAuthorization() external;
    function authorizedCRECallback(address) external view returns (bool);
    function pendingCRECallback() external view returns (address);
    function creCallbackTimelockExpiry() external view returns (uint256);
}

contract AuthorizeCRECallbackScript is Script {
    function propose() external {
        uint256 deployerPrivateKey = vm.envUint("PRIVATE_KEY");
        address admin = vm.envAddress("ZKAMM_ADMIN_ADDRESS");
        address vault = vm.envAddress("COMPLIANT_PRIVATE_VAULT_ADDRESS");

        console.log("=== Proposing CRE Callback Authorization ===");
        console.log("ZkAMMAdmin:", admin);
        console.log("CompliantPrivateVault:", vault);

        // Check if already authorized
        IZkAMMAdmin zkAdmin = IZkAMMAdmin(admin);
        bool alreadyAuthorized = zkAdmin.authorizedCRECallback(vault);
        console.log("Already authorized:", alreadyAuthorized ? "true" : "false");

        if (alreadyAuthorized) {
            console.log("SKIP: Vault is already an authorized CRE callback");
            return;
        }

        vm.startBroadcast(deployerPrivateKey);
        zkAdmin.proposeCRECallback(vault);
        vm.stopBroadcast();

        console.log("PROPOSED. Timelock expiry:", zkAdmin.creCallbackTimelockExpiry());
        console.log("");
        console.log("Next: advance time 61s, then run execute()");
    }

    function execute() external {
        uint256 deployerPrivateKey = vm.envUint("PRIVATE_KEY");
        address admin = vm.envAddress("ZKAMM_ADMIN_ADDRESS");
        address vault = vm.envAddress("COMPLIANT_PRIVATE_VAULT_ADDRESS");

        IZkAMMAdmin zkAdmin = IZkAMMAdmin(admin);

        console.log("=== Executing CRE Callback Authorization ===");
        console.log("Pending callback:", zkAdmin.pendingCRECallback());
        console.log("Timelock expiry:", zkAdmin.creCallbackTimelockExpiry());
        console.log("Current block.timestamp will be checked on-chain");

        vm.startBroadcast(deployerPrivateKey);
        zkAdmin.executeCRECallbackAuthorization();
        vm.stopBroadcast();

        bool authorized = zkAdmin.authorizedCRECallback(vault);
        console.log("");
        console.log("CompliantPrivateVault authorized:", authorized ? "true" : "false");
        console.log("=== DONE ===");
    }
}
