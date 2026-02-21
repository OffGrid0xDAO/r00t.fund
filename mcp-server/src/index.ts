#!/usr/bin/env node
/**
 * r00t.fund MCP Server
 *
 * Enables AI agents to interact with r00t.fund:
 * - Buy $ROOT tokens privately
 * - Check token prices and market data
 * - View launched regenerative projects
 * - Execute swaps on any launched token
 *
 * Supports x402 payments for autonomous agent transactions
 */

import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
  ListResourcesRequestSchema,
  ReadResourceRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';
import { createPublicClient, http, formatUnits, parseEther } from 'viem';
import { base } from 'viem/chains';

// Contract addresses
const ZKAMM_ADDRESS = process.env.ZKAMM_ADDRESS || '0x...';
const LAUNCHPAD_ADDRESS = process.env.LAUNCHPAD_ADDRESS || '0x...';

// Base mainnet client
const publicClient = createPublicClient({
  chain: base,
  transport: http(),
});

// ZkAMM ABI (minimal for reads)
const ZKAMM_ABI = [
  {
    name: 'ethReserve',
    type: 'function',
    stateMutability: 'view',
    inputs: [],
    outputs: [{ type: 'uint256' }],
  },
  {
    name: 'tokenReserve',
    type: 'function',
    stateMutability: 'view',
    inputs: [],
    outputs: [{ type: 'uint256' }],
  },
  {
    name: 'getAmountOut',
    type: 'function',
    stateMutability: 'view',
    inputs: [
      { name: 'amountIn', type: 'uint256' },
      { name: 'reserveIn', type: 'uint256' },
      { name: 'reserveOut', type: 'uint256' },
    ],
    outputs: [{ type: 'uint256' }],
  },
] as const;

const LAUNCHPAD_ABI = [
  {
    name: 'proposalCount',
    type: 'function',
    stateMutability: 'view',
    inputs: [],
    outputs: [{ type: 'uint256' }],
  },
  {
    name: 'getActiveProposals',
    type: 'function',
    stateMutability: 'view',
    inputs: [],
    outputs: [{ type: 'uint256[]' }],
  },
  {
    name: 'getLiveProjects',
    type: 'function',
    stateMutability: 'view',
    inputs: [],
    outputs: [{ type: 'address[]' }],
  },
  {
    name: 'getProposal',
    type: 'function',
    stateMutability: 'view',
    inputs: [{ name: 'proposalId', type: 'uint256' }],
    outputs: [
      {
        type: 'tuple',
        components: [
          { name: 'creator', type: 'address' },
          { name: 'pledgedHidden', type: 'uint256' },
          { name: 'name', type: 'string' },
          { name: 'symbol', type: 'string' },
          { name: 'metadataHash', type: 'bytes32' },
          { name: 'totalSupply', type: 'uint256' },
          { name: 'feeBps', type: 'uint256' },
          { name: 'votesFor', type: 'uint256' },
          { name: 'votesAgainst', type: 'uint256' },
          { name: 'votingEnds', type: 'uint256' },
          { name: 'status', type: 'uint8' },
          { name: 'ammAddress', type: 'address' },
          { name: 'createdAt', type: 'uint256' },
        ],
      },
    ],
  },
] as const;

// Create MCP server
const server = new Server(
  {
    name: 'r00tfund',
    version: '0.1.0',
  },
  {
    capabilities: {
      tools: {},
      resources: {},
    },
  }
);

// Define tools
server.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: [
    {
      name: 'get_root_price',
      description: 'Get the current price of $ROOT token in ETH and the reserves',
      inputSchema: {
        type: 'object',
        properties: {},
        required: [],
      },
    },
    {
      name: 'get_swap_quote',
      description: 'Get a quote for swapping ETH to $ROOT or $ROOT to ETH',
      inputSchema: {
        type: 'object',
        properties: {
          direction: {
            type: 'string',
            enum: ['buy', 'sell'],
            description: 'buy = ETH to ROOT, sell = ROOT to ETH',
          },
          amount: {
            type: 'string',
            description: 'Amount in ETH (for buy) or ROOT tokens (for sell)',
          },
        },
        required: ['direction', 'amount'],
      },
    },
    {
      name: 'list_live_projects',
      description: 'List all live regenerative projects launched through r00t.fund',
      inputSchema: {
        type: 'object',
        properties: {},
        required: [],
      },
    },
    {
      name: 'list_active_proposals',
      description: 'List all active proposals being voted on',
      inputSchema: {
        type: 'object',
        properties: {},
        required: [],
      },
    },
    {
      name: 'get_project_price',
      description: 'Get the current price and market data for a launched project token',
      inputSchema: {
        type: 'object',
        properties: {
          ammAddress: {
            type: 'string',
            description: 'The AMM contract address for the project',
          },
        },
        required: ['ammAddress'],
      },
    },
    {
      name: 'buy_root_x402',
      description: 'Buy $ROOT tokens using x402 payment protocol. Returns payment instructions for the agent.',
      inputSchema: {
        type: 'object',
        properties: {
          ethAmount: {
            type: 'string',
            description: 'Amount of ETH to spend (e.g., "0.1")',
          },
          recipientViewingKey: {
            type: 'string',
            description: 'The viewing key where tokens should be deposited (for privacy)',
          },
        },
        required: ['ethAmount'],
      },
    },
  ],
}));

