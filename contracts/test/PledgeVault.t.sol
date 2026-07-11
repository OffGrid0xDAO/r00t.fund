// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "forge-std/Test.sol";
import {stdJson} from "forge-std/StdJson.sol";

import {PledgeVault, IShieldedRootPool} from "../src/PledgeVault.sol";
import {Land} from "../src/Land.sol";
import {ParcelToken} from "../src/ParcelToken.sol";
import {NullifierRegistry} from "../src/NullifierRegistry.sol";
import {RealPledgeVerifier} from "../src/verifiers/RealPledgeVerifier.sol";
import {RealClaimVerifier} from "../src/verifiers/RealClaimVerifier.sol";
import {IPledgeVerifier, IClaimVerifier} from "../src/interfaces/IVerifier.sol";
import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";

contract MockRoot is ERC20 {
    constructor() ERC20("Root", "ROOT") {}
    function mint(address to, uint256 amt) external { _mint(to, amt); }
}

/// @notice Stand-in for Phase B's deployed zkAMM shielded R00T pool. Holds R00T, reports
///         known source roots, and releases pledged R00T to the treasury on the vault's behalf.
contract MockShieldedPool is IShieldedRootPool {
    MockRoot public root;
    mapping(uint256 => bool) public known;
    constructor(MockRoot _root) { root = _root; }
    function setKnownRoot(uint256 r, bool k) external { known[r] = k; }
    function isKnownRoot(uint256 r) external view returns (bool) { return known[r]; }
    function releaseForPledge(address to, uint256 amount) external { root.transfer(to, amount); }
}

/// @notice Permissive verifiers for the deterministic guard-path suite (cap, field-range,
///         duplicate). The real-proof suite uses the actual snarkjs verifiers.
contract MockPledgeVerifier is IPledgeVerifier {
    function verifyProof(uint256[8] calldata, uint256[7] calldata) external pure returns (bool) { return true; }
}
contract MockClaimVerifier is IClaimVerifier {
    function verifyProof(uint256[8] calldata, uint256[6] calldata) external pure returns (bool) { return true; }
}

/// @dev Shared Land + registry scaffolding used by both suites.
abstract contract PledgeVaultBase is Test {
    using stdJson for string;

    NullifierRegistry internal registry;
    MockRoot internal root;
    MockShieldedPool internal source;
    Land internal land;

    address internal steward = address(0x57EE);
    address internal validator = address(0x7A11);
    address internal treasury = address(0x7EA5);
    address internal proto = address(0x9701);

    // Matches the fixtures' parcelId field element (77777777).
    bytes32 internal constant PARCEL = bytes32(uint256(77777777));

    function _deployLandWithParcel() internal {
        root = new MockRoot();
        registry = new NullifierRegistry(address(this)); // this = governance
        source = new MockShieldedPool(root);
        root.mint(address(source), 1_000_000e18); // shielded pool's R00T backing

        // Deploy Land directly (this contract acts as the factory).
        land = new Land(Land.InitParams({
            steward: steward, root: address(root), usdc: address(root), treasury: treasury,
            validator: validator, poolManager: address(0), protocolTreasury: proto,
            poolFee: 3000, tickSpacing: 60, ethPriceE6: 3000_000000, rootPriceE6: 100000,
            name: "Pilot", region: "highlands",
            boundaryHash: keccak256("kmz"), topoHash: keccak256("topo"), cid: "ipfs://cid"
        }));
        vm.prank(validator); land.validate();
        vm.prank(steward); land.createParcel(PARCEL, "Oak Field", "OAK");
    }

    function _wireVault(PledgeVault vault) internal {
        vm.prank(steward); land.setPledgeVault(address(vault));
        // Authorize the vault on the shared registry and clear the auth cooldown.
        registry.setPoolAuthorization(address(vault), true);
        vm.warp(block.timestamp + 2 minutes);
    }

    function _readUint8(string memory json, string memory key) internal pure returns (uint256[8] memory out) {
        uint256[] memory a = json.readUintArray(key);
        require(a.length == 8, "proof len");
        for (uint256 i = 0; i < 8; i++) out[i] = a[i];
    }
}

