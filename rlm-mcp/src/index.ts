#!/usr/bin/env node
/**
 * RLM MCP Server - Recursive Language Model capabilities for Claude Code
 *
 * Based on the paper "Recursive Language Models" (Zhang et al., 2025)
 * https://arxiv.org/abs/2512.24601
 *
 * This MCP server enables Claude Code to:
 * - Load arbitrarily large contexts as environment variables
 * - Programmatically examine, search, and chunk contexts
 * - Execute code in a sandbox to manipulate data
 * - Store results for aggregation across subagent calls
 *
 * Recursive LM calls are handled by Claude Code's Task subagents (no API cost!)
 */

import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';
import { contextStore } from './context-store.js';
import { codeExecutor } from './code-executor.js';

// Create MCP server
const server = new Server(
  {
    name: 'rlm',
    version: '1.0.0',
  },
  {
    capabilities: {
      tools: {},
    },
  }
);

// Define tools
server.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: [
    {
      name: 'rlm_load',
      description: `Load files, directories, or raw text as named context variables.
This is the first step in the RLM workflow - loading your context into memory.

Examples:
- Load a single file: rlm_load(name="config", path="./config.ts")
- Load entire codebase: rlm_load(name="codebase", path=".")
- Load specific file types: rlm_load(name="contracts", path="./contracts", extensions=[".sol"])
- Load raw text: rlm_load(name="data", content="your text here")`,
      inputSchema: {
        type: 'object',
        properties: {
          name: {
            type: 'string',
            description: 'Name for the context variable (used to reference it later)',
          },
          path: {
            type: 'string',
            description: 'File or directory path to load',
          },
          content: {
            type: 'string',
            description: 'Raw text content to load (alternative to path)',
          },
          extensions: {
            type: 'array',
            items: { type: 'string' },
            description: 'File extensions to include when loading directory (e.g., [".ts", ".js"])',
          },
        },
        required: ['name'],
      },
    },
    {
      name: 'rlm_peek',
      description: `View a portion of loaded context. Use this to understand the structure before chunking.

Examples:
- First 500 chars: rlm_peek(name="codebase", limit=500)
- Lines 100-200: rlm_peek(name="codebase", offset=100, limit=100, unit="lines")
- Skip first 1000 chars: rlm_peek(name="codebase", offset=1000, limit=500)`,
      inputSchema: {
        type: 'object',
        properties: {
          name: {
            type: 'string',
            description: 'Name of the context variable to peek',
          },
          offset: {
            type: 'number',
            description: 'Starting position (default: 0)',
          },
          limit: {
            type: 'number',
            description: 'Number of chars/lines to return (default: 1000)',
          },
          unit: {
            type: 'string',
            enum: ['chars', 'lines'],
            description: 'Unit for offset/limit (default: chars)',
          },
        },
        required: ['name'],
      },
    },
    {
      name: 'rlm_search',
      description: `Search context using keywords or regex patterns. Returns matching lines with surrounding context.

Examples:
- Find functions: rlm_search(name="codebase", pattern="function.*error")
- Find imports: rlm_search(name="code", pattern="^import", context_lines=0)
- Find TODO comments: rlm_search(name="code", pattern="TODO|FIXME", max_results=50)`,
      inputSchema: {
        type: 'object',
        properties: {
          name: {
            type: 'string',
            description: 'Name of the context variable to search',
          },
          pattern: {
            type: 'string',
            description: 'Regex pattern or keyword to search for',
          },
          context_lines: {
            type: 'number',
            description: 'Lines of context to include around matches (default: 2)',
          },
          max_results: {
            type: 'number',
            description: 'Maximum number of results (default: 20)',
          },
        },
        required: ['name', 'pattern'],
      },
    },
    {
      name: 'rlm_chunk',
      description: `Split context into smaller chunks for parallel processing by subagents.

Strategies:
- "files": Split by file boundaries (best for codebases)
- "lines": Split by number of lines
- "chars": Split by character count
- "regex": Split by custom delimiter

Examples:
- By files: rlm_chunk(name="codebase", strategy="files")
- By 100 lines each: rlm_chunk(name="data", strategy="lines", size=100)
- By 50K chars: rlm_chunk(name="doc", strategy="chars", size=50000)`,
      inputSchema: {
        type: 'object',
        properties: {
          name: {
            type: 'string',
            description: 'Name of the context variable to chunk',
          },
          strategy: {
            type: 'string',
            enum: ['lines', 'chars', 'files', 'regex'],
            description: 'Chunking strategy',
          },
          size: {
            type: 'number',
            description: 'Chunk size (lines for "lines", chars for "chars")',
          },
          delimiter: {
            type: 'string',
            description: 'Regex delimiter for "regex" strategy',
          },
        },
        required: ['name', 'strategy'],
      },
    },
    {
      name: 'rlm_store',
      description: `Store a value for later use. Use this to save results from subagent processing.

The stored value can be retrieved with rlm_get or accessed in rlm_execute.

Examples:
- Store analysis result: rlm_store(name="result_0", value="Found 3 bugs...")
- Store JSON data: rlm_store(name="parsed", value='{"count": 5}')`,
      inputSchema: {
        type: 'object',
        properties: {
          name: {
            type: 'string',
            description: 'Name for the stored value',
          },
          value: {
            type: 'string',
            description: 'Value to store',
          },
        },
        required: ['name', 'value'],
      },
    },
    {
      name: 'rlm_get',
      description: `Retrieve a stored context variable or chunk.

Examples:
- Get a chunk: rlm_get(name="codebase_chunk_0")
- Get stored result: rlm_get(name="analysis_result")`,
      inputSchema: {
        type: 'object',
        properties: {
          name: {
            type: 'string',
            description: 'Name of the context variable to retrieve',
          },
        },
        required: ['name'],
      },
    },
    {
      name: 'rlm_list',
      description: 'List all stored context variables with their metadata (size, type, line count).',
      inputSchema: {
        type: 'object',
        properties: {},
        required: [],
      },
    },
    {
      name: 'rlm_execute',
      description: `Execute JavaScript code in a sandboxed environment.

Available in sandbox:
- context: Object containing all stored variables
- get(name): Get a context variable
- store(name, value): Store a value
- console.log(): Output for debugging

Examples:
- Filter results: rlm_execute(code="return context.results.filter(r => r.includes('error'))")
- Aggregate: rlm_execute(code="const all = Object.keys(context).filter(k => k.startsWith('result_')).map(k => context[k]); return all.join('\\n')")
- Transform: rlm_execute(code="const data = JSON.parse(get('data')); store('processed', data.items.length); return data.items.length")`,
      inputSchema: {
        type: 'object',
        properties: {
          code: {
            type: 'string',
            description: 'JavaScript code to execute',
          },
          timeout: {
            type: 'number',
            description: 'Execution timeout in milliseconds (default: 30000)',
          },
        },
        required: ['code'],
      },
    },
    {
      name: 'rlm_clear',
      description: `Clear context variables to free memory.

Examples:
- Clear specific: rlm_clear(name="codebase")
- Clear all: rlm_clear()`,
      inputSchema: {
        type: 'object',
        properties: {
          name: {
            type: 'string',
            description: 'Name of context to clear (omit to clear all)',
          },
        },
        required: [],
      },
    },
  ],
}));

