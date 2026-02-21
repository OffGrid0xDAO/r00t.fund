// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "forge-std/Test.sol";
import "../src/TokenPool.sol";
import "../src/PoseidonT3.sol";

contract TokenPoolTest is Test {
    TokenPool public pool;
    address public poseidonAddr;

    function setUp() public {
        poseidonAddr = PoseidonT3Deployer.deploy();
        pool = new TokenPool(poseidonAddr);
    }

    function test_InitialState() public view {
        assertEq(pool.nextIndex(), 0);
        assertEq(pool.DEPTH(), 24);
        assertTrue(pool.root() != 0);
    }

    function test_InsertSingleLeaf() public {
        uint256 leaf = 12345;
        uint256 index = pool.insert(leaf);

        assertEq(index, 0);
        assertEq(pool.nextIndex(), 1);
        assertTrue(pool.isKnownRoot(pool.root()));
    }

    function test_InsertMultipleLeaves() public {
        uint256 leaf1 = 111;
        uint256 leaf2 = 222;
        uint256 leaf3 = 333;

        uint256 index1 = pool.insert(leaf1);
        uint256 root1 = pool.root();

        uint256 index2 = pool.insert(leaf2);
        uint256 root2 = pool.root();

        uint256 index3 = pool.insert(leaf3);
        uint256 root3 = pool.root();

        assertEq(index1, 0);
        assertEq(index2, 1);
        assertEq(index3, 2);
        assertEq(pool.nextIndex(), 3);

        // All roots should be known (historical)
        assertTrue(pool.isKnownRoot(root1));
        assertTrue(pool.isKnownRoot(root2));
        assertTrue(pool.isKnownRoot(root3));

        // Roots should be different after each insert
        assertTrue(root1 != root2);
        assertTrue(root2 != root3);
    }

    function test_RootHistory() public {
        // Insert leaves and collect roots
        uint256[] memory roots = new uint256[](5);

        for (uint256 i = 0; i < 5; i++) {
            pool.insert(i + 1);
            roots[i] = pool.root();
        }

        // All recent roots should be known
        for (uint256 i = 0; i < 5; i++) {
            assertTrue(pool.isKnownRoot(roots[i]));
        }
    }

    function test_UnknownRoot() public view {
        // Random value should not be a known root
        assertFalse(pool.isKnownRoot(999999));

        // Zero should not be a known root
        assertFalse(pool.isKnownRoot(0));
    }

    function test_EmitLeafInserted() public {
        uint256 leaf = 42;

        // We expect the event with the correct leaf index and leaf value
        // The root will change, so we only check the indexed parameters
        vm.expectEmit(true, true, false, false);
        emit TokenPool.LeafInserted(0, leaf, 0); // root value doesn't matter for this check

        pool.insert(leaf);
    }

    function testFuzz_Insert(uint256 leaf) public {
        uint256 index = pool.insert(leaf);
        assertEq(index, 0);
        assertTrue(pool.isKnownRoot(pool.root()));
    }

    function test_ManyInserts() public {
        uint256 insertCount = 100;

        for (uint256 i = 0; i < insertCount; i++) {
            uint256 index = pool.insert(i);
            assertEq(index, i);
        }

        assertEq(pool.nextIndex(), insertCount);
    }

    function test_GetRoot() public {
        pool.insert(123);
        assertEq(pool.getRoot(), pool.root());
    }

    function test_GetNextIndex() public {
        assertEq(pool.getNextIndex(), 0);
        pool.insert(1);
        assertEq(pool.getNextIndex(), 1);
        pool.insert(2);
        assertEq(pool.getNextIndex(), 2);
    }
}
