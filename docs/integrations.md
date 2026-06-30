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

## Claude Code (MCP Server)

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

### Available MCP Tools

| Tool | Description |
|:-----|:------------|
| `delta_context` | Get optimized context for a task |
| `delta_graph` | Query the dependency graph |
| `delta_blast` | Calculate blast radius for a file |
| `delta_memory` | Query the memory system |

{: .tip }
Once configured, Claude Code uses Delta automatically. You don't need to do anything differently — just chat with Claude as usual.

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
                                        │  • Embeddings│
                                        │  • Memory    │
                                        │  • Assembly  │
                                        └──────────────┘
                                               │
                                        .delta/delta.db
                                        (SQLite · local)
```
