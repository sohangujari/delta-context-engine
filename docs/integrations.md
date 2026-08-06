---
layout: default
title: Integrations
nav_order: 7
description: "Use Delta with Claude Code, Cursor, VS Code, and any AI assistant"
permalink: /integrations
---

# Integrations
{: .fs-8 }

Use Delta with your favorite AI coding tools.
{: .fs-5 .fw-300 }

---

## Claude Code (MCP Server — stdio)

Delta includes a built-in MCP (Model Context Protocol) server that integrates directly with Claude Code.

### Setup

Add to `.claude/settings.json` in your project:

```json
{
  "mcpServers": {
    "delta": {
      "command": "npx",
      "args": ["delta-ctx", "mcp"],
      "description": "Delta Context Engine - optimized context per task"
    }
  }
}
```

### How it works

1. Claude Code detects the MCP server configuration
2. Before each task, Claude calls Delta's MCP tools
3. Delta assembles the optimized context payload
4. Claude receives only the relevant files, symbols, and memories
5. **85% fewer tokens per task — automatically**

### Available MCP Tools (14)

| Tool | Description |
|:-----|:------------|
| `get_optimized_context` | Get token-optimized context for a task |
| `get_community_map` | Architectural community map |
| `get_execution_flows` | Traced execution flows from entry points |
| `get_blast_radius` | Impact analysis for changed files |
| `get_risk_scores` | File risk scores (5 dimensions) |
| `get_memory` | Query the persistent memory system |
| `save_memory` | Save architectural knowledge |
| `search_codebase` | Hybrid FTS5 + semantic search |
| `get_graph_diff` | Architectural diff vs. a snapshot |
| `get_hub_files` | Most architecturally central files |
| `get_bridge_files` | Cross-community bridge connectors |
| `get_snapshot` | List or retrieve graph snapshots |
| `save_snapshot` | Save a new graph snapshot |
| `get_stats` | Index statistics overview |

### Available MCP Prompts (5)

| Prompt | Description |
|:-------|:------------|
| `blast_radius` | "What does this change break?" — full impact analysis |
| `codebase_compass` | "How is this codebase structured?" — architecture overview |
| `fault_tracer` | "Trace this error to root cause" — debug assistant |
| `first_day` | "Get a new dev productive in minutes" — onboarding guide |
| `merge_guardian` | "Is this PR safe to merge?" — APPROVE / REVIEW / BLOCK |

{: .tip }
Once configured, Claude Code uses Delta automatically. You don't need to do anything differently — just chat with Claude as usual.

---

## HTTP MCP Server (Universal)

Start Delta as an HTTP server so **any** MCP-compatible client can connect — not just Claude Code.

### Setup

```bash
delta serve
```

This starts an HTTP MCP server at `http://127.0.0.1:7734` with all 14 tools and 5 prompts.

### Options

| Option | Default | Description |
|:-------|:--------|:------------|
| `--port <port>` | `7734` | Server port |
| `--host <host>` | `127.0.0.1` | Server host |
| `--root <path>` | `.` | Project root directory |

### Endpoints

| Endpoint | Method | Description |
|:---------|:-------|:------------|
| `/mcp` | POST | JSON-RPC MCP requests |
| `/health` | GET | Server status and tool count |

### Example: Connect from any MCP client

```bash
# Start the server
delta serve --port 7734

# Health check
curl http://127.0.0.1:7734/health

# Call a tool via JSON-RPC
curl -X POST http://127.0.0.1:7734/mcp \
  -H 'Content-Type: application/json' \
  -d '{
    "jsonrpc": "2.0",
    "id": 1,
    "method": "tools/call",
    "params": {
      "name": "search_codebase",
      "arguments": { "query": "authentication" }
    }
  }'
```

---

## OpenAI-Compatible Proxy

Delta can sit between **any** AI tool and your LLM provider, auto-injecting context into every request.

### Setup

```bash
delta proxy --provider openai --api-key $OPENAI_API_KEY
```

### How it works

1. Your AI tool sends requests to `http://127.0.0.1:7735` (the proxy)
2. Delta intercepts each request and extracts the task from the last user message
3. Delta runs its full pipeline and injects optimized context as a system message
4. The request is forwarded to your LLM provider with context included
5. **Zero configuration needed in your AI tool** — just point it at the proxy URL

### Supported Providers

| Provider | Flag | Default Model |
|:---------|:-----|:--------------|
| OpenAI | `--provider openai` | `gpt-4o` |
| OpenAI Codex | `--provider codex` | `o3-mini` |
| Anthropic | `--provider anthropic` | `claude-sonnet-4-20250514` |
| Google Gemini | `--provider gemini` | `gemini-2.5-flash` |
| OpenCode | `--provider opencode` | `default` |
| Local LLM | `--provider local` | `llama3` (Ollama) |

