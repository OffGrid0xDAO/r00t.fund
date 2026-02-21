/**
 * R00tPolicyEngine ABI — On-chain compliance oracle (Chainlink ACE pattern)
 * Used by W6 CRE workflow to check transfer compliance via eth_call
 */
export const R00tPolicyEngineABI = [
  // Core compliance check (called by CRE DON via EVMClient.callContract)
  {
    type: "function",
    name: "checkPrivateTransferAllowed",
    inputs: [
      { name: "fromHash", type: "bytes32" },
      { name: "toHash", type: "bytes32" },
      { name: "amount", type: "uint256" },
      { name: "transferType", type: "uint8" },
    ],
    outputs: [
      { name: "allowed", type: "bool" },
      { name: "reason", type: "string" },
    ],
    stateMutability: "view",
  },
  // Compliance attestation (called by CRE DON)
  {
    type: "function",
    name: "attestCompliance",
    inputs: [
      { name: "addressHash", type: "bytes32" },
      { name: "level", type: "uint8" },
      { name: "validityPeriod", type: "uint256" },
      { name: "attestationHash", type: "bytes32" },
      { name: "sanctionsCleared", type: "bool" },
      { name: "jurisdictionHash", type: "bytes32" },
      { name: "riskScore", type: "uint8" },
    ],
    outputs: [],
    stateMutability: "nonpayable",
  },
  // Record transfer volume
  {
    type: "function",
    name: "recordTransferVolume",
    inputs: [
      { name: "addressHash", type: "bytes32" },
      { name: "amount", type: "uint256" },
    ],
    outputs: [],
    stateMutability: "nonpayable",
  },
  // View functions
  {
    type: "function",
    name: "getAttestation",
    inputs: [{ name: "addressHash", type: "bytes32" }],
    outputs: [
      {
        name: "",
        type: "tuple",
        components: [
          { name: "level", type: "uint8" },
          { name: "attestedAt", type: "uint256" },
          { name: "expiresAt", type: "uint256" },
          { name: "attestationHash", type: "bytes32" },
          { name: "sanctionsCleared", type: "bool" },
          { name: "jurisdictionApproved", type: "bool" },
          { name: "riskScore", type: "uint8" },
          { name: "active", type: "bool" },
        ],
      },
    ],
    stateMutability: "view",
  },
  {
    type: "function",
    name: "isCompliant",
    inputs: [{ name: "addressHash", type: "bytes32" }],
    outputs: [{ name: "", type: "bool" }],
    stateMutability: "view",
  },
  {
    type: "function",
    name: "getComplianceLevel",
    inputs: [{ name: "addressHash", type: "bytes32" }],
    outputs: [{ name: "", type: "uint8" }],
    stateMutability: "view",
  },
  {
    type: "function",
    name: "getDailyVolume",
    inputs: [{ name: "addressHash", type: "bytes32" }],
    outputs: [{ name: "", type: "uint256" }],
    stateMutability: "view",
  },
  {
    type: "function",
    name: "getPolicy",
    inputs: [{ name: "transferType", type: "uint8" }],
    outputs: [
      {
        name: "",
        type: "tuple",
        components: [
          { name: "minLevel", type: "uint8" },
          { name: "maxAmountPerTx", type: "uint256" },
          { name: "maxAmountPerDay", type: "uint256" },
          { name: "maxRiskScore", type: "uint8" },
          { name: "requireSanctionsCheck", type: "bool" },
          { name: "requireJurisdiction", type: "bool" },
          { name: "active", type: "bool" },
        ],
      },
    ],
    stateMutability: "view",
  },
  {
    type: "function",
    name: "totalAttestations",
    inputs: [],
    outputs: [{ name: "", type: "uint256" }],
    stateMutability: "view",
  },
  {
    type: "function",
    name: "totalAuthorized",
    inputs: [],
    outputs: [{ name: "", type: "uint256" }],
    stateMutability: "view",
  },
  {
    type: "function",
    name: "totalDenied",
    inputs: [],
    outputs: [{ name: "", type: "uint256" }],
    stateMutability: "view",
  },
  // Events
  {
    type: "event",
    name: "ComplianceAttested",
    inputs: [
      { name: "addressHash", type: "bytes32", indexed: true },
      { name: "level", type: "uint8", indexed: false },
      { name: "expiresAt", type: "uint256", indexed: false },
      { name: "attestationHash", type: "bytes32", indexed: false },
    ],
  },
  {
    type: "event",
    name: "ComplianceRevoked",
    inputs: [
      { name: "addressHash", type: "bytes32", indexed: true },
      { name: "reason", type: "string", indexed: false },
    ],
  },
  {
    type: "event",
    name: "TransferAuthorized",
    inputs: [
      { name: "fromHash", type: "bytes32", indexed: true },
      { name: "toHash", type: "bytes32", indexed: true },
      { name: "transferType", type: "uint8", indexed: false },
      { name: "amount", type: "uint256", indexed: false },
    ],
  },
  {
    type: "event",
    name: "TransferDenied",
    inputs: [
      { name: "fromHash", type: "bytes32", indexed: true },
      { name: "toHash", type: "bytes32", indexed: true },
      { name: "transferType", type: "uint8", indexed: false },
      { name: "reason", type: "string", indexed: false },
    ],
  },
] as const;
