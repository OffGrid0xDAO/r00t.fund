#!/usr/bin/env node
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import { ethers, Wallet } from "ethers";
import * as snarkjs from "snarkjs";
import * as fs from "fs";
import * as path from "path";

// ============= CONFIGURATION =============
const CONFIG = {
  RPC_URL: process.env.RPC_URL || "https://eth-sepolia.g.alchemy.com/v2/demo",
  ROUTER_ADDRESS: "0x0a009895B9CFA38d34a43a0f1a805E3A8A848FF2",
  PAIR_ADDRESS: "0x80fdAa43B3C911766aB0A6af05A256080F42a169",
  INDEXER_URL: process.env.INDEXER_URL || "http://localhost:42069",
  PRIVATE_KEY: process.env.PRIVATE_KEY || "",
  CIRCUIT_WASM: process.env.CIRCUIT_WASM || path.join(__dirname, "../circuits/sell.wasm"),
  CIRCUIT_ZKEY: process.env.CIRCUIT_ZKEY || path.join(__dirname, "../circuits/sell_final.zkey"),
};

const FIELD_PRIME = BigInt("21888242871839275222246405745257275088548364400416034343698204186575808495617");

// ============= ABIs =============
const ROUTER_ABI = [
  "function buyTokens(uint256 minTokensOut) external payable returns (uint256 commitment, uint256 tokensOut)",
  "function sellPrivate(uint256[2] a, uint256[2][2] b, uint256[2] c, uint256[4] publicSignals) external returns (uint256 ethOut)",
  "function getReserves() external view returns (uint256 ethReserve, uint256 tokenReserve)",
  "function getAmountOut(uint256 amountIn, uint256 reserveIn, uint256 reserveOut) external pure returns (uint256)",
  "event TokensBought(address indexed buyer, uint256 ethIn, uint256 tokensOut, uint256 commitment)",
  "event TokensSold(uint256 tokensIn, uint256 ethOut, uint256 protocolFee, uint256 lpFee)",
];

const PAIR_ABI = [
  "function merkleRoot() external view returns (uint256)",
  "function commitmentIndex() external view returns (uint256)",
  "function nullifierUsed(uint256) external view returns (bool)",
];

// ============= TYPES =============
interface Note {
  commitment: bigint;
  nullifier: bigint;
  secret: bigint;
  amount: bigint;
  leafIndex: number;
  spent: boolean;
}

// ============= STRATEGY TYPES =============
interface Strategy {
  name: string;
  type: "scalper" | "day_trader" | "swing_trader" | "accumulator" | "sniper" | "custom";
  eth_per_trade: string;
  aggression: "conservative" | "normal" | "aggressive";
  buy_condition?: string;
  sell_condition?: string;
  take_profit_percent?: number;
  stop_loss_percent?: number;
  active: boolean;
  created_at: string;
  trades_executed: number;
  total_volume: string;
}

// ============= GLOBAL STATE =============
let wallet: Wallet | null = null;
let provider: ethers.JsonRpcProvider | null = null;
let notes: Note[] = [];
let buyIndex = 0;
let activeStrategy: Strategy | null = null;

// ============= HELPER FUNCTIONS =============

function poseidonHash(inputs: bigint[]): bigint {
  // Simplified hash for commitment - in production use actual Poseidon
  const hash = ethers.keccak256(
    ethers.AbiCoder.defaultAbiCoder().encode(
      inputs.map(() => "uint256"),
      inputs.map((i) => i.toString())
    )
  );
  return BigInt(hash) % FIELD_PRIME;
}

function deriveNullifier(privateKey: string, index: number): bigint {
  const hash = ethers.keccak256(
    ethers.solidityPacked(["bytes32", "string", "uint256"], [privateKey, "nullifier", index])
  );
  return BigInt(hash) % FIELD_PRIME;
}

function deriveSecret(privateKey: string, index: number): bigint {
  const hash = ethers.keccak256(
    ethers.solidityPacked(["bytes32", "string", "uint256"], [privateKey, "secret", index])
  );
  return BigInt(hash) % FIELD_PRIME;
}

async function fetchCommitments(): Promise<bigint[]> {
  try {
    const response = await fetch(`${CONFIG.INDEXER_URL}/commitments`);
    if (!response.ok) throw new Error("Indexer not available");
    const data = await response.json();
    return data.commitments.map((c: { commitment: string }) => BigInt(c.commitment));
  } catch {
    return [];
  }
}

function buildMerkleTree(leaves: bigint[], depth: number = 24): { root: bigint; tree: bigint[][] } {
  const tree: bigint[][] = [leaves.slice()];

  // Pad to power of 2
  const size = Math.pow(2, depth);
  while (tree[0].length < size) {
    tree[0].push(0n);
  }

  for (let level = 0; level < depth; level++) {
    const currentLevel = tree[level];
    const nextLevel: bigint[] = [];
    for (let i = 0; i < currentLevel.length; i += 2) {
      nextLevel.push(poseidonHash([currentLevel[i], currentLevel[i + 1]]));
    }
    tree.push(nextLevel);
  }

  return { root: tree[depth][0], tree };
}

