# RLM MCP Server

**Recursive Language Model capabilities for Claude Code**

Based on the paper ["Recursive Language Models"](https://arxiv.org/abs/2512.24601) (Zhang et al., 2025), this MCP server enables Claude Code to handle arbitrarily long contexts by treating them as external environment variables that can be programmatically examined, decomposed, and recursively processed.

## Key Features

- **Load Any Size Context**: Load entire codebases, documentation, or data files into memory
- **Programmatic Manipulation**: Search, filter, and chunk context with code
- **Recursive Processing**: Use Claude Code's Task subagents to process chunks in parallel
- **No Extra API Costs**: Recursive calls use your existing Claude Code subscription
- **Sandboxed Code Execution**: Safe JavaScript execution environment

## Installation

```bash
cd rlm-mcp
npm install
npm run build
```

## Configuration

Add to your Claude Code settings (`~/.claude.json` or project's `.claude/settings.json`):

```json
{
  "mcpServers": {
    "rlm": {
      "command": "node",
      "args": ["/Users/0x0010110/Documents/GitHub/HideMyCoin/rlm-mcp/dist/index.js"]
    }
  }
}
```

Then restart Claude Code.

## Tools

### `rlm_load`
Load files, directories, or raw text as named context variables.

```
rlm_load(name="codebase", path=".")                    # Load entire directory
rlm_load(name="config", path="./config.ts")            # Load single file
rlm_load(name="contracts", path="./src", extensions=[".sol"])  # Filter by type
rlm_load(name="data", content="your text here")        # Load raw text
```

### `rlm_peek`
View a portion of loaded context.

```
rlm_peek(name="codebase", limit=500)                   # First 500 chars
rlm_peek(name="codebase", offset=100, limit=100, unit="lines")  # Lines 100-200
```

### `rlm_search`
Search context using regex patterns.

```
rlm_search(name="codebase", pattern="function.*error")
rlm_search(name="code", pattern="TODO|FIXME", max_results=50)
```

### `rlm_chunk`
Split context into chunks for parallel processing.

```
rlm_chunk(name="codebase", strategy="files")           # Split by file boundaries
rlm_chunk(name="data", strategy="lines", size=100)     # 100 lines per chunk
rlm_chunk(name="doc", strategy="chars", size=50000)    # 50K chars per chunk
```

### `rlm_store` / `rlm_get`
Store and retrieve values (for passing results between subagents).

```
rlm_store(name="result_0", value="Analysis found 3 issues...")
rlm_get(name="result_0")
```

### `rlm_list`
List all stored context variables with metadata.

### `rlm_execute`
Execute JavaScript in a sandboxed environment.

```
rlm_execute(code="return context.results.filter(r => r.includes('error'))")
rlm_execute(code="const all = Object.keys(context).filter(k => k.startsWith('result_')).map(k => context[k]); return all.join('\\n')")
```

### `rlm_clear`
Clear context variables to free memory.

```
rlm_clear(name="codebase")  # Clear specific
rlm_clear()                  # Clear all
```

## Usage Example: Analyzing a Large Codebase

When you ask Claude Code to analyze a large codebase:

```
You: "Analyze this codebase for security vulnerabilities"

Claude Code (using RLM):
1. rlm_load("project", ".")              # Load 5M chars
2. rlm_list()                            # See what's loaded
3. rlm_peek("project", 0, 500)           # Understand structure
4. rlm_chunk("project", "files")         # Split by files

5. For each chunk, spawn a Task subagent:
   Task(subagent_type="general-purpose", prompt="
     Use rlm_get('project_chunk_0') to read the code.
     Analyze for security vulnerabilities.
     Use rlm_store('result_0', findings) to save results.
   ")

6. rlm_execute("
     const results = Object.keys(context)
       .filter(k => k.startsWith('result_'))
       .map(k => context[k]);
     return results.join('\\n---\\n');
   ")

7. Present aggregated findings to user
```

## How It Works

```
┌─────────────────────────────────────────────────────────────┐
│                     Claude Code (Opus 4.5)                   │
│                    Your Pro Max Subscription                 │
├─────────────────────────────────────────────────────────────┤
│                                                              │
│   ┌─────────────┐      ┌─────────────────────────────────┐  │
│   │  RLM MCP    │      │     Task Subagents              │  │
│   │  Server     │      │  (Built-in, no extra cost)      │  │
│   │             │      │                                 │  │
│   │ • load      │      │  Subagent 1: Process chunk A    │  │
│   │ • peek      │◄────►│  Subagent 2: Process chunk B    │  │
│   │ • search    │      │  Subagent 3: Process chunk C    │  │
│   │ • chunk     │      │  ...                            │  │
│   │ • execute   │      │  Aggregator: Combine results    │  │
│   │ • store     │      │                                 │  │
│   └─────────────┘      └─────────────────────────────────┘  │
│          │                                                   │
│          ▼                                                   │
│   ┌─────────────────────────────────────────────────────┐   │
│   │              Context Store (In-Memory)               │   │
│   │  • codebase: 5.2M chars (your project)              │   │
│   │  • chunk_0: 100K chars                              │   │
│   │  • result_0: "Found issues..."                      │   │
│   └─────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────┘
```

## Benefits

- ✅ **No extra API costs** - Uses your existing Claude Code subscription
- ✅ **Handle any size** - Process codebases of 10M+ tokens
- ✅ **Parallel processing** - Multiple Task subagents work concurrently
- ✅ **Programmatic control** - Filter, search, transform with code
- ✅ **Safe execution** - Sandboxed JavaScript environment
- ✅ **Persistent state** - Results stored across subagent calls

## Reference

Based on: Zhang, A.L., Kraska, T., & Khattab, O. (2025). Recursive Language Models. arXiv:2512.24601