// Handle tool calls
server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params;

  try {
    switch (name) {
      case 'get_root_price': {
        if (ZKAMM_ADDRESS === '0x...') {
          return {
            content: [
              {
                type: 'text',
                text: JSON.stringify({
                  status: 'demo_mode',
                  message: 'Contract not deployed yet. Demo data:',
                  price: '1000000 ROOT/ETH',
                  ethReserve: '100 ETH',
                  tokenReserve: '100,000,000 ROOT',
                  marketCap: '100 ETH',
                }),
              },
            ],
          };
        }

        const [ethReserve, tokenReserve] = await Promise.all([
          publicClient.readContract({
            address: ZKAMM_ADDRESS as `0x${string}`,
            abi: ZKAMM_ABI,
            functionName: 'ethReserve',
          }),
          publicClient.readContract({
            address: ZKAMM_ADDRESS as `0x${string}`,
            abi: ZKAMM_ABI,
            functionName: 'tokenReserve',
          }),
        ]);

        const price = Number(tokenReserve) / Number(ethReserve);
        const ethReserveFormatted = formatUnits(ethReserve, 18);
        const tokenReserveFormatted = formatUnits(tokenReserve, 18);

        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify({
                price: `${price.toFixed(0)} ROOT/ETH`,
                priceInverse: `${(1 / price).toFixed(10)} ETH/ROOT`,
                ethReserve: `${ethReserveFormatted} ETH`,
                tokenReserve: `${tokenReserveFormatted} ROOT`,
                marketCap: `${ethReserveFormatted} ETH (liquidity)`,
              }),
            },
          ],
        };
      }

      case 'get_swap_quote': {
        const { direction, amount } = args as { direction: 'buy' | 'sell'; amount: string };

        if (ZKAMM_ADDRESS === '0x...') {
          const mockPrice = 1000000; // ROOT per ETH
          const amountNum = parseFloat(amount);
          const output = direction === 'buy'
            ? amountNum * mockPrice * 0.997 // 0.3% fee
            : amountNum / mockPrice * 0.997;

          return {
            content: [
              {
                type: 'text',
                text: JSON.stringify({
                  status: 'demo_mode',
                  direction,
                  amountIn: `${amount} ${direction === 'buy' ? 'ETH' : 'ROOT'}`,
                  amountOut: `${output.toFixed(direction === 'buy' ? 0 : 6)} ${direction === 'buy' ? 'ROOT' : 'ETH'}`,
                  priceImpact: '< 0.1%',
                  fee: '0.3%',
                }),
              },
            ],
          };
        }

        const [ethReserve, tokenReserve] = await Promise.all([
          publicClient.readContract({
            address: ZKAMM_ADDRESS as `0x${string}`,
            abi: ZKAMM_ABI,
            functionName: 'ethReserve',
          }),
          publicClient.readContract({
            address: ZKAMM_ADDRESS as `0x${string}`,
            abi: ZKAMM_ABI,
            functionName: 'tokenReserve',
          }),
        ]);

        const amountIn = parseEther(amount);
        const reserveIn = direction === 'buy' ? ethReserve : tokenReserve;
        const reserveOut = direction === 'buy' ? tokenReserve : ethReserve;

        const amountOut = await publicClient.readContract({
          address: ZKAMM_ADDRESS as `0x${string}`,
          abi: ZKAMM_ABI,
          functionName: 'getAmountOut',
          args: [amountIn, reserveIn, reserveOut],
        });

        const priceImpact = (Number(amountIn) / Number(reserveIn)) * 100;

        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify({
                direction,
                amountIn: `${amount} ${direction === 'buy' ? 'ETH' : 'ROOT'}`,
                amountOut: `${formatUnits(amountOut, 18)} ${direction === 'buy' ? 'ROOT' : 'ETH'}`,
                priceImpact: `${priceImpact.toFixed(2)}%`,
                fee: '0.3%',
              }),
            },
          ],
        };
      }

      case 'list_live_projects': {
        if (LAUNCHPAD_ADDRESS === '0x...') {
          return {
            content: [
              {
                type: 'text',
                text: JSON.stringify({
                  status: 'demo_mode',
                  projects: [
                    {
                      name: 'Cactus',
                      symbol: 'CACT',
                      ammAddress: '0x...',
                      description: 'Regenerative desert agriculture token',
                    },
                    {
                      name: 'ForestDAO',
                      symbol: 'TREE',
                      ammAddress: '0x...',
                      description: 'Community reforestation funding',
                    },
                  ],
                }),
              },
            ],
          };
        }

        const liveProjects = await publicClient.readContract({
          address: LAUNCHPAD_ADDRESS as `0x${string}`,
          abi: LAUNCHPAD_ABI,
          functionName: 'getLiveProjects',
        });

        const projectDetails = await Promise.all(
          liveProjects.map(async (ammAddress) => {
            // Get proposal details for this AMM
            const count = await publicClient.readContract({
              address: LAUNCHPAD_ADDRESS as `0x${string}`,
              abi: LAUNCHPAD_ABI,
              functionName: 'proposalCount',
            });

            for (let i = 0; i < Number(count); i++) {
              const proposal = await publicClient.readContract({
                address: LAUNCHPAD_ADDRESS as `0x${string}`,
                abi: LAUNCHPAD_ABI,
                functionName: 'getProposal',
                args: [BigInt(i)],
              });

              if (proposal.ammAddress.toLowerCase() === ammAddress.toLowerCase()) {
                return {
                  name: proposal.name,
                  symbol: proposal.symbol,
                  ammAddress,
                  totalSupply: formatUnits(proposal.totalSupply, 18),
                  feeBps: Number(proposal.feeBps),
                };
              }
            }
            return { ammAddress, name: 'Unknown', symbol: '???' };
          })
        );

        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify({ projects: projectDetails }),
            },
          ],
        };
      }

      case 'list_active_proposals': {
        if (LAUNCHPAD_ADDRESS === '0x...') {
          return {
            content: [
              {
                type: 'text',
                text: JSON.stringify({
                  status: 'demo_mode',
                  proposals: [
                    {
                      id: 0,
                      name: 'SolarFarm',
                      symbol: 'SOLAR',
                      votesFor: '500000',
                      votesAgainst: '100000',
                      votingEnds: new Date(Date.now() + 3 * 24 * 60 * 60 * 1000).toISOString(),
                    },
                  ],
                }),
              },
            ],
          };
        }

        const activeIds = await publicClient.readContract({
          address: LAUNCHPAD_ADDRESS as `0x${string}`,
          abi: LAUNCHPAD_ABI,
          functionName: 'getActiveProposals',
        });

        const proposals = await Promise.all(
          activeIds.map(async (id) => {
            const proposal = await publicClient.readContract({
              address: LAUNCHPAD_ADDRESS as `0x${string}`,
              abi: LAUNCHPAD_ABI,
              functionName: 'getProposal',
              args: [id],
            });

            return {
              id: Number(id),
              name: proposal.name,
              symbol: proposal.symbol,
              votesFor: formatUnits(proposal.votesFor, 18),
              votesAgainst: formatUnits(proposal.votesAgainst, 18),
              votingEnds: new Date(Number(proposal.votingEnds) * 1000).toISOString(),
              pledgedHidden: formatUnits(proposal.pledgedHidden, 18),
            };
          })
        );

        return {
          content: [{ type: 'text', text: JSON.stringify({ proposals }) }],
        };
      }

      case 'get_project_price': {
        const { ammAddress } = args as { ammAddress: string };

        if (ammAddress === '0x...') {
          return {
            content: [
              {
                type: 'text',
                text: JSON.stringify({
                  status: 'demo_mode',
                  price: '100000 TOKEN/ETH',
                  ethReserve: '10 ETH',
                  tokenReserve: '1,000,000 TOKEN',
                }),
              },
            ],
          };
        }

        const [ethReserve, tokenReserve] = await Promise.all([
          publicClient.readContract({
            address: ammAddress as `0x${string}`,
            abi: ZKAMM_ABI,
            functionName: 'ethReserve',
          }),
          publicClient.readContract({
            address: ammAddress as `0x${string}`,
            abi: ZKAMM_ABI,
            functionName: 'tokenReserve',
          }),
        ]);

        const price = Number(tokenReserve) / Number(ethReserve);

        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify({
                ammAddress,
                price: `${price.toFixed(0)} TOKEN/ETH`,
                ethReserve: `${formatUnits(ethReserve, 18)} ETH`,
                tokenReserve: `${formatUnits(tokenReserve, 18)} TOKEN`,
                liquidity: `${formatUnits(ethReserve * 2n, 18)} ETH (approx)`,
              }),
            },
          ],
        };
      }

      case 'buy_root_x402': {
        const { ethAmount, recipientViewingKey } = args as {
          ethAmount: string;
          recipientViewingKey?: string;
        };

        // Return x402 payment instructions
        // The agent will use these to make the payment
        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify({
                status: 'payment_required',
                protocol: 'x402',
                paymentDetails: {
                  scheme: 'exact',
                  network: 'eip155:8453', // Base mainnet
                  asset: 'ETH',
                  amount: ethAmount,
                  payTo: ZKAMM_ADDRESS,
                  description: `Buy $ROOT tokens with ${ethAmount} ETH`,
                  // The contract will automatically mint private tokens
                  // If viewing key provided, tokens go to that key
                  recipientViewingKey: recipientViewingKey || 'generate_new',
                },
                instructions: [
                  '1. Send payment using x402 protocol to the payTo address',
                  '2. Include the recipientViewingKey in the transaction data',
                  '3. The contract will mint private $ROOT tokens to your viewing key',
                  '4. You can check your balance using the viewing key',
                ],
                note: 'Tokens are stored as private commitments. Only the viewing key holder can see the balance.',
              }),
            },
          ],
        };
      }

      default:
        return {
          content: [{ type: 'text', text: `Unknown tool: ${name}` }],
          isError: true,
        };
    }
  } catch (error) {
    return {
      content: [
        {
          type: 'text',
          text: `Error: ${error instanceof Error ? error.message : 'Unknown error'}`,
        },
      ],
      isError: true,
    };
  }
});

