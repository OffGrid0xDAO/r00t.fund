// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// @notice Minimal CREATE2 hook-address miner (vendored — v4-periphery isn't a lib here).
///         Finds a salt so the deployed hook address has EXACTLY the desired flag bits (0..13),
///         matching Foundry's default CREATE2 deployer used by `new X{salt: s}()` in scripts.
library HookMiner {
    // Foundry's deterministic CREATE2 deployer (0x4e59b448...) — the `new X{salt}` deployer in scripts.
    address internal constant CREATE2_DEPLOYER = 0x4e59b44847b379578588920cA78FbF26c0B4956C;
    uint160 internal constant FLAG_MASK = 0x3FFF; // low 14 bits are the hook permission flags
    uint256 internal constant MAX_LOOP = 200_000;

    function find(uint160 flags, bytes memory creationCode, bytes memory constructorArgs)
        internal pure returns (address hookAddress, bytes32 salt)
    {
        bytes memory initCode = abi.encodePacked(creationCode, constructorArgs);
        bytes32 initHash = keccak256(initCode);
        for (uint256 s = 0; s < MAX_LOOP; s++) {
            hookAddress = _addr(bytes32(s), initHash);
            if (uint160(hookAddress) & FLAG_MASK == flags) return (hookAddress, bytes32(s));
        }
        revert("HookMiner: no salt found");
    }

    function _addr(bytes32 salt, bytes32 initHash) private pure returns (address) {
        return address(uint160(uint256(
            keccak256(abi.encodePacked(bytes1(0xFF), CREATE2_DEPLOYER, salt, initHash))
        )));
    }
}
