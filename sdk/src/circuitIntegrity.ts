/**
 * Circuit Integrity Hashes
 * Generated: 2026-01-15
 *
 * These hashes verify the integrity of ZK circuit artifacts.
 * Merkle Tree Depth: 24 (~16.7M commitment capacity)
 *
 * To regenerate:
 * 1. Compile circuits: cd circuits && ./compile.sh
 * 2. Run hash generation script
 *
 * These hashes should match the deployed verifier contracts.
 */

// Sell circuit (for selling tokens privately)
export const sellZKeyHash = 'abcc4643fdd38fc03c941eeab79d542df1ae5717eb0d74529dcc18b41ef4c9f7';
export const sellWasmHash = '12596c203a6489f02471ee9a37f1e804dc040cc0c880335d6ea0c376dc6fc7da';

// Transfer circuit (for private transfers between users)
export const transferZKeyHash = '802ec87e14958c59c7e255b18d2104369a722da692137f38251ad8e1b6a06b17';
export const transferWasmHash = 'ff993665e711780f1cc1b56d776db789c1aaa063ab04a25098269bdc7f53f62a';

// Withdraw circuit (for exiting privacy pool to public wallet)
export const withdrawZKeyHash = '7f2bcf09ddfc8cebf59ee5721746fa826c6ff379d0e279bfb7b6bee99b2626ab';
export const withdrawWasmHash = '5153185e751ceeac1bd7eefe23f55e19e45c7ed2c7cab18ed4ef5c354077b19d';

// Swap circuit (for swapping between pools)
export const swapZKeyHash = '61225289c5ff9bcbb0b237197238b99b3f5632ad8d9cffe5c337014c5a8f4b3a';
export const swapWasmHash = '4dbd848e04a24d2647e3bf768ed2fe3a0bb67e2c8117db0d42acfb9b9b1ceba7';

// Vote circuit (for private governance voting)
export const voteZKeyHash = 'de4e5d7562017163777a5bb41d423e20c77a66d794ca843cbe99244f342d6311';
export const voteWasmHash = 'd1cfe7a745e55af2159342dfed301bef44dca0d28947980a96257dffe0a03ea0';

// Add liquidity circuit (for adding LP positions privately)
export const addLiquidityZKeyHash = '5cc6929b3b3d597c211dce96e66466b83981d3b7b8524bcaa85f76629dde9c5e';
export const addLiquidityWasmHash = 'ebdfdea0c97a73820b4b5bd64ed4510c1beca22307e89939378556ca70f868ad';

// Remove liquidity circuit (for removing LP positions privately)
export const removeLiquidityZKeyHash = '6ed63b577fcfb3592a26b3073ce6ba04419cce5ca89c4e644013e2e956066768';
export const removeLiquidityWasmHash = '1d78215e65dbd33c8c53f00d5681ced31cf221fe6668048cebeb48ec0ac556d3';

// Claim LP fees circuit (for claiming LP fee rewards)
export const claimLPFeesZKeyHash = '839a6ed8145e6298d3ecac91504658e64f015105bd646a63700f00070aed5ac9';
export const claimLPFeesWasmHash = 'ad6627b30f4456b46e1e77642f6f3d26b39bf36be0a6550502446a95dc631576';

// Export all hashes for verification
export const circuitHashes = {
  sell: { zkey: sellZKeyHash, wasm: sellWasmHash },
  transfer: { zkey: transferZKeyHash, wasm: transferWasmHash },
  withdraw: { zkey: withdrawZKeyHash, wasm: withdrawWasmHash },
  swap: { zkey: swapZKeyHash, wasm: swapWasmHash },
  vote: { zkey: voteZKeyHash, wasm: voteWasmHash },
  addLiquidity: { zkey: addLiquidityZKeyHash, wasm: addLiquidityWasmHash },
  removeLiquidity: { zkey: removeLiquidityZKeyHash, wasm: removeLiquidityWasmHash },
  claimLPFees: { zkey: claimLPFeesZKeyHash, wasm: claimLPFeesWasmHash },
} as const;

// Merkle tree configuration
export const MERKLE_DEPTH = 24;
export const MAX_COMMITMENTS = 2 ** MERKLE_DEPTH; // 16,777,216
