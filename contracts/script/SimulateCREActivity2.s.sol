// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "forge-std/Script.sol";

/// @title SimulateCREActivity2
/// @notice Additional CRE transactions (7 more) to reach 54+ total on Tenderly VNet

interface IRegenPredictionMarket {
    function buyShares(uint256 marketId, bool isPositive, uint256 minShares) external payable;
}

interface ICompliantPrivateVault {
    function requestDeposit(
        uint256 commitment, bytes32 addressHash, bytes calldata encryptedNote
    ) external payable returns (uint256);
    function authorizeTransfer(uint256 requestId) external;
    function denyTransfer(uint256 requestId, string calldata reason) external;
}

contract SimulateCREActivity2Script is Script {
    function run() external {
        uint256 deployerPrivateKey = vm.envUint("PRIVATE_KEY");
        address deployer = vm.addr(deployerPrivateKey);

        address predictionMarket = vm.envAddress("REGEN_PREDICTION_MARKET_ADDRESS");
        address compliantVault = vm.envAddress("COMPLIANT_PRIVATE_VAULT_ADDRESS");

        console.log("");
        console.log("=== Additional CRE Transactions (Round 2) ===");
        console.log("");

        vm.startBroadcast(deployerPrivateKey);

        uint256 txCount = 0;

        // More prediction market bets
        IRegenPredictionMarket pm = IRegenPredictionMarket(predictionMarket);

        pm.buyShares{value: 0.002 ether}(3, true, 0);
        txCount++;
        console.log("  Bet: 0.002 ETH on YES for >50 carbon credits");

        pm.buyShares{value: 0.004 ether}(1, false, 0);
        txCount++;
        console.log("  Bet: 0.004 ETH on NO for NDVI recovery >70%");

        pm.buyShares{value: 0.003 ether}(3, false, 0);
        txCount++;
        console.log("  Bet: 0.003 ETH on NO for >50 carbon credits");

        // Additional compliance deposits
        ICompliantPrivateVault cv = ICompliantPrivateVault(compliantVault);

        bytes32 user2Hash = keccak256(abi.encodePacked(address(0xBEEF), bytes32("salt_user_2")));
        bytes32 user3Hash = keccak256(abi.encodePacked(address(0xCAFE), bytes32("salt_user_3")));

        uint256 commitment2 = uint256(keccak256(abi.encodePacked("test_deposit_commitment_r2_2", block.timestamp))) % 21888242871839275222246405745257275088548364400416034343698204186575808495617;
        uint256 reqId2 = cv.requestDeposit{value: 0.02 ether}(commitment2, user2Hash, "");
        txCount++;
        console.log("  Deposit request 2: 0.02 ETH (user2, STANDARD)");

        cv.authorizeTransfer(reqId2);
        txCount++;
        console.log("  Authorized: Request", reqId2);

        uint256 commitment3 = uint256(keccak256(abi.encodePacked("test_deposit_commitment_r2_3", block.timestamp))) % 21888242871839275222246405745257275088548364400416034343698204186575808495617;
        uint256 reqId3 = cv.requestDeposit{value: 0.005 ether}(commitment3, user3Hash, "");
        txCount++;
        console.log("  Deposit request 3: 0.005 ETH (user3, BASIC)");

        cv.denyTransfer(reqId3, "Insufficient compliance level for amount");
        txCount++;
        console.log("  Denied: Request", reqId3, "(insufficient compliance)");

        vm.stopBroadcast();

        console.log("");
        console.log("Additional transactions:", txCount);
        console.log("Total on VNet should now be: 45 (deploy) + 49 (round 1) + 7 (round 2) = 101");
        console.log("");
    }
}