// Define resources
server.setRequestHandler(ListResourcesRequestSchema, async () => ({
  resources: [
    {
      uri: 'r00tfund://manifesto',
      name: 'r00t.fund Manifesto',
      description: 'The mission and ethos of r00t.fund - privacy-first regenerative finance',
      mimeType: 'text/plain',
    },
    {
      uri: 'r00tfund://contracts',
      name: 'Contract Addresses',
      description: 'Deployed contract addresses on Base',
      mimeType: 'application/json',
    },
  ],
}));

server.setRequestHandler(ReadResourceRequestSchema, async (request) => {
  const { uri } = request.params;

  switch (uri) {
    case 'r00tfund://manifesto':
      return {
        contents: [
          {
            uri,
            mimeType: 'text/plain',
            text: `
r00t.fund - where good grows

A privacy-first launchpad for regenerative finance.

THE PROBLEM:
Blockchain promised financial freedom. Instead, we got a panopticon where every
transaction is traced, every wallet is watched. Want to fund reforestation?
Your employer might see. Supporting community land trusts? Competitors are watching.

THE VISION:
r00t.fund exists because good things need room to grow — away from prying eyes.
We believe supporting regenerative projects should be as private as a cash donation.

HOW IT WORKS:
- Private by default: Tokens stored as cryptographic commitments
- Zero-knowledge proofs: Prove ownership without revealing amounts
- Community governance: Private voting on project launches
- Regenerative focus: Only projects that heal the planet

WHY r00t?
"r00t" — the foundation from which everything grows. In nature, roots are hidden
underground yet source of all life. In computing, root means full control.
The leetspeak nods to our cypherpunk heritage — privacy is a right, not a privilege.

AI AGENTS & x402:
r00t.fund supports x402 payments, enabling AI agents to autonomously purchase $ROOT
tokens. This creates a new form of wealth transfer — from machines to land, from
silicon to soil. Agents can fund regeneration without human intervention.

// built with love for the land
            `.trim(),
          },
        ],
      };

    case 'r00tfund://contracts':
      return {
        contents: [
          {
            uri,
            mimeType: 'application/json',
            text: JSON.stringify(
              {
                network: 'Base Mainnet',
                chainId: 8453,
                contracts: {
                  zkAMM: ZKAMM_ADDRESS,
                  launchpad: LAUNCHPAD_ADDRESS,
                },
                x402: {
                  facilitator: 'https://x402.org/facilitator',
                  supportedAssets: ['ETH', 'USDC'],
                },
              },
              null,
              2
            ),
          },
        ],
      };

    default:
      throw new Error(`Unknown resource: ${uri}`);
  }
});

// Start server
async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error('r00t.fund MCP server running');
}

main().catch(console.error);
