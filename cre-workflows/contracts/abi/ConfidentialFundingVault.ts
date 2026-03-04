// ConfidentialFundingVault ABI — W1: Privacy Track callback contract
export const ConfidentialFundingVaultABI = [
  {
    type: "function",
    name: "receiveReport",
    inputs: [
      { name: "proposalId", type: "uint256" },
      { name: "impactScore", type: "uint256" },
      { name: "attestationHash", type: "bytes32" },
      { name: "encryptedAttestation", type: "bytes" },
    ],
    outputs: [],
    stateMutability: "nonpayable",
  },
  {
    type: "function",
    name: "getProjectAttestation",
    inputs: [{ name: "proposalId", type: "uint256" }],
    outputs: [
      { name: "impactScore", type: "uint256" },
      { name: "attestationHash", type: "bytes32" },
      { name: "timestamp", type: "uint256" },
      { name: "verified", type: "bool" },
    ],
    stateMutability: "view",
  },
  {
    type: "function",
    name: "getTotalVerifiedCredits",
    inputs: [],
    outputs: [{ name: "", type: "uint256" }],
    stateMutability: "view",
  },
  {
    type: "function",
    name: "getTotalCreditValueEur",
    inputs: [],
    outputs: [{ name: "", type: "uint256" }],
    stateMutability: "view",
  },
  {
    type: "event",
    name: "ConfidentialFundingDistributed",
    inputs: [
      { name: "proposalId", type: "uint256", indexed: true },
      { name: "impactScore", type: "uint256", indexed: false },
      { name: "attestationHash", type: "bytes32", indexed: false },
    ],
  },
] as const;
