# ZkAMM MCP - AI Trading Bot with Privacy

**Tell Claude your strategy. It creates a wallet, you fund it, and it trades for you.**

## The Flow

```
You: "I want to trade on ZkAMM"

Claude: "I've created a wallet for you:
        Address: 0x1234...

        Send some Sepolia ETH to this address.

        What strategy do you want?
        - Scalper (rapid trades)
        - Day Trader (momentum)
        - Swing Trader (buy dips, sell pumps)
        - Accumulator (DCA, never sell)
        - Sniper (aggressive dip buying)"

You: "Scalper, 0.1 ETH per trade, aggressive"

Claude: "Strategy set! Checking your wallet..."
        "Wallet funded with 1 ETH. Starting trades..."

        "✅ Bought 45,000 ROOT for 0.1 ETH"
        "✅ Sold 45,000 ROOT for 0.103 ETH (+3%)"
        ...
```

## Setup

### 1. Install
```bash
cd zkamm-mcp
npm install && npm run build
```

### 2. Add to Claude Code

Edit `~/.claude/claude_desktop_config.json`:
```json
{
  "mcpServers": {
    "zkamm": {
      "command": "node",
      "args": ["/path/to/zkamm-mcp/dist/index.js"],
      "env": {
        "RPC_URL": "https://eth-sepolia.g.alchemy.com/v2/YOUR_KEY"
      }
    }
  }
}
```

### 3. Talk to Claude

Just say "I want to trade" or "Set up a trading bot"

---

## Strategy Types

| Strategy | Description | Best For |
|----------|-------------|----------|
| **Scalper** | Rapid buy/sell, 1-3% targets | High frequency, small gains |
| **Day Trader** | Momentum following | Following trends |
| **Swing Trader** | Buy dips, sell pumps | Mean reversion |
| **Accumulator** | DCA buying, never sell | Long-term holders |
| **Sniper** | Aggressive dip buying | Catching bottoms |

## Aggression Levels

- **Conservative**: Fewer trades, waits for better setups
- **Normal**: Balanced approach
- **Aggressive**: More trades, takes more risk

---

## Example Session

```
You: Set up a trading strategy for me

Claude: I've generated a fresh trading wallet!

        Address: 0x7a3B...9F2e

        Send Sepolia ETH to this address to fund your bot.

        Faucets:
        • sepoliafaucet.com
        • alchemy.com/faucets/ethereum-sepolia

        What strategy do you want?

        📈 SCALPER - Rapid trades, small gains
        📊 DAY TRADER - Momentum following
        🔄 SWING TRADER - Buy dips, sell pumps
        💰 ACCUMULATOR - Stack tokens forever
        🎯 SNIPER - Aggressive dip buying

You: I want to scalp with 0.1 ETH trades, aggressive mode

Claude: ✅ Strategy configured!

        Type: SCALPER
        Trade Size: 0.1 ETH
        Aggression: AGGRESSIVE

        Checking wallet balance...

        ⏳ Waiting for funds. Send ETH to 0x7a3B...9F2e

You: I sent 1 ETH

Claude: ✅ Wallet funded! Balance: 1.0 ETH

        Starting scalper strategy...

        📊 SCALPER STRATEGY
        Action: BUY
        Reason: Opening position

        ✅ TRADE EXECUTED
        Spent: 0.1 ETH
        Received: 48,230 ROOT

        Total Trades: 1
        Total Volume: 0.1 ETH

You: Keep going

Claude: 📊 SCALPER STRATEGY
        Action: SELL
        Reason: Taking quick profit

        [Executes ZK proof sell]

        ✅ Sold 48,230 ROOT for 0.104 ETH (+4%)
```

---

## Commands

| Say this | Does this |
|----------|-----------|
| "Set up trading" | Generates wallet + strategy setup |
| "Check my wallet" | Shows balance |
| "Execute strategy" | Runs one trade cycle |
| "Keep trading" | Continues executing |
| "Sell everything" | Liquidates all positions |
| "Stop" | Deactivates strategy |

---

## How Volume is Generated

Each user running a strategy = more trades = more volume

- **Scalpers**: High frequency, many small trades
- **Day Traders**: Moderate frequency, follows momentum
- **Swing Traders**: Buy dips create volume on dumps
- **Accumulators**: Steady buy pressure
- **Snipers**: Aggressive buying on dips

More users = more volume = healthier market

---

## Privacy

- **Buys** are public (you can see who bought)
- **Sells** use ZK proofs (nobody knows which buy you're selling)

Your trading patterns are private.

---

## Files Created

```
.zkamm-wallet.json     # Your generated wallet (keep safe!)
.zkamm-strategy.json   # Your strategy config
.zkamm-notes-*.json    # Your token positions
```

**Back up `.zkamm-wallet.json`** - it contains your private key!

---

## Requirements

- Node.js 18+
- Running indexer for sells: `cd indexer && pnpm dev`
- Sepolia ETH for gas + trading
