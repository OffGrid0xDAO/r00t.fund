# ZkAMM Market Maker Scripts

Trading scripts for generating volume and battle-testing the ZkAMM contracts.

## Quick Start

```bash
cd scripts
npm install

# Run simple buy-only market maker (easier, no ZK proofs)
PRIVATE_KEY=0x... npm run mm:simple

# Run full market maker with ZK proof sells (requires circuit files)
PRIVATE_KEY=0x... npm run mm
```

## Scripts

### 1. Simple Market Maker (`market-maker-simple.ts`)

Buy-only mode for quick volume generation. Perfect for:
- Initial testing
- LP reward generation
- Stress testing buys

**Features:**
- 33 agents with different trading styles (WHALE, MINNOW, RANDOM, STEADY, BURST)
- HD-derived wallets for reproducibility
- Automatic funding from your wallet
- Performance leaderboard

**Usage:**
```bash
# Set your private key (needs ~0.2 ETH on Sepolia)
export PRIVATE_KEY=0x...

# Optional: Custom RPC
export SEPOLIA_RPC_URL=https://your-rpc-url

# Run
npm run mm:simple
```

### 2. Full Market Maker (`market-maker.ts`)

Complete trading simulation with both buys AND sells using real ZK proofs.

**Features:**
- 7 different trading strategies competing:
  - **MOMENTUM**: Buy when price rises, sell when falls
  - **MEAN_REVERSION**: Buy low, sell high based on average
  - **RANDOM**: Random trading decisions
  - **AGGRESSIVE_BUYER**: Always buying
  - **AGGRESSIVE_SELLER**: Always selling
  - **BALANCED**: Maintains 50/50 portfolio
  - **CONTRARIAN**: Trades against the trend

- Real Groth16 ZK proof generation for sells
- Performance tracking with PnL calculation
- Strategy performance comparison

**Requirements:**
- Circuit files must be compiled in `../circuits/build/sell/`
- Needs `sell.wasm` and `sell_final.zkey`

**Usage:**
```bash
export PRIVATE_KEY=0x...
npm run mm
```

## Configuration

Edit the CONFIG object in either script to customize:

```typescript
const CONFIG = {
  // Trading amounts
  MIN_TRADE_ETH: ethers.parseEther('0.0001'),
  MAX_TRADE_ETH: ethers.parseEther('0.005'),

  // Timing
  TRADE_INTERVAL_MS: 5000,  // Time between rounds
  MAX_ROUNDS: 100,          // Total rounds to run

  // Agents
  NUM_AGENTS: 33,           // Number of competing agents
  AGENTS_PER_ROUND: 5,      // How many trade each round
};
```

## Environment Variables

| Variable | Description | Default |
|----------|-------------|---------|
| `PRIVATE_KEY` | Funder wallet private key | Required |
| `SEPOLIA_RPC_URL` | Sepolia RPC endpoint | Alchemy default |
| `MM_SEED` | HD seed for agent wallets | Test seed |

## Agent Wallet Derivation

Agents are derived from an HD wallet using BIP-44 paths:
- Simple MM: `m/44'/60'/0'/0/{100+i}` for agent i
- Full MM: `m/44'/60'/0'/0/{1+i}` for agent i

This ensures:
- Reproducible addresses across runs
- No conflicts with main wallets
- Easy recovery of agent funds

## Example Output

```
==============================================
   ZkAMM Simple Market Maker (Buy Only)
==============================================

Funder: 0x1234...
Funder Balance: 0.5 ETH

Creating 33 agents...

Agent Addresses:
  1. 0xabcd... [WHALE]
  2. 0xefgh... [MINNOW]
  ...

Funding 33 agents with 0.005 ETH each...
  All agents funded!

Starting trading rounds...

Round | Agent | Type     | ETH Spent | Tokens Bought
------|-------|----------|-----------|---------------
    1 |     3 | RANDOM   |   0.00043 | 12345.67
    1 |    17 | WHALE    |   0.00098 | 28901.23
    ...

==============================================
              FINAL RESULTS
==============================================

Total Volume Generated: 0.5 ETH
Total Trades: 250

Final Pool State:
  ETH Reserve: 1.5 ETH
  Token Reserve: 45000000 ROOT
  Price: 3.3e-8 ETH/ROOT
```

## Recovering Agent Funds

If you need to withdraw ETH from agent wallets:

```typescript
import { ethers } from 'ethers';

const seed = 'your seed phrase';
const masterNode = ethers.HDNodeWallet.fromPhrase(seed);
const provider = new ethers.JsonRpcProvider(RPC_URL);

for (let i = 0; i < 33; i++) {
  const agent = masterNode.deriveChild(100 + i).connect(provider);
  const balance = await provider.getBalance(agent.address);
  if (balance > ethers.parseEther('0.0001')) {
    const gasPrice = await provider.getFeeData();
    const gasCost = 21000n * gasPrice.gasPrice!;
    const tx = await agent.sendTransaction({
      to: YOUR_ADDRESS,
      value: balance - gasCost,
    });
    await tx.wait();
  }
}
```

## Troubleshooting

**"Insufficient funder balance"**
- Ensure your funder wallet has enough ETH (0.2+ for simple, 0.5+ for full)

**"Circuit files not found"**
- Run `npm run circuits:compile` in the project root
- Ensure `circuits/build/sell/sell_final.zkey` exists

**Rate limiting errors**
- Increase `TRADE_INTERVAL_MS`
- Use a premium RPC endpoint

**Gas estimation errors**
- The contracts may have changed; check addresses in config
- Ensure pool has liquidity