/// @notice REAL groth16 proof suite — the security-critical behaviours from PHASE_C.md.
/// Fixtures are generated + off-chain verified by scripts/gen-pledge-claim-fixtures.mjs.
contract PledgeVaultRealProofTest is PledgeVaultBase {
    using stdJson for string;

    PledgeVault internal vault;

    // pledge fixture
    uint256[8] internal pProof;
    uint256[7] internal pPub;
    // claim fixture
    uint256[8] internal cProof;
    uint256[6] internal cPub;

    address internal funder;    // pledge creator binding (0xB0B)
    address internal claimer;   // claim recipient (0xCAFE), unlinked from funder

    function setUp() public {
        _deployLandWithParcel();
        vault = new PledgeVault(
            address(land), address(registry), address(source),
            address(new RealPledgeVerifier()), address(new RealClaimVerifier())
        );
        _wireVault(vault);

        string memory pj = vm.readFile("./test/fixtures/pledge_proof.json");
        pProof = _readUint8(pj, ".proof");
        uint256[] memory pp = pj.readUintArray(".pubSignals");
        require(pp.length == 7, "pledge pub len");
        for (uint256 i = 0; i < 7; i++) pPub[i] = pp[i];
        funder = address(uint160(pPub[6]));

        string memory cj = vm.readFile("./test/fixtures/claim_proof.json");
        cProof = _readUint8(cj, ".proof");
        uint256[] memory cp = cj.readUintArray(".pubSignals");
        require(cp.length == 6, "claim pub len");
        for (uint256 i = 0; i < 6; i++) cPub[i] = cp[i];
        claimer = address(uint160(cPub[5]));

        // The source note lives under this zkAMM root.
        source.setKnownRoot(pPub[2], true);
    }

    function _pledge() internal {
        vm.prank(funder);
        vault.pledgePrivate(PARCEL, pProof, pPub, hex"01");
    }

    function test_pledge_creditsTreasury_andRecordsCommitment() public {
        uint256 amount = pPub[4];
        assertEq(root.balanceOf(treasury), 0);
        _pledge();
        assertEq(root.balanceOf(treasury), amount, "100% of pledged R00T to treasury");
        assertEq(vault.raisedRootByParcel(PARCEL), amount, "raised recorded");
        assertTrue(vault.knownPledgeCommitment(pPub[0]), "pledge commitment recorded");
        // pledge tree now holds the commitment at leaf 0 → its root is the claim proof's root
        assertEq(vault.pledgeRoot(), cPub[1], "pledge tree root == claim proof root");
    }

    function test_happyPath_pledgeThenClaim_toUnlinkedWallet() public {
        _pledge();
        ParcelToken oak = ParcelToken(land.parcelToken(PARCEL));
        assertEq(oak.balanceOf(claimer), 0);

        // Anyone can submit the claim; tokens go to the proof-bound recipient (any wallet).
        vault.claim(cProof, cPub, claimer);

        assertEq(oak.balanceOf(claimer), cPub[4], "claim minted exactly the pledged amount");
        assertTrue(claimer != funder, "claim wallet is unlinked from the funding wallet");
        assertEq(vault.claimedRootByParcel(PARCEL), cPub[4], "claimed recorded");
    }

    function test_doubleClaim_REJECTED_bySharedNullifier() public {
        _pledge();
        vault.claim(cProof, cPub, claimer);
        vm.expectRevert(NullifierRegistry.NullifierAlreadySpent.selector);
        vault.claim(cProof, cPub, claimer);
    }

    /// CRITICAL-2 regression: a note spent on the zkAMM (sell) CANNOT also be pledged —
    /// the spend nullifier is marked in the SHARED registry, so the pledge is rejected.
    function test_CRITICAL2_crossSpend_zkAMMSellThenPledge_REJECTED() public {
        // Simulate the zkAMM selling the SAME note: an authorized zkAMM-role marks the note's
        // spend nullifier in the shared registry first.
        address mockZkAMM = address(0xDEAD);
        registry.setPoolAuthorization(mockZkAMM, true);
        vm.warp(block.timestamp + 2 minutes);
        vm.prank(mockZkAMM);
        registry.checkAndMark(pPub[3]); // pPub[3] = spend nullifierHash

        // The pledge of that same note must now revert on the shared nullifier.
        vm.prank(funder);
        vm.expectRevert(NullifierRegistry.NullifierAlreadySpent.selector);
        vault.pledgePrivate(PARCEL, pProof, pPub, hex"01");
    }

    function test_pledge_unknownSourceRoot_REJECTED() public {
        source.setKnownRoot(pPub[2], false);
        vm.prank(funder);
        vm.expectRevert(PledgeVault.UnknownMerkleRoot.selector);
        vault.pledgePrivate(PARCEL, pProof, pPub, hex"01");
    }

    function test_pledge_wrongCaller_creatorMismatch_REJECTED() public {
        vm.prank(address(0xBAD));
        vm.expectRevert(PledgeVault.CreatorMismatch.selector);
        vault.pledgePrivate(PARCEL, pProof, pPub, hex"01");
    }

    function test_pledge_tamperedProof_REJECTED() public {
        uint256[7] memory bad = pPub;
        bad[4] = bad[4] + 1; // claim a bigger pledgeAmount than the proof attests
        vm.prank(funder);
        vm.expectRevert(PledgeVault.InvalidProof.selector);
        vault.pledgePrivate(PARCEL, pProof, bad, hex"01");
    }

    function test_claim_wrongRecipient_bindingMismatch_REJECTED() public {
        _pledge();
        vm.expectRevert(PledgeVault.RecipientMismatch.selector);
        vault.claim(cProof, cPub, address(0xBAD)); // arg != proof-bound recipient
    }

    function test_claim_beforeAnyPledge_unknownRoot_REJECTED() public {
        vm.expectRevert(PledgeVault.UnknownMerkleRoot.selector);
        vault.claim(cProof, cPub, claimer);
    }
}