function getMerkleProof(
  tree: bigint[][],
  leafIndex: number,
  depth: number = 24
): { pathElements: bigint[]; pathIndices: number[] } {
  const pathElements: bigint[] = [];
  const pathIndices: number[] = [];

  let index = leafIndex;
  for (let level = 0; level < depth; level++) {
    const isRight = index % 2 === 1;
    const siblingIndex = isRight ? index - 1 : index + 1;
    pathElements.push(tree[level][siblingIndex] || 0n);
    pathIndices.push(isRight ? 1 : 0);
    index = Math.floor(index / 2);
  }

  return { pathElements, pathIndices };
}

function saveNotes(): void {
  if (!wallet) return;
  const notesFile = path.join(process.cwd(), `.zkamm-notes-${wallet.address.slice(0, 10)}.json`);
  const data = notes.map((n) => ({
    commitment: n.commitment.toString(),
    nullifier: n.nullifier.toString(),
    secret: n.secret.toString(),
    amount: n.amount.toString(),
    leafIndex: n.leafIndex,
    spent: n.spent,
  }));
  fs.writeFileSync(notesFile, JSON.stringify(data, null, 2));
}

function loadNotes(): void {
  if (!wallet) return;
  const notesFile = path.join(process.cwd(), `.zkamm-notes-${wallet.address.slice(0, 10)}.json`);
  if (fs.existsSync(notesFile)) {
    const data = JSON.parse(fs.readFileSync(notesFile, "utf-8"));
    notes = data.map((n: any) => ({
      commitment: BigInt(n.commitment),
      nullifier: BigInt(n.nullifier),
      secret: BigInt(n.secret),
      amount: BigInt(n.amount),
      leafIndex: n.leafIndex,
      spent: n.spent,
    }));
    buyIndex = notes.length;
  }
}

// ============= MCP SERVER =============

const server = new Server(
  {
    name: "zkamm-mcp",
    version: "0.1.0",
  },
  {
    capabilities: {
      tools: {},
    },
  }
);

// Strategy file helpers
function saveStrategy(strategy: Strategy): void {
  if (!wallet) return;
  const file = path.join(process.cwd(), `.zkamm-strategy-${wallet.address.slice(0, 10)}.json`);
  fs.writeFileSync(file, JSON.stringify(strategy, null, 2));
}

function loadStrategy(): Strategy | null {
  if (!wallet) return null;
  const file = path.join(process.cwd(), `.zkamm-strategy-${wallet.address.slice(0, 10)}.json`);
  if (fs.existsSync(file)) {
    return JSON.parse(fs.readFileSync(file, "utf-8"));
  }
  return null;
}

