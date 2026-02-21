# 🤖 Trading Agents Framework

A modular framework for creating market makers and trading bots. **Designed to be customized with Claude Code.**

## Quick Start

```bash
# 1. Install dependencies
npm install

# 2. Set your private key
export PRIVATE_KEY=0x...

# 3. Run the trading bot
npm start

# Or test without real trades
DRY_RUN=true npm start
```

## 🎯 Using with Claude Code

Open this folder in Claude Code and tell it what you want:

### Example Prompts

**Create a new strategy:**
> "Create a DCA strategy that buys $50 worth of tokens every hour"

**Modify trading behavior:**
> "Make the momentum strategy more aggressive - trigger on 1% moves instead of 2%"

**Change configuration:**
> "Configure this to trade on Uniswap mainnet with PEPE token"

**Add features:**
> "Add telegram notifications when a trade is executed"

## 📁 Project Structure

```
trading-agents/
├── config.ts                 # ⚙️ Main configuration
├── CLAUDE.md                 # 🤖 Instructions for Claude
├── src/
│   ├── index.ts              # Entry point
│   ├── types.ts              # TypeScript types
│   ├── agents/
│   │   └── WalletManager.ts  # Multi-wallet management
│   └── strategies/
│       ├── BaseStrategy.ts   # Base class for strategies
│       ├── MomentumStrategy.ts
│       ├── MeanReversionStrategy.ts
│       ├── RandomStrategy.ts
│       └── AccumulatorStrategy.ts
```

## ⚙️ Configuration

Edit `config.ts` to customize:

```typescript
export const CONFIG = {
  // Network
  RPC_URL: 'https://...',
  CHAIN_ID: 1,

  // Contracts
  DEX_ROUTER: '0x...',
  DEX_PAIR: '0x...',

  // Trading
  NUM_AGENTS: 10,
  MIN_TRADE_ETH: 0.01,
  MAX_TRADE_ETH: 0.1,

  // Timing
  TRADE_INTERVAL_MS: 15000,
  MAX_ROUNDS: 100,
};
```

## 📊 Built-in Strategies

| Strategy | Description |
|----------|-------------|
| **Momentum** | Buys when price rising, sells when falling |
| **MeanReversion** | Buys dips, sells pumps |
| **Random** | Random trades for volume generation |
| **Accumulator** | DCA-style steady buying |

## 🔧 Creating Custom Strategies

1. Create a new file in `src/strategies/`
2. Extend `BaseStrategy`
3. Implement the `decide()` method
4. Add to `src/strategies/index.ts`

```typescript
import { BaseStrategy, TradeDecision, MarketState, AgentBalance } from './BaseStrategy';

export class MyStrategy extends BaseStrategy {
  name = 'MyStrategy';

  decide(market: MarketState, balance: AgentBalance): TradeDecision {
    // Your logic here
    if (someCondition && this.canBuy(balance)) {
      return {
        action: 'BUY',
        amount: this.randomAmount(),
        reason: 'My reason'
      };
    }
    return { action: 'HOLD', amount: 0n, reason: 'Waiting' };
  }
}
```

## 🔐 Security

- Private keys are used to derive agent wallets deterministically
- Each agent has its own wallet (funds isolated)
- Never commit `.env` files with private keys
- Test with small amounts first

## 📜 License

MIT
