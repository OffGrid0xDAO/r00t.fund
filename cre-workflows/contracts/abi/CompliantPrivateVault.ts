/**
 * CompliantPrivateVault ABI — Privacy-preserving vault with CRE compliance
 * Adapted from Chainlink ACE (Anonymous Compliant Exchange) pattern
 */
export const CompliantPrivateVaultABI = [
  // User functions
  {
    type: "function",
    name: "requestDeposit",
    inputs: [
      { name: "commitment", type: "uint256" },
      { name: "addressHash", type: "bytes32" },
      { name: "encryptedNote", type: "bytes" },
    ],
    outputs: [{ name: "requestId", type: "uint256" }],
    stateMutability: "payable",
  },
  {
    type: "function",
    name: "requestVaultTransfer",
    inputs: [
      { name: "commitment", type: "uint256" },
      { name: "senderHash", type: "bytes32" },
      { name: "recipientHash", type: "bytes32" },
      { name: "encryptedNote", type: "bytes" },
    ],
    outputs: [{ name: "requestId", type: "uint256" }],
    stateMutability: "payable",
  },
  {
    type: "function",
    name: "cancelRequest",
    inputs: [{ name: "requestId", type: "uint256" }],
    outputs: [],
    stateMutability: "nonpayable",
  },
  // CRE DON callbacks
  {
    type: "function",
    name: "authorizeTransfer",
    inputs: [{ name: "requestId", type: "uint256" }],
    outputs: [],
    stateMutability: "nonpayable",
  },
  {
    type: "function",
    name: "denyTransfer",
    inputs: [
      { name: "requestId", type: "uint256" },
      { name: "reason", type: "string" },
    ],
    outputs: [],
    stateMutability: "nonpayable",
  },
  {
    type: "function",
    name: "batchAuthorize",
    inputs: [{ name: "requestIds", type: "uint256[]" }],
    outputs: [],
    stateMutability: "nonpayable",
  },
  // View functions
  {
    type: "function",
    name: "getRequest",
    inputs: [{ name: "requestId", type: "uint256" }],
    outputs: [
      {
        name: "",
        type: "tuple",
        components: [
          { name: "requestType", type: "uint8" },
          { name: "status", type: "uint8" },
          { name: "requester", type: "address" },
          { name: "amount", type: "uint256" },
          { name: "commitment", type: "uint256" },
          { name: "senderHash", type: "bytes32" },
          { name: "recipientHash", type: "bytes32" },
          { name: "encryptedNote", type: "bytes" },
          { name: "requestedAt", type: "uint256" },
          { name: "expiresAt", type: "uint256" },
          { name: "denyReason", type: "string" },
        ],
      },
    ],
    stateMutability: "view",
  },
  {
    type: "function",
    name: "getRequestStatus",
    inputs: [{ name: "requestId", type: "uint256" }],
    outputs: [{ name: "", type: "uint8" }],
    stateMutability: "view",
  },
  {
    type: "function",
    name: "getVaultStats",
    inputs: [],
    outputs: [
      { name: "_totalDeposits", type: "uint256" },
      { name: "_totalWithdrawals", type: "uint256" },
      { name: "_totalDenied", type: "uint256" },
      { name: "_totalVolume", type: "uint256" },
      { name: "_pendingETH", type: "uint256" },
      { name: "_totalRequests", type: "uint256" },
    ],
    stateMutability: "view",
  },
  {
    type: "function",
    name: "nextRequestId",
    inputs: [],
    outputs: [{ name: "", type: "uint256" }],
    stateMutability: "view",
  },
  {
    type: "function",
    name: "pendingDepositETH",
    inputs: [],
    outputs: [{ name: "", type: "uint256" }],
    stateMutability: "view",
  },
  {
    type: "function",
    name: "totalComplianceVolume",
    inputs: [],
    outputs: [{ name: "", type: "uint256" }],
    stateMutability: "view",
  },
  // Events
  {
    type: "event",
    name: "PrivateTransferRequested",
    inputs: [
      { name: "requestId", type: "uint256", indexed: true },
      { name: "requestType", type: "uint8", indexed: false },
      { name: "senderHash", type: "bytes32", indexed: true },
      { name: "recipientHash", type: "bytes32", indexed: true },
      { name: "amount", type: "uint256", indexed: false },
      { name: "commitment", type: "uint256", indexed: false },
    ],
  },
  {
    type: "event",
    name: "TransferAuthorized",
    inputs: [
      { name: "requestId", type: "uint256", indexed: true },
      { name: "requestType", type: "uint8", indexed: false },
      { name: "commitment", type: "uint256", indexed: false },
      { name: "leafIndex", type: "uint256", indexed: false },
    ],
  },
  {
    type: "event",
    name: "TransferDenied",
    inputs: [
      { name: "requestId", type: "uint256", indexed: true },
      { name: "requestType", type: "uint8", indexed: false },
      { name: "reason", type: "string", indexed: false },
    ],
  },
  {
    type: "event",
    name: "TransferExpired",
    inputs: [
      { name: "requestId", type: "uint256", indexed: true },
      { name: "requestType", type: "uint8", indexed: false },
    ],
  },
  {
    type: "event",
    name: "TransferCancelled",
    inputs: [
      { name: "requestId", type: "uint256", indexed: true },
      { name: "requester", type: "address", indexed: true },
    ],
  },
  {
    type: "event",
    name: "DepositRefunded",
    inputs: [
      { name: "requestId", type: "uint256", indexed: true },
      { name: "requester", type: "address", indexed: true },
      { name: "amount", type: "uint256", indexed: false },
    ],
  },
] as const;
