// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// @notice Minimal World ID Router interface (classic Proof-of-Human / uniqueness). Reverts on an
///         invalid proof. Router deployed per chain by Worldcoin.
interface IWorldID {
    function verifyProof(
        uint256 root,
        uint256 groupId,
        uint256 signalHash,
        uint256 nullifierHash,
        uint256 externalNullifierHash,
        uint256[8] calldata proof
    ) external view;
}

/// @title StewardGatekeeper  (ETHGlobal Lisbon 2026 — HACKATHON WORKSPACE)
/// @notice On-chain eligibility gate for r00t.fund stewards, layering three World credentials:
///           1. Proof-of-Human (uniqueness) — verified ON-CHAIN here via IWorldID.verifyProof, so one
///              real unique human = one steward identity (sybil-resistant fair launches).
///           2. Selfie Check + Identity Check (World ID 4.0, cloud-verified via the Developer Portal
///              /verify API) — their RESULTS are relayed on-chain by a trusted `attester` (the app
///              backend that ran /verify): a live-human selfie flag + a data-minimized jurisdiction/age
///              eligibility BOOLEAN (never the identity itself).
///           3. AgentKit human-backed agents — the attester registers an agent wallet as backed by an
///              already-eligible human steward (AgentBook on World Chain), so an autonomous keeper can
///              act with the human's launch/treasury authority.
///         RegenLaunchpad.createParcel requires `isEligibleSteward(caller)`.
/// @dev Selfie/Identity Check 4.0 credentials aren't on-chain-verifiable yet (beta), so their cloud
///      verification result is attester-relayed. PoH is the on-chain-enforced backbone.
contract StewardGatekeeper {
    IWorldID public immutable worldId;
    uint256 public immutable externalNullifier; // hash(app_id, action) for the PoH action
    uint256 public constant GROUP_ID = 1;        // 1 = Orb (Proof of Human)

    address public owner;
    address public attester; // app backend that ran the World /verify cloud API

    struct Steward {
        bool human;          // on-chain PoH verified (unique human)
        bool selfie;         // Selfie Check passed (live human), cloud-verified
        bool jurisdictionOK; // Identity Check: allowed jurisdiction (data-minimized boolean)
        bool ageOK;          // Identity Check: minimum age met
    }

    mapping(address => Steward) public stewards;
    mapping(uint256 => bool) public nullifierUsed;   // PoH nullifier → prevents a human reusing across addresses
    mapping(address => address) public agentBackedBy; // human-backed agent wallet → the human steward it acts for

    event HumanVerified(address indexed steward, uint256 nullifierHash);
    event Attested(address indexed steward, bool selfie, bool jurisdictionOK, bool ageOK);
    event AgentRegistered(address indexed agent, address indexed humanSteward);

    error NotOwner();
    error NotAttester();
    error NullifierAlreadyUsed();

    modifier onlyOwner() { if (msg.sender != owner) revert NotOwner(); _; }
    modifier onlyAttester() { if (msg.sender != attester) revert NotAttester(); _; }

    constructor(IWorldID _worldId, uint256 _externalNullifier, address _attester) {
        worldId = _worldId;
        externalNullifier = _externalNullifier;
        attester = _attester;
        owner = msg.sender;
    }

    function setAttester(address a) external onlyOwner { attester = a; }
    function setOwner(address o) external onlyOwner { owner = o; }

    /// @notice Verify Proof-of-Human ON-CHAIN and bind it to `steward`. One human (nullifier) can back
    ///         exactly one steward address. `signal` = the steward address, so the proof is bound to it.
    function verifyHuman(address steward, uint256 root, uint256 nullifierHash, uint256[8] calldata proof) external {
        if (nullifierUsed[nullifierHash]) revert NullifierAlreadyUsed();
        // signalHash = keccak256(abi.encodePacked(steward)) >> 8 (Worldcoin hashToField convention)
        uint256 signalHash = uint256(keccak256(abi.encodePacked(steward))) >> 8;
        worldId.verifyProof(root, GROUP_ID, signalHash, nullifierHash, externalNullifier, proof); // reverts if invalid
        nullifierUsed[nullifierHash] = true;
        stewards[steward].human = true;
        emit HumanVerified(steward, nullifierHash);
    }

    /// @notice Relay the cloud-verified Selfie Check + Identity Check result for a steward. Only the
    ///         app backend (attester) that ran World's /verify API may call this.
    function attest(address steward, bool selfie, bool jurisdictionOK, bool ageOK) external onlyAttester {
        Steward storage s = stewards[steward];
        s.selfie = selfie;
        s.jurisdictionOK = jurisdictionOK;
        s.ageOK = ageOK;
        emit Attested(steward, selfie, jurisdictionOK, ageOK);
    }

    /// @notice Register a human-backed agent wallet (AgentKit/AgentBook) that acts for `humanSteward`.
    function registerAgent(address agent, address humanSteward) external onlyAttester {
        agentBackedBy[agent] = humanSteward;
        emit AgentRegistered(agent, humanSteward);
    }

    /// @notice Full eligibility: a unique human that passed Selfie + Identity (jurisdiction & age).
    function isEligibleSteward(address who) public view returns (bool) {
        address subject = agentBackedBy[who] == address(0) ? who : agentBackedBy[who]; // agents inherit their human's eligibility
        Steward memory s = stewards[subject];
        return s.human && s.selfie && s.jurisdictionOK && s.ageOK;
    }
}