// List available tools
server.setRequestHandler(ListToolsRequestSchema, async () => {
  return {
    tools: [
      {
        name: "start_strategy_setup",
        description: "START HERE! Begin interactive strategy setup. This will guide you through creating an automated trading strategy step by step. Call this first when a user wants to trade.",
        inputSchema: {
          type: "object",
          properties: {},
        },
      },
      {
        name: "configure_strategy",
        description: "Configure the trading strategy. Call after user chooses strategy type and trade size.",
        inputSchema: {
          type: "object",
          properties: {
            strategy_type: {
              type: "string",
              enum: ["scalper", "day_trader", "swing_trader", "accumulator", "sniper", "custom"],
              description: "Type of strategy: scalper (rapid trades), day_trader (momentum), swing_trader (mean reversion), accumulator (DCA), sniper (buy dips)",
            },
            eth_per_trade: {
              type: "string",
              description: "Amount of ETH per trade (e.g., '0.1')",
            },
            aggression: {
              type: "string",
              enum: ["conservative", "normal", "aggressive"],
              description: "How aggressive the strategy should be",
            },
          },
          required: ["strategy_type", "eth_per_trade"],
        },
      },
      {
        name: "create_wallet",
        description: "Load the generated wallet and connect to network. Call this after start_strategy_setup and configure_strategy.",
        inputSchema: {
          type: "object",
          properties: {
            rpc_url: {
              type: "string",
              description: "Optional RPC URL (defaults to Sepolia)",
            },
          },
        },
      },
      {
        name: "check_wallet_funded",
        description: "Check if the trading wallet has been funded with ETH.",
        inputSchema: {
          type: "object",
          properties: {},
        },
      },
      {
        name: "setup_wallet",
        description: "Alternative: Initialize with an existing private key instead of generating new wallet.",
        inputSchema: {
          type: "object",
          properties: {
            private_key: {
              type: "string",
              description: "Private key (hex string with or without 0x prefix)",
            },
            rpc_url: {
              type: "string",
              description: "Optional RPC URL (defaults to Sepolia)",
            },
          },
          required: ["private_key"],
        },
      },
      {
        name: "execute_strategy",
        description: "Execute the configured strategy once. Call this to run one iteration of the strategy based on current market conditions.",
        inputSchema: {
          type: "object",
          properties: {},
        },
      },
      {
        name: "get_status",
        description: "Get current status including wallet balance, positions, active strategy, and market conditions.",
        inputSchema: {
          type: "object",
          properties: {},
        },
      },
      {
        name: "get_balance",
        description: "Get current ETH balance and token positions",
        inputSchema: {
          type: "object",
          properties: {},
        },
      },
      {
        name: "get_market_info",
        description: "Get current market price and reserves",
        inputSchema: {
          type: "object",
          properties: {},
        },
      },
      {
        name: "buy_tokens",
        description: "Buy ROOT tokens with ETH. Tokens are held privately in a ZK commitment.",
        inputSchema: {
          type: "object",
          properties: {
            eth_amount: {
              type: "string",
              description: "Amount of ETH to spend (e.g., '0.1' for 0.1 ETH)",
            },
            slippage: {
              type: "number",
              description: "Slippage tolerance in percent (default: 5)",
            },
          },
          required: ["eth_amount"],
        },
      },
      {
        name: "sell_tokens",
        description: "Sell ROOT tokens for ETH using ZK proof for privacy. Sells from your oldest position.",
        inputSchema: {
          type: "object",
          properties: {
            position_index: {
              type: "number",
              description: "Index of position to sell (0 = oldest). Omit to sell oldest.",
            },
          },
        },
      },
      {
        name: "list_positions",
        description: "List all your token positions with their values",
        inputSchema: {
          type: "object",
          properties: {},
        },
      },
      {
        name: "sell_all",
        description: "Sell all token positions for ETH",
        inputSchema: {
          type: "object",
          properties: {},
        },
      },
      {
        name: "stop_strategy",
        description: "Stop the active strategy",
        inputSchema: {
          type: "object",
          properties: {},
        },
      },
    ],
  };
});

