// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "forge-std/Script.sol";
import "../src/ZkAMMRouter.sol";

contract BootstrapLiquidityScript is Script {
    function run() external {
        uint256 deployerPrivateKey = vm.envUint("PRIVATE_KEY");
        address payable router = payable(0xAaF3D9427Beae5B62D2EaD62589955f440FB2042);
        
        // Generate a simple LP commitment (for demo/testing purposes)
        uint256 lpCommitment = uint256(keccak256(abi.encodePacked("r00t_bootstrap_lp_v1"))) % 21888242871839275222246405745257275088548364400416034343698204186575808495617;
        
        console.log("Bootstrapping liquidity with 1 ETH...");
        console.log("Router:", router);
        console.log("LP Commitment:", lpCommitment);
        
        vm.startBroadcast(deployerPrivateKey);
        
        ZkAMMRouter(router).bootstrapLiquidity{value: 1 ether}(
            lpCommitment,
            0,  // minLPShares
            block.timestamp + 1 hours,
            ""
        );
        
        vm.stopBroadcast();
        
        console.log("Bootstrap complete! Total pool: 2 ETH + 69M ROOT");
    }
}
