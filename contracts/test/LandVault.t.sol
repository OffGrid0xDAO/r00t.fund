// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {LandVault} from "../src/LandVault.sol";
import {ILandDepositVerifier, IClaimVerifier} from "../src/interfaces/IVerifier.sol";
import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";

// ── mocks ─────────────────────────────────────────────────────────────────────
contract MockRoot is ERC20 {
    constructor() ERC20("Root", "R00T") {}
    function mint(address to, uint256 a) external { _mint(to, a); }
}

contract MockUSDC is ERC20 {
    constructor() ERC20("USDG", "USDG") {}
    function mint(address to, uint256 a) external { _mint(to, a); }
    function decimals() public pure override returns (uint8) { return 6; }
}

/// Minimal Land the vault talks to. Records parcel-token mints so tests can assert.
contract MockLand {
    address public steward;
    address public treasury;
    uint256 public rootPriceE6 = 100000; // $0.10
    uint256 public ethPriceE6 = 3000_000000; // $3000
    uint256 public mintRateE18 = 1e18; // 1 parcel token per R00T-eq
    mapping(bytes32 => address) public tokenOf;
    mapping(address => uint256) public parcelMinted; // recipient => total parcel tokens
    bytes32 public lastParcel;

    constructor(address _steward, address _treasury) { steward = _steward; treasury = _treasury; }
    function setParcel(bytes32 id, address token) external { tokenOf[id] = token; }
    function parcelToken(bytes32 id) external view returns (address) { return tokenOf[id]; }
    function setRootPrice(uint256 v) external { rootPriceE6 = v; }
    function mintParcel(bytes32 id, address to, uint256 amount) external {
        require(tokenOf[id] != address(0), "no parcel");
        parcelMinted[to] += amount;
        lastParcel = id;
    }
}

contract MockNR {
    mapping(uint256 => bool) public spent;
    function checkAndMark(uint256 n) external returns (bool) {
        require(!spent[n], "already spent");
        spent[n] = true;
        return false;
    }
    function isSpent(uint256 n) external view returns (bool) { return spent[n]; }
}

contract MockDepositV is ILandDepositVerifier {
    bool public ok = true;
    function set(bool v) external { ok = v; }
    function verifyProof(uint256[8] calldata, uint256[4] calldata) external view returns (bool) { return ok; }
}

contract MockClaimV is IClaimVerifier {
    bool public ok = true;
    function set(bool v) external { ok = v; }
    function verifyProof(uint256[8] calldata, uint256[6] calldata) external view returns (bool) { return ok; }
}