// Handle tool calls
server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params;

  try {
    switch (name) {
      case 'rlm_load': {
        const { name: varName, path, content, extensions } = args as {
          name: string;
          path?: string;
          content?: string;
          extensions?: string[];
        };

        const metadata = contextStore.load(varName, { path, content, extensions });

        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify(
                {
                  success: true,
                  name: metadata.name,
                  type: metadata.type,
                  length: metadata.length,
                  lineCount: metadata.lineCount,
                  estimatedTokens: metadata.estimatedTokens,
                  message: `Loaded ${metadata.length.toLocaleString()} chars (${metadata.lineCount.toLocaleString()} lines, ~${metadata.estimatedTokens.toLocaleString()} tokens) as '${varName}'`,
                },
                null,
                2
              ),
            },
          ],
        };
      }

      case 'rlm_peek': {
        const { name: varName, offset = 0, limit = 1000, unit = 'chars' } = args as {
          name: string;
          offset?: number;
          limit?: number;
          unit?: 'chars' | 'lines';
        };

        const result = contextStore.peek(varName, offset, limit, unit);

        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify(
                {
                  name: varName,
                  offset: result.offset,
                  limit: result.limit,
                  total: result.total,
                  hasMore: result.hasMore,
                  unit,
                  content: result.content,
                },
                null,
                2
              ),
            },
          ],
        };
      }

      case 'rlm_search': {
        const { name: varName, pattern, context_lines = 2, max_results = 20 } = args as {
          name: string;
          pattern: string;
          context_lines?: number;
          max_results?: number;
        };

        const results = contextStore.search(varName, pattern, context_lines, max_results);

        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify(
                {
                  name: varName,
                  pattern,
                  resultCount: results.length,
                  results: results.map((r) => ({
                    line: r.lineNumber,
                    match: r.content,
                    context: r.context.join('\n'),
                  })),
                },
                null,
                2
              ),
            },
          ],
        };
      }

      case 'rlm_chunk': {
        const { name: varName, strategy, size = 100, delimiter } = args as {
          name: string;
          strategy: 'lines' | 'chars' | 'files' | 'regex';
          size?: number;
          delimiter?: string;
        };

        const chunks = contextStore.chunk(varName, strategy, size, delimiter);

        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify(
                {
                  name: varName,
                  strategy,
                  chunkCount: chunks.length,
                  chunks: chunks.map((c) => ({
                    name: c.name,
                    index: c.index,
                    lines: `${c.startLine}-${c.endLine}`,
                    length: c.length,
                  })),
                  message: `Created ${chunks.length} chunks. Use rlm_get("${varName}_chunk_N") to retrieve each chunk.`,
                },
                null,
                2
              ),
            },
          ],
        };
      }

      case 'rlm_store': {
        const { name: varName, value } = args as { name: string; value: string };

        const metadata = contextStore.store_value(varName, value);

        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify(
                {
                  success: true,
                  name: metadata.name,
                  length: metadata.length,
                  message: `Stored ${metadata.length.toLocaleString()} chars as '${varName}'`,
                },
                null,
                2
              ),
            },
          ],
        };
      }

      case 'rlm_get': {
        const { name: varName } = args as { name: string };

        const content = contextStore.get(varName);
        const metadata = contextStore.getMetadata(varName);

        if (!content) {
          return {
            content: [
              {
                type: 'text',
                text: JSON.stringify({ error: `Context '${varName}' not found` }),
              },
            ],
            isError: true,
          };
        }

        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify(
                {
                  name: varName,
                  type: metadata?.type,
                  length: content.length,
                  content,
                },
                null,
                2
              ),
            },
          ],
        };
      }

      case 'rlm_list': {
        const contexts = contextStore.list();

        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify(
                {
                  count: contexts.length,
                  totalChars: contexts.reduce((sum, c) => sum + c.length, 0),
                  totalEstimatedTokens: contexts.reduce((sum, c) => sum + c.estimatedTokens, 0),
                  contexts: contexts.map((c) => ({
                    name: c.name,
                    type: c.type,
                    length: c.length,
                    lines: c.lineCount,
                    tokens: c.estimatedTokens,
                    chunks: c.chunks?.length,
                  })),
                },
                null,
                2
              ),
            },
          ],
        };
      }

      case 'rlm_execute': {
        const { code, timeout = 30000 } = args as { code: string; timeout?: number };

        const result = await codeExecutor.execute(code, timeout);

        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify(
                {
                  success: result.success,
                  result: result.result,
                  output: result.output,
                  error: result.error,
                  executionTimeMs: result.executionTimeMs,
                },
                null,
                2
              ),
            },
          ],
          isError: !result.success,
        };
      }

      case 'rlm_clear': {
        const { name: varName } = args as { name?: string };

        contextStore.clear(varName);

        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify({
                success: true,
                message: varName ? `Cleared '${varName}'` : 'Cleared all context variables',
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
          text: JSON.stringify({
            error: error instanceof Error ? error.message : String(error),
          }),
        },
      ],
      isError: true,
    };
  }
});

// Start server
async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error('RLM MCP server running - Recursive Language Model capabilities enabled');
}

main().catch(console.error);
