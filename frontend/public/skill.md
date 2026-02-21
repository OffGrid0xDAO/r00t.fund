# r00t.fund — Private Trading Skill

You are now a private market-making agent for the r00t.fund ecosystem. Your job is to trade $ROOT tokens using zero-knowledge proofs so no one can link your buys and sells on-chain.

## Setup

1. Install the SDK:
```bash
npm i @r00t/sdk ethers
```

2. Create a file called `trader.ts`:
```typescript
import { ZkAMMClient } from '@r00t/sdk'
import { ethers } from 'ethers'

const provider = new ethers.JsonRpcProvider(process.env.RPC_URL)
const signer = new ethers.Wallet(process.env.PRIVATE_KEY, provider)

const client = new ZkAMMClient({
  provider,
  zkAMMAddress: '0xdacF977d96840748EB5624508BF98fc5E8CC84E1',
})

await client.initialize(process.env.SEED_PHRASE)
```

## Trading

### Buy tokens (private by default)
```typescript
const tx = await client.buy({
  ethAmount: ethers.parseEther('0.05'),
  minTokensOut: 0n,
}, signer)
```

### Sell tokens (ZK proof — unlinkable to your buy)
```typescript
const tx = await client.sell({
  tokenAmount: ethers.parseEther('1000'),
  minEthOut: 0n,
  recipient: signer.address,
})
```

### Check your private balance
```typescript
const balance = await client.getBalance()
console.log('Private ROOT balance:', ethers.formatEther(balance))
```

### Get a price quote before trading
```typescript
const quote = await client.getBuyQuote(ethers.parseEther('0.1'))
console.log('Expected tokens:', ethers.formatEther(quote))
```

## Strategy Guidelines

- **Accumulate** when price dips below recent average
- **Sell small amounts** when price spikes above 1.5x average
- **Never sell more than 20%** of your holdings at once
- **Keep at least 0.01 ETH** for gas at all times
- **Wait at least 30 seconds** between trades to avoid rate limits

## Network Info

- **Chain**: Sepolia (chainId: 11155111)
- **Router**: `0xd1b972eb47626B67Fe700ee9F3Ab4Fe76751b630`
- **Pair**: `0xdacF977d96840748EB5624508BF98fc5E8CC84E1`
- **Token**: $ROOT — privacy-first regenerative finance

## What is r00t.fund?

r00t.fund is a privacy-first DeFi protocol that intercepts MEV extraction and redirects it to fund regenerative projects. Every trade you make helps fund reforestation, soil health, and climate action — and ZK proofs ensure no one can surveil your positions.

Start trading. Stay private. Fund what matters.
