// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "forge-std/Script.sol";
import "../src/ZkProjectPoolCore.sol";

/// @title DeployProjectPools
/// @notice Deploy ZkProjectPoolCore instances and wire all authorizations.
///         After this script, use tenderly_setStorageAt to patch launchpad ammAddress.
///
/// Usage:
///   forge script script/DeployProjectPools.s.sol --sig "run()" \
///     --rpc-url $TENDERLY_VIRTUAL_TESTNET_RPC --broadcast --slow

interface IPoolFactory {
    function getPendingDeployment(uint256 id) external view returns (
        string memory name, string memory symbol, address token,
        uint256 initialRootReserve, address r00tPool, address nullifierRegistry,
        address creator, address platform, uint256 proposalId,
        uint256 maxDevAllocationBps, bool completed, address deployedPool, address routerAddr
    );
    function nextDeploymentId() external view returns (uint256);
    function registerDeployedPool(uint256 deploymentId, address poolAddress, uint256 tokenAmount) external;
}

interface IERC20View {
    function balanceOf(address) external view returns (uint256);
}

interface IZkAMMRouter {
    function registerProjectPool(address pool) external;
}

interface IZkProjectPool {
    function setAuthorizedAtomicSwapper(address swapper) external;
}

interface INullifierRegistry {
    function setPoolAuthorization(address pool, bool authorized) external;
    function governance() external view returns (address);
}

contract DeployProjectPoolsScript is Script {

    address constant POOL_FACTORY = 0x0A413597731b4627412530847f281Fc93F4c557c;
    address constant NULLIFIER_REG = 0x05553e6cF1A44B23c18D9707e8A7affbc2bA35de;
    address constant ROUTER = 0x79D52AB5EdaCFdC868c53DF8dd685f309cA20884;

    function run() external {
        uint256 pk = vm.envUint("PRIVATE_KEY");
        IPoolFactory factory = IPoolFactory(POOL_FACTORY);
        INullifierRegistry nr = INullifierRegistry(NULLIFIER_REG);

        uint256 nextId = factory.nextDeploymentId();
        console.log("Pending deployments:", nextId);
        console.log("NR governance:", nr.governance());

        vm.startBroadcast(pk);

        for (uint256 i = 0; i < nextId; i++) {
            (
                string memory name, string memory symbol, address token,
                uint256 initialRootReserve, address r00tPool, address nullifierRegistry,
                address creator, address platform, uint256 proposalId,
                uint256 maxDevAllocationBps, bool completed, , address routerAddr
            ) = factory.getPendingDeployment(i);

            if (completed) {
                console.log("Deployment", i, "- already completed, skipping");
                continue;
            }

            console.log("");
            console.log("=== Deploying:", name, "===");
            console.log("  ProposalId:", proposalId);

            // 1. Deploy ZkProjectPoolCore
            ZkProjectPoolCore pool = new ZkProjectPoolCore(
                name, symbol, token, initialRootReserve,
                r00tPool, nullifierRegistry, creator, platform,
                proposalId, maxDevAllocationBps, routerAddr
            );
            console.log("  Pool deployed:", address(pool));

            // 2. Register in factory (transfers tokens to pool)
            uint256 tokenBal = IERC20View(token).balanceOf(POOL_FACTORY);
            factory.registerDeployedPool(i, address(pool), tokenBal);
            console.log("  Factory: registered, tokens:", tokenBal / 1e18);

            // 3. Register on Router (also authorizes pool on TokenPool via Pair)
            IZkAMMRouter(ROUTER).registerProjectPool(address(pool));
            console.log("  Router: registered (TokenPool auth set)");

            // 4. NullifierRegistry authorization
            nr.setPoolAuthorization(address(pool), true);
            console.log("  NullifierRegistry: authorized");

            // 5. Set atomic swapper (deployer is pool governance)
            IZkProjectPool(address(pool)).setAuthorizedAtomicSwapper(ROUTER);
            console.log("  Pool: atomic swapper -> Router");

            console.log("  DONE. Pool address:", address(pool));
            console.log("  Use tenderly_setStorageAt to patch launchpad ammAddress for proposalId", proposalId);
        }

        vm.stopBroadcast();

        console.log("");
        console.log("=== Pools deployed and wired! ===");
        console.log("Run the storage patch script next to set ammAddress on launchpad proposals.");
    }
}