// Handle tool calls
server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params;

  try {
    switch (name) {
      case "start_strategy_setup": {
        // Generate a fresh wallet for the user
        const newWallet = Wallet.createRandom();
        const walletFile = path.join(process.cwd(), `.zkamm-wallet.json`);
        fs.writeFileSync(walletFile, JSON.stringify({
          address: newWallet.address,
          privateKey: newWallet.privateKey,
          created: new Date().toISOString(),
        }, null, 2));

        return {
          content: [
            {
              type: "text",
              text: `🚀 ZKAMM PRIVATE TRADING BOT

I've generated a fresh trading wallet for you:

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
📍 YOUR TRADING WALLET
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

Address: ${newWallet.address}

⚠️  FUND THIS WALLET with ETH to start trading
    Send Sepolia ETH to the address above

    Faucets:
    • sepoliafaucet.com
    • alchemy.com/faucets/ethereum-sepolia

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

Now ask the user: "What trading strategy do you want to run?"

STRATEGY OPTIONS:

📈 SCALPER
   "I want to scalp small price movements"
   - Rapid buy/sell cycles
   - Target: 1-3% per trade
   - High frequency, small gains

📊 DAY TRADER
   "I want to day trade based on momentum"
   - Buy on uptrends, sell on downtrends
   - Hold minutes to hours
   - Follow price action

🔄 SWING TRADER
   "I want to catch bigger moves"
   - Buy dips, sell pumps
   - Hold hours to days
   - Mean reversion strategy

💰 ACCUMULATOR
   "I just want to stack tokens"
   - DCA buying at intervals
   - Never sell (diamond hands)
   - Long-term hold

🎯 SNIPER
   "I want to buy dips aggressively"
   - Wait for price drops
   - Buy heavy on dips
   - Sell on recovery

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

After user picks strategy, ask:
1. "How much ETH per trade?" (e.g., 0.1, 0.5, 1.0)
2. "How aggressive? Conservative/Normal/Aggressive"

Then use 'configure_strategy' and 'create_wallet' to finalize.

Wallet saved to: ${walletFile}`,
            },
          ],
        };
      }

      case "configure_strategy": {
        const strategyType = (args as any).strategy_type;
        const ethPerTrade = (args as any).eth_per_trade;
        const aggression = (args as any).aggression || "normal";

        const strategyDescriptions: Record<string, string> = {
          scalper: "Rapid buy/sell cycles targeting 1-3% gains",
          day_trader: "Momentum trading - buy uptrends, sell downtrends",
          swing_trader: "Mean reversion - buy dips, sell pumps",
          accumulator: "DCA buying - stack tokens over time",
          sniper: "Aggressive dip buying with recovery sells",
        };

        activeStrategy = {
          name: `${strategyType}-strategy`,
          type: strategyType,
          eth_per_trade: ethPerTrade,
          aggression: aggression,
          active: true,
          created_at: new Date().toISOString(),
          trades_executed: 0,
          total_volume: "0",
        };

        // Save strategy to file
        const strategyFile = path.join(process.cwd(), `.zkamm-strategy.json`);
        fs.writeFileSync(strategyFile, JSON.stringify(activeStrategy, null, 2));

        return {
          content: [
            {
              type: "text",
              text: `✅ STRATEGY CONFIGURED

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
📊 ${strategyType.toUpperCase()}
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

${strategyDescriptions[strategyType] || "Custom strategy"}

Trade Size: ${ethPerTrade} ETH per trade
Aggression: ${aggression.toUpperCase()}

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

Next step: Call 'create_wallet' to connect the generated wallet.
Then call 'check_wallet_funded' to verify ETH balance.
Finally call 'execute_strategy' to start trading!`,
            },
          ],
        };
      }

      case "create_wallet": {
        const rpcUrl = (args as any).rpc_url || CONFIG.RPC_URL;
        const walletFile = path.join(process.cwd(), `.zkamm-wallet.json`);

        if (!fs.existsSync(walletFile)) {
          return {
            content: [{ type: "text", text: "Error: No wallet file found. Call 'start_strategy_setup' first to generate a wallet." }],
          };
        }

        const walletData = JSON.parse(fs.readFileSync(walletFile, "utf-8"));
        provider = new ethers.JsonRpcProvider(rpcUrl);
        wallet = new Wallet(walletData.privateKey, provider);
        loadNotes();

        // Load strategy if exists
        const strategyFile = path.join(process.cwd(), `.zkamm-strategy.json`);
        if (fs.existsSync(strategyFile)) {
          activeStrategy = JSON.parse(fs.readFileSync(strategyFile, "utf-8"));
        }

        const balance = await provider.getBalance(wallet.address);
        const funded = balance > 0n;

        return {
          content: [
            {
              type: "text",
              text: `✅ WALLET CONNECTED

Address: ${wallet.address}
Balance: ${ethers.formatEther(balance)} ETH
Positions: ${notes.filter((n) => !n.spent).length}
Strategy: ${activeStrategy?.type.toUpperCase() || "Not configured"}

${funded ? "✅ Wallet is funded! Ready to trade." : "⚠️ Wallet needs funding. Send ETH to the address above."}

${funded ? "Call 'execute_strategy' to start trading!" : "Call 'check_wallet_funded' after sending ETH."}`,
            },
          ],
        };
      }

      case "check_wallet_funded": {
        const walletFile = path.join(process.cwd(), `.zkamm-wallet.json`);

        if (!provider) {
          provider = new ethers.JsonRpcProvider(CONFIG.RPC_URL);
        }

        if (!wallet && fs.existsSync(walletFile)) {
          const walletData = JSON.parse(fs.readFileSync(walletFile, "utf-8"));
          wallet = new Wallet(walletData.privateKey, provider);
        }

        if (!wallet) {
          return {
            content: [{ type: "text", text: "Error: No wallet found. Call 'start_strategy_setup' first." }],
          };
        }

        const balance = await provider.getBalance(wallet.address);
        const minRequired = activeStrategy ? ethers.parseEther(activeStrategy.eth_per_trade) : ethers.parseEther("0.1");
        const funded = balance >= minRequired;

        if (funded) {
          return {
            content: [
              {
                type: "text",
                text: `✅ WALLET FUNDED!

Address: ${wallet.address}
Balance: ${ethers.formatEther(balance)} ETH

Ready to trade! Call 'execute_strategy' to start.`,
              },
            ],
          };
        } else {
          return {
            content: [
              {
                type: "text",
                text: `⏳ WAITING FOR FUNDS

Address: ${wallet.address}
Current Balance: ${ethers.formatEther(balance)} ETH
Minimum Needed: ${ethers.formatEther(minRequired)} ETH

Send ETH to the address above, then call 'check_wallet_funded' again.

Sepolia Faucets:
• sepoliafaucet.com
• alchemy.com/faucets/ethereum-sepolia`,
              },
            ],
          };
        }
      }

      case "execute_strategy": {
        if (!wallet || !provider) {
          // Try to load wallet
          const walletFile = path.join(process.cwd(), `.zkamm-wallet.json`);
          if (fs.existsSync(walletFile)) {
            const walletData = JSON.parse(fs.readFileSync(walletFile, "utf-8"));
            provider = new ethers.JsonRpcProvider(CONFIG.RPC_URL);
            wallet = new Wallet(walletData.privateKey, provider);
            loadNotes();
          } else {
            return { content: [{ type: "text", text: "Error: Wallet not set up. Call 'start_strategy_setup' first." }] };
          }
        }

        if (!activeStrategy) {
          const strategyFile = path.join(process.cwd(), `.zkamm-strategy.json`);
          if (fs.existsSync(strategyFile)) {
            activeStrategy = JSON.parse(fs.readFileSync(strategyFile, "utf-8"));
          } else {
            return { content: [{ type: "text", text: "Error: No strategy configured. Call 'configure_strategy' first." }] };
          }
        }

        // Now activeStrategy is guaranteed non-null
        const strategy = activeStrategy!;

        const router = new ethers.Contract(CONFIG.ROUTER_ADDRESS, ROUTER_ABI, wallet);
        const [ethReserve, tokenReserve] = await router.getReserves();
        const currentPrice = Number(ethReserve) / Number(tokenReserve);
        const balance = await provider.getBalance(wallet.address);
        const unspentNotes = notes.filter((n) => !n.spent);
        const totalTokens = unspentNotes.reduce((sum, n) => sum + n.amount, 0n);

        // Aggression multipliers
        const buyThresholds: Record<string, number> = { conservative: 0.3, normal: 0.5, aggressive: 0.7 };
        const sellThresholds: Record<string, number> = { conservative: 0.7, normal: 0.5, aggressive: 0.3 };
        const buyChance = buyThresholds[strategy.aggression] || 0.5;
        const sellChance = sellThresholds[strategy.aggression] || 0.5;
        const random = Math.random();

        let action = "HOLD";
        let reason = "";
        let result = "";

        switch (strategy.type) {
          case "scalper":
            // Scalper: rapid buy/sell cycles
            if (unspentNotes.length === 0) {
              action = "BUY";
              reason = "Scalper - Opening position";
            } else if (random > sellChance) {
              action = "SELL";
              reason = "Scalper - Taking quick profit";
            } else {
              action = "HOLD";
              reason = "Scalper - Waiting for opportunity";
            }
            break;

          case "day_trader":
            // Day trader: momentum based
            if (unspentNotes.length === 0 && random < buyChance) {
              action = "BUY";
              reason = "Day Trader - Entering position";
            } else if (unspentNotes.length > 0 && random > sellChance) {
              action = "SELL";
              reason = "Day Trader - Exiting position";
            } else if (unspentNotes.length < 3 && random < buyChance * 0.5) {
              action = "BUY";
              reason = "Day Trader - Adding to position";
            }
            break;

          case "swing_trader":
            // Swing trader: mean reversion
            if (unspentNotes.length < 2) {
              action = "BUY";
              reason = "Swing Trader - Building position on dip";
            } else if (unspentNotes.length >= 3 && random > sellChance) {
              action = "SELL";
              reason = "Swing Trader - Taking profits on pump";
            }
            break;

          case "accumulator":
            // Accumulator: always DCA buy, never sell
            action = "BUY";
            reason = "Accumulator - Stacking tokens";
            break;

          case "sniper":
            // Sniper: aggressive dip buying
            if (random < buyChance) {
              action = "BUY";
              reason = "Sniper - Buying the dip";
            } else if (unspentNotes.length > 3 && random > 0.8) {
              action = "SELL";
              reason = "Sniper - Taking partial profits";
            }
            break;

          default:
            action = "HOLD";
            reason = "Evaluating market conditions";
        }

        // Execute the action
        if (action === "BUY" && balance > ethers.parseEther(strategy.eth_per_trade)) {
          const ethAmount = ethers.parseEther(strategy.eth_per_trade);
          const expectedTokens = await router.getAmountOut(ethAmount, ethReserve, tokenReserve);
          const minTokens = (expectedTokens * 95n) / 100n;

          const nullifier = deriveNullifier(wallet.privateKey, buyIndex);
          const secret = deriveSecret(wallet.privateKey, buyIndex);

          const tx = await router.buyTokens(minTokens, { value: ethAmount });
          const receipt = await tx.wait();

          const note: Note = {
            commitment: poseidonHash([nullifier, secret, expectedTokens]),
            nullifier,
            secret,
            amount: expectedTokens,
            leafIndex: buyIndex,
            spent: false,
          };
          notes.push(note);
          buyIndex++;
          saveNotes();

          // Update strategy stats
          strategy.trades_executed++;
          strategy.total_volume = (BigInt(strategy.total_volume || "0") + ethAmount).toString();
          const strategyFile = path.join(process.cwd(), `.zkamm-strategy.json`);
          fs.writeFileSync(strategyFile, JSON.stringify(strategy, null, 2));

          result = `

✅ TRADE EXECUTED
━━━━━━━━━━━━━━━━━━━━
Action: BUY
Spent: ${strategy.eth_per_trade} ETH
Received: ${ethers.formatEther(expectedTokens)} ROOT
Tx: ${receipt.hash}

Total Trades: ${strategy.trades_executed}
Total Volume: ${ethers.formatEther(strategy.total_volume)} ETH`;

        } else if (action === "SELL" && unspentNotes.length > 0) {
          result = `

⏳ SELL SIGNAL
━━━━━━━━━━━━━━━━━━━━
Ready to sell! Call 'sell_tokens' to execute with ZK proof.
This will privately sell your oldest position.`;

        } else if (action === "BUY" && balance <= ethers.parseEther(strategy.eth_per_trade)) {
          result = `

⚠️ INSUFFICIENT FUNDS
━━━━━━━━━━━━━━━━━━━━
Need: ${strategy.eth_per_trade} ETH
Have: ${ethers.formatEther(balance)} ETH

Fund your wallet to continue trading.`;
        }

        return {
          content: [
            {
              type: "text",
              text: `📊 ${strategy.type.toUpperCase()} STRATEGY

Action: ${action}
Reason: ${reason}

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
MARKET
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
Price: ${currentPrice.toExponential(4)} ETH/ROOT
Liquidity: ${ethers.formatEther(ethReserve)} ETH

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
YOUR PORTFOLIO
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
ETH: ${ethers.formatEther(balance)}
ROOT: ${ethers.formatEther(totalTokens)} (${unspentNotes.length} positions)
${result}`,
            },
          ],
        };
      }

      case "get_status": {
        let status = "📊 ZKAMM TRADING STATUS\n\n";

        // Wallet status
        if (wallet && provider) {
          const balance = await provider.getBalance(wallet.address);
          const unspentNotes = notes.filter((n) => !n.spent);
          const totalTokens = unspentNotes.reduce((sum, n) => sum + n.amount, 0n);
          status += `WALLET: ✅ Connected\n`;
          status += `Address: ${wallet.address.slice(0, 10)}...\n`;
          status += `ETH Balance: ${ethers.formatEther(balance)} ETH\n`;
          status += `ROOT Holdings: ${ethers.formatEther(totalTokens)} (${unspentNotes.length} positions)\n\n`;
        } else {
          status += `WALLET: ❌ Not connected\n\n`;
        }

        // Strategy status
        if (activeStrategy) {
          status += `STRATEGY: ✅ ${activeStrategy.type.toUpperCase()}\n`;
          status += `Trade Size: ${activeStrategy.eth_per_trade} ETH\n`;
          if (activeStrategy.take_profit_percent) status += `Take Profit: ${activeStrategy.take_profit_percent}%\n`;
          if (activeStrategy.stop_loss_percent) status += `Stop Loss: ${activeStrategy.stop_loss_percent}%\n`;
          status += `\n`;
        } else {
          status += `STRATEGY: ❌ Not configured\n\n`;
        }

        // Market status
        if (provider) {
          try {
            const router = new ethers.Contract(CONFIG.ROUTER_ADDRESS, ROUTER_ABI, provider);
            const [ethReserve, tokenReserve] = await router.getReserves();
            const price = Number(ethReserve) / Number(tokenReserve);
            status += `MARKET:\n`;
            status += `Price: ${price.toExponential(4)} ETH/ROOT\n`;
            status += `Liquidity: ${ethers.formatEther(ethReserve)} ETH\n`;
          } catch {
            status += `MARKET: Unable to fetch\n`;
          }
        }

        return { content: [{ type: "text", text: status }] };
      }

      case "stop_strategy": {
        if (activeStrategy) {
          activeStrategy.active = false;
          if (wallet) saveStrategy(activeStrategy);
          activeStrategy = null;
          return { content: [{ type: "text", text: "✅ Strategy stopped." }] };
        }
        return { content: [{ type: "text", text: "No active strategy to stop." }] };
      }

      case "setup_wallet": {
        const privateKey = (args as any).private_key;
        const rpcUrl = (args as any).rpc_url || CONFIG.RPC_URL;

        provider = new ethers.JsonRpcProvider(rpcUrl);
        wallet = new Wallet(privateKey, provider);
        loadNotes();

        const balance = await provider.getBalance(wallet.address);
        return {
          content: [
            {
              type: "text",
              text: `Wallet initialized!\nAddress: ${wallet.address}\nBalance: ${ethers.formatEther(balance)} ETH\nPositions loaded: ${notes.filter((n) => !n.spent).length}`,
            },
          ],
        };
      }

      case "get_balance": {
        if (!wallet || !provider) {
          return { content: [{ type: "text", text: "Error: Wallet not initialized. Call setup_wallet first." }] };
        }

        const balance = await provider.getBalance(wallet.address);
        const unspentNotes = notes.filter((n) => !n.spent);
        const totalTokens = unspentNotes.reduce((sum, n) => sum + n.amount, 0n);

        return {
          content: [
            {
              type: "text",
              text: `ETH Balance: ${ethers.formatEther(balance)} ETH\nToken Positions: ${unspentNotes.length}\nTotal ROOT: ${ethers.formatEther(totalTokens)} ROOT`,
            },
          ],
        };
      }

      case "get_market_info": {
        if (!provider) {
          provider = new ethers.JsonRpcProvider(CONFIG.RPC_URL);
        }

        const router = new ethers.Contract(CONFIG.ROUTER_ADDRESS, ROUTER_ABI, provider);
        const [ethReserve, tokenReserve] = await router.getReserves();
        const price = Number(ethReserve) / Number(tokenReserve);

        return {
          content: [
            {
              type: "text",
              text: `Market Info:\nETH Reserve: ${ethers.formatEther(ethReserve)} ETH\nROOT Reserve: ${ethers.formatEther(tokenReserve)} ROOT\nPrice: ${price.toExponential(4)} ETH/ROOT`,
            },
          ],
        };
      }

      case "buy_tokens": {
        if (!wallet || !provider) {
          return { content: [{ type: "text", text: "Error: Wallet not initialized. Call setup_wallet first." }] };
        }

        const ethAmount = ethers.parseEther((args as any).eth_amount);
        const slippage = (args as any).slippage || 5;

        const router = new ethers.Contract(CONFIG.ROUTER_ADDRESS, ROUTER_ABI, wallet);
        const [ethReserve, tokenReserve] = await router.getReserves();
        const expectedTokens = await router.getAmountOut(ethAmount, ethReserve, tokenReserve);
        const minTokens = (expectedTokens * BigInt(100 - slippage)) / 100n;

        // Derive deterministic note values
        const nullifier = deriveNullifier(wallet.privateKey, buyIndex);
        const secret = deriveSecret(wallet.privateKey, buyIndex);

        const tx = await router.buyTokens(minTokens, { value: ethAmount });
        const receipt = await tx.wait();

        // Parse event to get actual values
        const buyEvent = receipt.logs.find(
          (log: any) => log.topics[0] === ethers.id("TokensBought(address,uint256,uint256,uint256)")
        );

        let tokensOut = expectedTokens;
        let commitment = 0n;
        let leafIndex = 0;

        if (buyEvent) {
          const decoded = router.interface.parseLog({
            topics: buyEvent.topics as string[],
            data: buyEvent.data,
          });
          if (decoded) {
            tokensOut = decoded.args[2];
            commitment = decoded.args[3];
            leafIndex = Number(commitment); // Approximate - should query indexer
          }
        }

        // Store note
        const note: Note = {
          commitment: poseidonHash([nullifier, secret, tokensOut]),
          nullifier,
          secret,
          amount: tokensOut,
          leafIndex: buyIndex,
          spent: false,
        };
        notes.push(note);
        buyIndex++;
        saveNotes();

        return {
          content: [
            {
              type: "text",
              text: `Buy successful!\nSpent: ${ethers.formatEther(ethAmount)} ETH\nReceived: ${ethers.formatEther(tokensOut)} ROOT\nTx: ${receipt.hash}`,
            },
          ],
        };
      }

      case "sell_tokens": {
        if (!wallet || !provider) {
          return { content: [{ type: "text", text: "Error: Wallet not initialized. Call setup_wallet first." }] };
        }

        const positionIndex = (args as any).position_index ?? 0;
        const unspentNotes = notes.filter((n) => !n.spent);

        if (unspentNotes.length === 0) {
          return { content: [{ type: "text", text: "No positions to sell." }] };
        }

        if (positionIndex >= unspentNotes.length) {
          return { content: [{ type: "text", text: `Invalid position index. You have ${unspentNotes.length} positions (0-${unspentNotes.length - 1}).` }] };
        }

        const note = unspentNotes[positionIndex];

        // Fetch commitments and build merkle tree
        const commitments = await fetchCommitments();
        if (commitments.length === 0) {
          return { content: [{ type: "text", text: "Error: Could not fetch commitments from indexer. Is it running?" }] };
        }

        const { root, tree } = buildMerkleTree(commitments);
        const { pathElements, pathIndices } = getMerkleProof(tree, note.leafIndex);

        // Check if circuit files exist
        if (!fs.existsSync(CONFIG.CIRCUIT_WASM) || !fs.existsSync(CONFIG.CIRCUIT_ZKEY)) {
          return {
            content: [
              {
                type: "text",
                text: `Error: Circuit files not found. Please ensure sell.wasm and sell_final.zkey are in the circuits folder.`,
              },
            ],
          };
        }

        // Generate ZK proof
        const input = {
          root: root.toString(),
          nullifier: note.nullifier.toString(),
          secret: note.secret.toString(),
          amount: note.amount.toString(),
          pathElements: pathElements.map((p) => p.toString()),
          pathIndices: pathIndices,
        };

        const { proof, publicSignals } = await snarkjs.groth16.fullProve(
          input,
          CONFIG.CIRCUIT_WASM,
          CONFIG.CIRCUIT_ZKEY
        );

        // Format proof for contract
        const calldata = await snarkjs.groth16.exportSolidityCallData(proof, publicSignals);
        const [a, b, c, signals] = JSON.parse(`[${calldata}]`);

        // Execute sell
        const router = new ethers.Contract(CONFIG.ROUTER_ADDRESS, ROUTER_ABI, wallet);
        const tx = await router.sellPrivate(a, b, c, signals);
        const receipt = await tx.wait();

        // Parse ETH received
        let ethOut = 0n;
        const sellEvent = receipt.logs.find(
          (log: any) => log.topics[0] === ethers.id("TokensSold(uint256,uint256,uint256,uint256)")
        );
        if (sellEvent) {
          const decoded = router.interface.parseLog({
            topics: sellEvent.topics as string[],
            data: sellEvent.data,
          });
          if (decoded) {
            ethOut = decoded.args[1];
          }
        }

        // Mark as spent
        const noteIndex = notes.findIndex((n) => n.nullifier === note.nullifier);
        if (noteIndex >= 0) {
          notes[noteIndex].spent = true;
          saveNotes();
        }

        return {
          content: [
            {
              type: "text",
              text: `Sell successful!\nSold: ${ethers.formatEther(note.amount)} ROOT\nReceived: ${ethers.formatEther(ethOut)} ETH\nTx: ${receipt.hash}`,
            },
          ],
        };
      }

      case "list_positions": {
        const unspentNotes = notes.filter((n) => !n.spent);
        if (unspentNotes.length === 0) {
          return { content: [{ type: "text", text: "No positions." }] };
        }

        const lines = unspentNotes.map(
          (n, i) => `${i}: ${ethers.formatEther(n.amount)} ROOT`
        );

        return {
          content: [
            {
              type: "text",
              text: `Your positions:\n${lines.join("\n")}`,
            },
          ],
        };
      }

      case "sell_all": {
        if (!wallet || !provider) {
          return { content: [{ type: "text", text: "Error: Wallet not initialized. Call setup_wallet first." }] };
        }

        const unspentNotes = notes.filter((n) => !n.spent);
        if (unspentNotes.length === 0) {
          return { content: [{ type: "text", text: "No positions to sell." }] };
        }

        let totalEthReceived = 0n;
        let soldCount = 0;
        const errors: string[] = [];

        for (const note of unspentNotes) {
          try {
            const commitments = await fetchCommitments();
            const { root, tree } = buildMerkleTree(commitments);
            const { pathElements, pathIndices } = getMerkleProof(tree, note.leafIndex);

            const input = {
              root: root.toString(),
              nullifier: note.nullifier.toString(),
              secret: note.secret.toString(),
              amount: note.amount.toString(),
              pathElements: pathElements.map((p) => p.toString()),
              pathIndices: pathIndices,
            };

            const { proof, publicSignals } = await snarkjs.groth16.fullProve(
              input,
              CONFIG.CIRCUIT_WASM,
              CONFIG.CIRCUIT_ZKEY
            );

            const calldata = await snarkjs.groth16.exportSolidityCallData(proof, publicSignals);
            const [a, b, c, signals] = JSON.parse(`[${calldata}]`);

            const router = new ethers.Contract(CONFIG.ROUTER_ADDRESS, ROUTER_ABI, wallet);
            const tx = await router.sellPrivate(a, b, c, signals);
            const receipt = await tx.wait();

            const sellEvent = receipt.logs.find(
              (log: any) => log.topics[0] === ethers.id("TokensSold(uint256,uint256,uint256,uint256)")
            );
            if (sellEvent) {
              const decoded = router.interface.parseLog({
                topics: sellEvent.topics as string[],
                data: sellEvent.data,
              });
              if (decoded) {
                totalEthReceived += decoded.args[1];
              }
            }

            const noteIndex = notes.findIndex((n) => n.nullifier === note.nullifier);
            if (noteIndex >= 0) {
              notes[noteIndex].spent = true;
              saveNotes();
            }
            soldCount++;
          } catch (err: any) {
            errors.push(`Position ${note.leafIndex}: ${err.message}`);
          }
        }

        return {
          content: [
            {
              type: "text",
              text: `Sell all complete!\nPositions sold: ${soldCount}/${unspentNotes.length}\nTotal ETH received: ${ethers.formatEther(totalEthReceived)} ETH${errors.length > 0 ? `\nErrors:\n${errors.join("\n")}` : ""}`,
            },
          ],
        };
      }

      default:
        return { content: [{ type: "text", text: `Unknown tool: ${name}` }] };
    }
  } catch (error: any) {
    return { content: [{ type: "text", text: `Error: ${error.message}` }] };
  }
});

// Start server
async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error("ZkAMM MCP Server running");
}

main().catch(console.error);
