/**
 * ACE PolicyEngine ABI — Official Chainlink ACE (Anonymous Compliant Exchange)
 * From @chainlink/policy-management/core/PolicyEngine.sol
 * Used by W6 CRE workflow to check compliance via CompliantPrivateVault.checkCompliance()
 */
export const ACEPolicyEngineABI = [
  // Core compliance check (view — called via eth_call)
  {
    type: "function",
    name: "check",
    inputs: [
      {
        name: "payload",
        type: "tuple",
        components: [
          { name: "selector", type: "bytes4" },
          { name: "sender", type: "address" },
          { name: "data", type: "bytes" },
          { name: "context", type: "bytes" },
        ],
      },
    ],
    outputs: [{ name: "result", type: "uint8" }],
    stateMutability: "view",
  },
  // Execute compliance check with state changes
  {
    type: "function",
    name: "run",
    inputs: [
      {
        name: "payload",
        type: "tuple",
        components: [
          { name: "selector", type: "bytes4" },
          { name: "sender", type: "address" },
          { name: "data", type: "bytes" },
          { name: "context", type: "bytes" },
        ],
      },
    ],
    outputs: [{ name: "result", type: "uint8" }],
    stateMutability: "nonpayable",
  },
] as const;
