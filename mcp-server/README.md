# r00t.fund MCP Server

An MCP (Model Context Protocol) server that enables AI agents to interact with r00t.fund - a privacy-first launchpad for regenerative finance.

## Features

- **Get $ROOT price** - Current price and reserves
- **Swap quotes** - Get quotes for ETH <-> ROOT swaps
- **List live projects** - View all launched regenerative tokens
- **List active proposals** - See what's being voted on
- **Buy via x402** - Autonomous agent purchases using x402 protocol

## Installation

```bash
npm install @r00tfund/mcp-server
```

Or add to your Claude Desktop config:

```json
{
  "mcpServers": {
    "r00tfund": {
      "command": "npx",
      "args": ["@r00tfund/mcp-server"],
      "env": {
        "ZKAMM_ADDRESS": "0x...",
        "LAUNCHPAD_ADDRESS": "0x..."
      }
    }
  }
}
```

## x402 Payment Flow

AI agents can autonomously purchase $ROOT tokens:

1. Agent calls `buy_root_x402` with amount
2. Server returns x402 payment instructions
3. Agent sends payment via x402 protocol
4. Tokens are minted privately to the agent's viewing key

This enables **machine-to-land wealth transfer** - AI agents funding regeneration.

## Available Tools

| Tool | Description |
|------|-------------|
| `get_root_price` | Get current $ROOT price and reserves |
| `get_swap_quote` | Quote for buying/selling ROOT |
| `list_live_projects` | All launched project tokens |
| `list_active_proposals` | Active governance proposals |
| `get_project_price` | Price data for a specific project |
| `buy_root_x402` | Purchase ROOT via x402 payment |

## Resources

| URI | Description |
|-----|-------------|
| `r00tfund://manifesto` | Project mission and ethos |
| `r00tfund://contracts` | Contract addresses on Base |

## Example Usage

```
User: What's the current price of $ROOT?

Claude: [calls get_root_price]
The current $ROOT price is 1,000,000 ROOT per ETH, with 100 ETH in liquidity.

User: Buy 0.1 ETH worth of $ROOT

Claude: [calls buy_root_x402]
I'll help you purchase $ROOT. Here are the x402 payment details:
- Amount: 0.1 ETH
- Network: Base (eip155:8453)
- Pay to: 0x...
```

## License

MIT