### Options

| Option | Default | Description |
|:-------|:--------|:------------|
| `--port <port>` | `7735` | Proxy port |
| `--provider <name>` | `openai` | LLM provider |
| `--model <model>` | Provider default | Model name override |
| `--api-key <key>` | `$OPENAI_API_KEY` | API key |
| `--root <path>` | `.` | Project root |

### Example: Use with any tool

```bash
# Start the proxy
delta proxy --provider openai

# Point your tool at the proxy
export OPENAI_API_BASE=http://127.0.0.1:7735/v1

# Now use your tool as normal — Delta context is auto-injected
your-ai-tool "fix the auth bug"
```

---

## Cursor

### Setup

```bash
delta cursor-init
```

This command:
1. Creates `.cursor/rules` with Delta-optimized instructions
2. Configures auto-update of `.delta/cursor-context.md`

### How it works

Every time you run `delta run`, the context is also written to `.delta/cursor-context.md`. Cursor reads this file as additional context for its AI completions.

### Manual usage

You can also pipe Delta output directly:

```bash
# Generate context and let Cursor pick it up
delta run "your task" > .delta/cursor-context.md
```

---

## VS Code Extension

### Install

Search for **"∆ Delta Context Engine"** in the VS Code Marketplace, or:

```bash
code --install-extension delta-context-engine
```

### Features

| Feature | Description |
|:--------|:------------|
| **Sidebar** | Live token savings per task |
| **Context Manifest** | Visual breakdown of which files are included and why |
| **Status Bar** | Token counter showing savings in real-time |
| **Commands** | One-click init, run, and watch from the command palette |

### Available Commands

Open the command palette (`Cmd+Shift+P` / `Ctrl+Shift+P`) and type "Delta":

- `Delta: Initialize Project`
- `Delta: Run Task`
- `Delta: Watch Mode`
- `Delta: Show Stats`
- `Delta: Show Report`

---

## Any AI Assistant (CLI)

Delta outputs plain text to stdout, so it works with **any** AI assistant:

### Copy to Clipboard

```bash
# macOS
delta run "your task" | pbcopy

# Linux (requires xclip)
delta run "your task" | xclip -selection clipboard

# Windows (PowerShell)
delta run "your task" | Set-Clipboard
```

### Save to File

```bash
delta run "your task" > context.md
```

### Pipe to Another Tool

```bash
# Use with any CLI tool that accepts stdin
delta run "your task" | your-ai-tool --context -
```

---

## CI/CD Integration

### GitHub Actions

Use Delta in your CI pipeline to generate architectural reports:

```yaml
name: Delta Analysis
on: [push]

jobs:
  analyze:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: '20'

      - name: Install Delta
        run: npm install -g delta-ctx

      - name: Initialize
        run: delta init

      - name: Risk Report
        run: delta risk

      - name: Blast Radius (changed files)
        run: |
          for file in $(git diff --name-only HEAD~1); do
            echo "=== $file ==="
            delta blast "$file" 2>/dev/null || true
          done
```

### Pre-commit Hook

Add Delta analysis to your git pre-commit hook:

```bash
#!/bin/sh
# .git/hooks/pre-commit

echo "∆ Running Delta analysis..."

# Check for high-risk changes
for file in $(git diff --cached --name-only); do
  risk=$(delta blast "$file" 2>/dev/null | grep "Risk:" | head -1)
  if echo "$risk" | grep -q "HIGH"; then
    echo "⚠ HIGH risk change detected: $file"
    echo "$risk"
    echo "Consider reviewing before committing."
  fi
done
```

---

## Architecture

```
Your Editor
     │
     ├──── Claude Code ──── MCP Server (stdio) ──── Delta Core
     │
     ├──── Any MCP Client ──── HTTP Server (:7734) ──── Delta Core
     │
     ├──── Any AI Tool ──── Proxy (:7735) ──── LLM Provider
     │                          │
     │                    Delta auto-injects
     │                    context into requests
     │
     ├──── Cursor ──── .cursor/rules + .delta/cursor-context.md
     │
     ├──── VS Code ──── Extension ──── Delta CLI
     │
     └──── Any Tool ──── stdout / file ──── Delta CLI
                                               │
                                        ┌──────┴──────┐
                                        │  Delta Core  │
                                        │              │
                                        │  • Change    │
                                        │    Detection │
                                        │  • AST       │
                                        │    Parsing   │
                                        │  • Graph     │
                                        │  • Search    │
                                        │  • Embeddings│
                                        │  • Memory    │
                                        │  • Assembly  │
                                        └──────────────┘
                                               │
                                        .delta/delta.db
                                        (SQLite · local)
```
