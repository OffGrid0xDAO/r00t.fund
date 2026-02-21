// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "forge-std/Test.sol";
import "../src/TokenPool.sol";
import "../src/PoseidonT3.sol";

/// @notice Test merkle proof computation matches off-chain expectations
contract MerkleProofTest is Test {
    TokenPool public pool;
    address public poseidonAddr;

    function setUp() public {
        poseidonAddr = PoseidonT3Deployer.deploy();
        pool = new TokenPool(poseidonAddr);
    }

    /// @notice Helper to hash using the deployed Poseidon
    function _hash(uint256 left, uint256 right) internal view returns (uint256) {
        return PoseidonT3.hash(poseidonAddr, [left, right]);
    }

    function test_SingleLeafProof() public {
        // Insert a single leaf at index 0
        uint256 leaf = 12345;
        pool.insert(leaf);

        // Get merkle root
        uint256 root = pool.root();
        console.log("Root after inserting leaf 0:", root);

        // For leaf at index 0:
        // - Level 0: leaf is LEFT child, sibling = zeros[0]
        // - Level 1+: continue up with zeros

        // Compute proof manually
        uint256 currentHash = leaf;
        for (uint256 i = 0; i < 24; i++) {
            // At each level, index 0 >> i is still 0, so always left child
            uint256 sibling = pool.zeros(i);
            currentHash = _hash(currentHash, sibling);
        }

        console.log("Computed root:", currentHash);
        assertEq(currentHash, root, "Root should match");
    }

    function test_SecondLeafProof() public {
        // Insert two leaves
        uint256 leaf0 = 11111;
        uint256 leaf1 = 22222;

        pool.insert(leaf0);
        uint256 rootAfter0 = pool.root();
        console.log("Root after leaf 0:", rootAfter0);

        pool.insert(leaf1);
        uint256 rootAfter1 = pool.root();
        console.log("Root after leaf 1:", rootAfter1);

        // For leaf1 at index 1:
        // - Level 0: index 1 is ODD, so leaf1 is RIGHT child
        //   sibling = filledSubtrees[0] = leaf0
        //   parent = hash(leaf0, leaf1)
        // - Level 1+: parent index = 0, so LEFT child, sibling = zeros[level]

        uint256 currentHash = leaf1;

        // Level 0: leaf1 is RIGHT child, sibling is filledSubtrees[0] = leaf0
        uint256 sibling0 = pool.filledSubtrees(0);
        console.log("Level 0 sibling (should be leaf0):", sibling0);
        assertEq(sibling0, leaf0, "filledSubtrees[0] should be leaf0");

        currentHash = _hash(sibling0, currentHash); // hash(left=leaf0, right=leaf1)
        console.log("After level 0:", currentHash);

        // Level 1-19: current index = 0 (even), so LEFT child
        for (uint256 i = 1; i < 24; i++) {
            uint256 sibling = pool.zeros(i);
            currentHash = _hash(currentHash, sibling);
        }

        console.log("Computed root for leaf1:", currentHash);
        assertEq(currentHash, rootAfter1, "Root should match for leaf1");
    }

    function test_ThirdLeafProof() public {
        // Insert three leaves
        uint256 leaf0 = 11111;
        uint256 leaf1 = 22222;
        uint256 leaf2 = 33333;

        pool.insert(leaf0);
        pool.insert(leaf1);
        pool.insert(leaf2);

        uint256 root = pool.root();
        console.log("Root after 3 leaves:", root);

        // For leaf2 at index 2:
        // - Level 0: index 2 is EVEN, so leaf2 is LEFT child
        //   sibling = zeros[0]
        //   After insertion, filledSubtrees[0] = leaf2
        // - Level 1: index 1 is ODD, so RIGHT child
        //   sibling = filledSubtrees[1] = hash(leaf0, leaf1)
        // - Level 2+: LEFT child, sibling = zeros[level]

        uint256 currentHash = leaf2;

        // Level 0: leaf2 (index 2) is EVEN, so LEFT child, sibling = zeros[0]
        uint256 sibling0 = pool.zeros(0);
        currentHash = _hash(currentHash, sibling0);
        console.log("After level 0:", currentHash);

        // Level 1: index 1 is ODD, so RIGHT child
        // sibling = filledSubtrees[1] which is hash(leaf0, leaf1)
        uint256 sibling1 = pool.filledSubtrees(1);
        uint256 expectedSibling1 = _hash(leaf0, leaf1);
        console.log("filledSubtrees[1]:", sibling1);
        console.log("expected (hash of leaf0,leaf1):", expectedSibling1);
        // Note: filledSubtrees[1] was set when leaf1 was inserted
        // After leaf1 insert: parent = hash(leaf0, leaf1), and since parent index = 0, it goes to filledSubtrees[1]

        currentHash = _hash(sibling1, currentHash); // RIGHT child: hash(sibling, current)
        console.log("After level 1:", currentHash);

        // Level 2+: index = 0, LEFT child
        for (uint256 i = 2; i < 24; i++) {
            uint256 sibling = pool.zeros(i);
            currentHash = _hash(currentHash, sibling);
        }

        console.log("Computed root for leaf2:", currentHash);
        assertEq(currentHash, root, "Root should match for leaf2");
    }

    /// @notice Generate and print proof data for off-chain verification
    function test_PrintProofForLeaf1() public {
        uint256 leaf0 = 11111;
        uint256 leaf1 = 22222;

        pool.insert(leaf0);
        pool.insert(leaf1);

        uint256 root = pool.root();

        console.log("\n=== Proof data for leaf1 (index 1) ===");
        console.log("Leaf:", leaf1);
        console.log("Root:", root);

        console.log("\nPath elements:");
        // Level 0: sibling = filledSubtrees[0] = leaf0
        console.log("  [0]:", pool.filledSubtrees(0));

        // Level 1-19: sibling = zeros[level]
        for (uint256 i = 1; i < 24; i++) {
            console.log("  [%d]: %d", i, pool.zeros(i));
        }

        console.log("\nPath indices (1 = right, 0 = left):");
        console.log("  [0]: 1 (leaf1 is right child at level 0)");
        for (uint256 i = 1; i < 24; i++) {
            console.log("  [%d]: 0 (left child)", i);
        }
    }
}