contract LandVaultTest is Test {
    LandVault vault;
    MockRoot root;
    MockUSDC usdc;
    MockLand land;
    MockNR nr;
    MockDepositV dv;
    MockClaimV cv;

    address steward = address(0x57E);
    address treasury = address(0x7EA);
    address backer = address(0xBACE);
    address claimWallet = address(0xC1A1);

    bytes32 constant PARCEL = bytes32(uint256(0x0A11));
    uint256[8] PROOF; // mock proof (verifier is mocked)

    function setUp() public {
        root = new MockRoot();
        usdc = new MockUSDC();
        land = new MockLand(steward, treasury);
        nr = new MockNR();
        dv = new MockDepositV();
        cv = new MockClaimV();
        vault = new LandVault(address(land), address(root), address(usdc), address(nr), address(dv), address(cv));
        land.setParcel(PARCEL, address(0xF00D)); // parcel exists

        // steward bonds 1,000,000 R00T reserve
        root.mint(steward, 1_000_000e18);
        vm.startPrank(steward);
        root.approve(address(vault), type(uint256).max);
        vault.fundReserve(1_000_000e18);
        vm.stopPrank();

        vm.deal(backer, 100 ether);
    }

    // pubSignals for claim: [recipientBinding, merkleRoot, nullifierHash, parcelId, amount, recipient]
    function _claimPub(uint256 root_, uint256 nul, bytes32 parcel, uint256 amount, address rcpt)
        internal pure returns (uint256[6] memory p)
    {
        p[0] = 1; // recipientBinding (mock verifier ignores)
        p[1] = root_;
        p[2] = nul;
        p[3] = uint256(parcel);
        p[4] = amount;
        p[5] = uint256(uint160(rcpt));
    }

    function _fundETH(uint256 rootOut, uint256 commitment) internal {
        uint256 num = rootOut * land.rootPriceE6(); uint256 ethNeeded = (num + land.ethPriceE6() - 1) / land.ethPriceE6();
        vm.prank(backer);
        vault.otcFundETH{value: ethNeeded + 1}(PARCEL, rootOut, commitment, 1, PROOF, "");
    }

    // ── happy paths ────────────────────────────────────────────────────────────
    function test_fund_routesEthToTreasury_reservesR00T() public {
        uint256 rootOut = 1000e18;
        uint256 tBefore = treasury.balance;
        _fundETH(rootOut, 111);
        uint256 num = rootOut * land.rootPriceE6(); uint256 ethNeeded = (num + land.ethPriceE6() - 1) / land.ethPriceE6();
        assertEq(treasury.balance - tBefore, ethNeeded, "100% of required ETH to treasury");
        assertEq(vault.committedR00T(), rootOut, "R00T reserved");
        assertEq(vault.raisedR00TByParcel(PARCEL), rootOut, "raised tracked");
    }

    function test_fund_refundsExcessEth() public {
        uint256 rootOut = 1000e18;
        uint256 num = rootOut * land.rootPriceE6(); uint256 ethNeeded = (num + land.ethPriceE6() - 1) / land.ethPriceE6();
        uint256 bBefore = backer.balance;
        vm.prank(backer);
        vault.otcFundETH{value: ethNeeded + 5 ether}(PARCEL, rootOut, 222, 1, PROOF, "");
        assertEq(bBefore - backer.balance, ethNeeded, "only ethNeeded spent; excess refunded");
    }

    function test_claimR00T_afterFullyFunded_paysToAnyWallet() public {
        uint256 rootOut = 1000e18;
        _fundETH(rootOut, 333);
        vm.prank(steward);
        vault.setParcelTarget(PARCEL, 1000e18); // target met by the single fund

        uint256 mroot = vault.pledgeRoot();
        vm.prank(claimWallet);
        vault.claimR00T(PROOF, _claimPub(mroot, 7, PARCEL, rootOut, claimWallet), claimWallet);

        assertEq(root.balanceOf(claimWallet), rootOut, "R00T paid to unlinked wallet");
        assertEq(vault.committedR00T(), 0, "liability cleared");
        assertEq(vault.reserveR00T(), 1_000_000e18 - rootOut, "reserve debited");
    }

    function test_claimParcelToken_mintsAtRate_freesReserve() public {
        uint256 rootOut = 1000e18;
        _fundETH(rootOut, 444);
        uint256 mroot = vault.pledgeRoot();
        vm.prank(claimWallet);
        vault.claimParcelToken(PROOF, _claimPub(mroot, 8, PARCEL, rootOut, claimWallet), claimWallet);

        assertEq(land.parcelMinted(claimWallet), rootOut, "parcel tokens minted at mintRate 1e18");
        assertEq(vault.committedR00T(), 0, "R00T liability freed");
        assertEq(vault.reserveR00T(), 1_000_000e18, "reserve untouched (freed R00T stays)");
    }

    // ── attack cases (must REVERT) ───────────────────────────────────────────────
    function test_doubleClaim_REJECTED_sharedNullifier() public {
        _fundETH(1000e18, 555);
        vm.prank(steward);
        vault.setParcelTarget(PARCEL, 1000e18);
        uint256 mroot = vault.pledgeRoot();
        vm.prank(claimWallet);
        vault.claimR00T(PROOF, _claimPub(mroot, 9, PARCEL, 1000e18, claimWallet), claimWallet);
        // second claim with the SAME nullifier (R00T or parcel) must revert
        vm.prank(claimWallet);
        vm.expectRevert(bytes("already spent"));
        vault.claimParcelToken(PROOF, _claimPub(mroot, 9, PARCEL, 1000e18, claimWallet), claimWallet);
    }

    function test_claimR00T_beforeFullyFunded_REJECTED() public {
        _fundETH(1000e18, 666);
        vm.prank(steward);
        vault.setParcelTarget(PARCEL, 5000e18); // target NOT met
        uint256 mroot = vault.pledgeRoot();
        vm.prank(claimWallet);
        vm.expectRevert(LandVault.NotFullyFunded.selector);
        vault.claimR00T(PROOF, _claimPub(mroot, 10, PARCEL, 1000e18, claimWallet), claimWallet);
    }

    function test_overCommit_beyondReserve_REJECTED() public {
        // reserve is 1,000,000e18; funding more than that must revert
        uint256 tooMuch = 1_000_001e18;
        uint256 ethNeeded = tooMuch * land.rootPriceE6() / land.ethPriceE6();
        vm.deal(backer, ethNeeded + 1 ether);
        vm.prank(backer);
        vm.expectRevert(LandVault.OverCommitted.selector);
        vault.otcFundETH{value: ethNeeded + 1}(PARCEL, tooMuch, 777, 1, PROOF, "");
    }

    function test_duplicateCommitment_REJECTED() public {
        _fundETH(1000e18, 888);
        uint256 ethNeeded = 1000e18 * land.rootPriceE6() / land.ethPriceE6();
        vm.prank(backer);
        vm.expectRevert(LandVault.DuplicateCommitment.selector);
        vault.otcFundETH{value: ethNeeded + 1}(PARCEL, 1000e18, 888, 1, PROOF, "");
    }

    function test_invalidDepositProof_REJECTED() public {
        dv.set(false);
        uint256 ethNeeded = 1000e18 * land.rootPriceE6() / land.ethPriceE6();
        vm.prank(backer);
        vm.expectRevert(LandVault.InvalidProof.selector);
        vault.otcFundETH{value: ethNeeded + 1}(PARCEL, 1000e18, 999, 1, PROOF, "");
    }

    function test_fund_unknownParcel_REJECTED() public {
        bytes32 ghost = bytes32(uint256(0xDEAD));
        uint256 ethNeeded = 1000e18 * land.rootPriceE6() / land.ethPriceE6();
        vm.prank(backer);
        vm.expectRevert(LandVault.UnknownParcel.selector);
        vault.otcFundETH{value: ethNeeded + 1}(ghost, 1000e18, 1001, 1, PROOF, "");
    }

    function test_insufficientPayment_REJECTED() public {
        uint256 rootOut = 1000e18;
        uint256 num = rootOut * land.rootPriceE6(); uint256 ethNeeded = (num + land.ethPriceE6() - 1) / land.ethPriceE6();
        vm.prank(backer);
        vm.expectRevert(LandVault.InsufficientPayment.selector);
        vault.otcFundETH{value: ethNeeded - 1}(PARCEL, rootOut, 1002, 1, PROOF, "");
    }

    function test_claim_recipientBindingMismatch_REJECTED() public {
        _fundETH(1000e18, 1003);
        vm.prank(steward);
        vault.setParcelTarget(PARCEL, 1000e18);
        uint256 mroot = vault.pledgeRoot();
        // pubSignals recipient field points at a DIFFERENT address than the arg
        uint256[6] memory p = _claimPub(mroot, 11, PARCEL, 1000e18, address(0xBEEF));
        vm.prank(claimWallet);
        vm.expectRevert(LandVault.RecipientMismatch.selector);
        vault.claimR00T(PROOF, p, claimWallet);
    }

    function test_claim_fieldRange_REJECTED() public {
        _fundETH(1000e18, 1004);
        vm.prank(steward);
        vault.setParcelTarget(PARCEL, 1000e18);
        uint256[6] memory p = _claimPub(vault.pledgeRoot(), 12, PARCEL, 1000e18, claimWallet);
        p[2] = vault.SNARK_SCALAR_FIELD(); // nullifier out of field
        vm.prank(claimWallet);
        vm.expectRevert(LandVault.FieldRange.selector);
        vault.claimR00T(PROOF, p, claimWallet);
    }

    function test_claim_unknownRoot_REJECTED() public {
        _fundETH(1000e18, 1005);
        vm.prank(steward);
        vault.setParcelTarget(PARCEL, 1000e18);
        uint256[6] memory p = _claimPub(999999, 13, PARCEL, 1000e18, claimWallet); // bogus root
        vm.prank(claimWallet);
        vm.expectRevert(LandVault.UnknownMerkleRoot.selector);
        vault.claimR00T(PROOF, p, claimWallet);
    }

    // ── reserve solvency / withdrawal guard ──────────────────────────────────────
    function test_withdrawReserve_cannotTouchCommitted() public {
        _fundETH(1000e18, 1006); // commits 1000e18
        uint256 free = vault.reserveR00T() - vault.committedR00T();
        vm.prank(steward);
        vm.expectRevert(LandVault.InsufficientReserve.selector);
        vault.withdrawReserve(steward, free + 1);
        // withdrawing exactly free works
        vm.prank(steward);
        vault.withdrawReserve(steward, free);
        assertEq(vault.reserveR00T(), vault.committedR00T(), "only committed remains");
    }

    // ── access control ───────────────────────────────────────────────────────────
    function test_onlySteward_guards() public {
        vm.startPrank(backer);
        vm.expectRevert(LandVault.NotSteward.selector); vault.fundReserve(1);
        vm.expectRevert(LandVault.NotSteward.selector); vault.withdrawReserve(backer, 1);
        vm.expectRevert(LandVault.NotSteward.selector); vault.setParcelTarget(PARCEL, 1);
        vm.expectRevert(LandVault.NotSteward.selector); vault.pause();
        vm.stopPrank();
    }

    function test_usdc_fund_routesToTreasury() public {
        uint256 rootOut = 1000e18;
        uint256 usdcNeeded = rootOut * land.rootPriceE6() / 1e18; // 6dp
        usdc.mint(backer, usdcNeeded);
        vm.startPrank(backer);
        usdc.approve(address(vault), usdcNeeded);
        vault.otcFundUSDC(PARCEL, rootOut, 2001, 1, PROOF, "");
        vm.stopPrank();
        assertEq(usdc.balanceOf(treasury), usdcNeeded, "100% USDC to treasury");
        assertEq(vault.committedR00T(), rootOut, "R00T reserved");
    }
}