/// @notice Deterministic guard-path suite using permissive verifiers, to exercise branches
///         the real crypto makes unreachable (over-claim cap, field-range, duplicate).
contract PledgeVaultGuardTest is PledgeVaultBase {
    PledgeVault internal vault;
    uint256 internal constant FIELD =
        21888242871839275222246405745257275088548364400416034343698204186575808495617;

    address internal funder = address(0xB0B);

    function setUp() public {
        _deployLandWithParcel();
        vault = new PledgeVault(
            address(land), address(registry), address(source),
            address(new MockPledgeVerifier()), address(new MockClaimVerifier())
        );
        _wireVault(vault);
    }

    function _pubPledge(uint256 commitment, uint256 mroot, uint256 nul, uint256 amount)
        internal view returns (uint256[7] memory p)
    {
        p[0] = commitment;
        p[1] = 1; // binding (unchecked by mock)
        p[2] = mroot;
        p[3] = nul;
        p[4] = amount;
        p[5] = uint256(PARCEL);
        p[6] = uint256(uint160(funder));
    }

    function _pubClaim(uint256 mroot, uint256 nul, uint256 amount, address recipient)
        internal pure returns (uint256[6] memory p)
    {
        p[0] = 1; // binding
        p[1] = mroot;
        p[2] = nul;
        p[3] = uint256(PARCEL);
        p[4] = amount;
        p[5] = uint256(uint160(recipient));
    }

    function _emptyProof() internal pure returns (uint256[8] memory p) {}

    function test_overClaim_cap_REJECTED() public {
        uint256 mroot = 12345;
        source.setKnownRoot(mroot, true);
        // pledge 100 → raised = 100, commitment inserted at leaf 0
        vm.prank(funder);
        vault.pledgePrivate(PARCEL, _emptyProof(), _pubPledge(1001, mroot, 7001, 100), hex"");

        uint256 pRoot = vault.pledgeRoot();
        // claim 101 > raised(100) → OverClaim
        vm.expectRevert(PledgeVault.OverClaim.selector);
        vault.claim(_emptyProof(), _pubClaim(pRoot, 8001, 101, address(0xCAFE)), address(0xCAFE));
    }

    function test_duplicateCommitment_REJECTED() public {
        uint256 mroot = 22222;
        source.setKnownRoot(mroot, true);
        vm.prank(funder);
        vault.pledgePrivate(PARCEL, _emptyProof(), _pubPledge(555, mroot, 111, 100), hex"");
        // same commitment, DIFFERENT nullifier → isolates the DuplicateCommitment guard
        vm.prank(funder);
        vm.expectRevert(PledgeVault.DuplicateCommitment.selector);
        vault.pledgePrivate(PARCEL, _emptyProof(), _pubPledge(555, mroot, 222, 100), hex"");
    }

    function test_fieldRange_REJECTED() public {
        uint256 mroot = 33333;
        source.setKnownRoot(mroot, true);
        uint256[7] memory p = _pubPledge(1, mroot, 1, 100);
        p[0] = FIELD; // not a canonical field element
        vm.prank(funder);
        vm.expectRevert(PledgeVault.FieldRange.selector);
        vault.pledgePrivate(PARCEL, _emptyProof(), p, hex"");
    }

    function test_parcelMismatch_REJECTED() public {
        uint256 mroot = 44444;
        source.setKnownRoot(mroot, true);
        uint256[7] memory p = _pubPledge(1, mroot, 1, 100);
        p[5] = 99999999; // in-field, but != uint256(PARCEL) → ParcelMismatch (not FieldRange)
        vm.prank(funder);
        vm.expectRevert(PledgeVault.ParcelMismatch.selector);
        vault.pledgePrivate(PARCEL, _emptyProof(), p, hex"");
    }

    function test_mintParcel_onlyVault() public {
        vm.expectRevert(Land.NotVault.selector);
        land.mintParcel(PARCEL, address(0xCAFE), 1e18);
    }

    function test_setPledgeVault_isOneTime() public {
        vm.prank(steward);
        vm.expectRevert(bytes("set"));
        land.setPledgeVault(address(0x1234));
    }
}
