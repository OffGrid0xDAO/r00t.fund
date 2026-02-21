# Trading Agents Framework - Claude Code Instructions

This is a modular trading agent framework. Users will ask you to create or modify trading strategies.

## Quick Start for Users

```bash
# Install dependencies
npm install

# Check agent wallet balances
npm run agents:status

# Fund agent wallets
npm run agents:fund

# Run the trading bot
npm start
```

## Project Structure

```
trading-agents/
├── config.ts              # ⚙️ MAIN CONFIG - Edit this for different tokens/DEXs
├── src/
│   ├── index.ts           # Entry point - runs the trading loop
│   ├── types.ts           # TypeScript interfaces
│   ├── agents/
│   │   └── WalletManager.ts   # Manages N agent wallets from seed
│   ├── strategies/
│   │   ├── BaseStrategy.ts    # Abstract strategy class
│   │   ├── MomentumStrategy.ts
│   │   ├── MeanReversionStrategy.ts
│   │   ├── RandomStrategy.ts
│   │   └── GridStrategy.ts
│   └── utils/
│       ├── dex.ts         # DEX interaction helpers
│       ├── math.ts        # Trading math utilities
│       └── logger.ts      # Logging utilities
└── CLAUDE.md              # This file
```

## How to Help Users

### 1. Creating a New Strategy

When user asks: "Create a strategy that buys when RSI is below 30"

1. Create new file: `src/strategies/RSIStrategy.ts`
2. Extend `BaseStrategy`
3. Implement `decide()` method
4. Add to strategy factory in `src/strategies/index.ts`

Example:
```typescript
import { BaseStrategy, TradeDecision, MarketState, AgentBalance } from './BaseStrategy';

export class RSIStrategy extends BaseStrategy {
  name = 'RSI';

  private calculateRSI(prices: number[], period = 14): number {
    // RSI calculation logic
  }

  decide(market: MarketState, balance: AgentBalance): TradeDecision {
    const rsi = this.calculateRSI(market.priceHistory);

    if (rsi < 30 && balance.eth > this.config.minTradeSize) {
      return { action: 'BUY', amount: this.config.minTradeSize, reason: `RSI oversold: ${rsi}` };
    }
    if (rsi > 70 && balance.tokens > 0n) {
      return { action: 'SELL', amount: balance.tokens, reason: `RSI overbought: ${rsi}` };
    }
    return { action: 'HOLD', amount: 0n, reason: `RSI neutral: ${rsi}` };
  }
}
```

### 2. Modifying Config

When user asks: "Change to trade on Uniswap" or "Use different token"

Edit `config.ts`:
```typescript
export const CONFIG = {
  // Network
  RPC_URL: 'https://...',
  CHAIN_ID: 1,

  // Contracts - CHANGE THESE
  DEX_ROUTER: '0x....',
  TOKEN_ADDRESS: '0x...',

  // Trading params
  NUM_AGENTS: 10,
  MIN_TRADE_ETH: 0.01,
  MAX_TRADE_ETH: 0.1,
};
```

### 3. Common User Requests

| User Request | Action |
|--------------|--------|
| "Make it trade faster" | Reduce `TRADE_INTERVAL_MS` in config |
| "Bigger trades" | Increase `MIN_TRADE_ETH` and `MAX_TRADE_ETH` |
| "More agents" | Increase `NUM_AGENTS` |
| "Buy the dip strategy" | Create strategy that buys on price drops |
| "Grid trading" | Use/modify `GridStrategy.ts` |
| "DCA strategy" | Create strategy with time-based buying |
| "Whale following" | Create strategy monitoring large transactions |

### 4. Adding New DEX Support

To support a new DEX, modify `src/utils/dex.ts`:
1. Add the DEX's router ABI
2. Implement `buy()` and `sell()` functions
3. Update `getPrice()` and `getReserves()`

### 5. ZK-SNARK Sells (for privacy DEXs)

This framework supports ZK proof generation for private sells.
See `src/utils/zkProofs.ts` for proof generation.
Requires circuit files in `../circuits/build/`

## Environment Variables

Create `.env` file:
```
PRIVATE_KEY=0x...        # Funder wallet (derives agent wallets)
RPC_URL=https://...      # Optional override
```

## Testing Strategies

Users can test strategies without real trades:
```typescript
// In strategy file, add:
if (process.env.DRY_RUN === 'true') {
  console.log(`[DRY RUN] Would ${decision.action} ${decision.amount}`);
  return { action: 'HOLD', amount: 0n, reason: 'Dry run' };
}
```

Run with: `DRY_RUN=true npm start`
