# ∆ Delta Context Engine

[![npm version](https://img.shields.io/npm/v/delta-ctx.svg)](https://www.npmjs.com/package/delta-ctx)
[![npm downloads](https://img.shields.io/npm/dm/delta-ctx.svg)](https://www.npmjs.com/package/delta-ctx)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![Docs](https://img.shields.io/badge/docs-GitHub%20Pages-blue)](https://sohangujari.github.io/delta-context-engine)

> **Only send what changed.**

Delta is an open-source context intelligence engine that sits between your editor and Claude. Instead of re-reading your entire codebase on every task, Delta indexes it once, watches for changes, and surgically assembles the minimum possible context payload.

**85% fewer tokens. 6× more tasks on the same weekly budget.**

📖 **[Read the full documentation →](https://sohangujari.github.io/delta-context-engine)**

---

## The Problem

Every AI coding task today sends your entire codebase to Claude - even when only one file changed.

```
EVERY TASK WITHOUT DELTA:
──────────────────────────────────────────────────
auth.ts              1,800 tokens  ← unchanged
user.model.ts        1,200 tokens  ← unchanged
api/routes.ts        3,100 tokens  ← unchanged
utils/helpers.ts     2,400 tokens  ← unchanged
config/db.ts           800 tokens  ← unchanged
types/index.ts       1,905 tokens  ← unchanged
login.ts               800 tokens  ← the actual change
                    ──────────
TOTAL:              12,005 tokens  ← for ONE bug fix
──────────────────────────────────────────────────

SAME TASK WITH DELTA ∆:
──────────────────────────────────────────────────
Task instruction       200 tokens  ← the actual ask
login.ts               800 tokens  ← changed file, full
Direct deps symbols    600 tokens  ← signatures only
Compressed summary     328 tokens  ← rest of app
                    ──────────
TOTAL:               1,928 tokens  ← 6.8× fewer ✅
──────────────────────────────────────────────────
```

---

## Quick Start

```bash
# Install
npm install -g delta-ctx

# Initialize (indexes your codebase once)
delta init

# Run before every task
delta run "fix the JWT expiry bug in login"
```

Output:

```
∆ Delta Context Engine
──────────────────────────────────────────────────
Task: "fix the JWT expiry bug in login"

✔ 1 file(s) changed (git)
  ● src/auth/login.ts

✔ Dependency graph traced · depth=1: 3 · depth=2: 6

✔ Semantic scoring complete · 4 files above threshold

✔ Context assembled

──────────────────────────────────────────────────
Before:  ████████████████████ 13,205
After:   ██░░░░░░░░░░░░░░░░░░  1,928
Saved:   11,277 tokens  (85% reduction · 6.8× fewer)
──────────────────────────────────────────────────

Context Manifest:
  ✅ src/auth/login.ts              (full)    800 tok
  ○  src/utils/jwt.ts               (symbols) 180 tok
  ○  src/types/auth.ts              (symbols) 120 tok
  ·  src/config/env.ts              (summary)  30 tok
  ✗  src/payments/stripe.ts         (excluded)
```

---

## How It Works

Delta runs a 4-layer pipeline on every task:

### Layer 1 - Change Detection

Detects which files changed since your last task using `git diff`. Falls back to SHA-256 hash comparison if not a git repo.

### Layer 2 - AST Symbol Extraction

Parses every file with tree-sitter and extracts function signatures, imports, exports, and types - without bodies. A 1,800-token file becomes a 120-token symbol map.

### Layer 3 - Dependency Graph

Traces the import chain from your changed file outward:

```
depth=0  login.ts           → full content
depth=1  jwt.utils.ts       → symbols only
depth=1  types/auth.ts      → symbols only
depth=2  config/env.ts      → 1-line summary
depth=3+ payments/...       → excluded entirely
```

### Layer 4 - Context Assembly

Packs everything into a hard token budget using a priority stack. Never exceeds the budget - compresses further before breaking the limit.

```
SLOT 0  Memory context      200 tokens  relevant memories injected
SLOT 1  Task instruction     200 tokens  always included
SLOT 2  Changed files        800 tokens  always included
SLOT 3  Depth-1 symbols      400 tokens  until budget
SLOT 4  Depth-2 summaries    300 tokens  until budget
SLOT 5  Project skeleton     228 tokens  if budget allows
```

---

## Token Reduction by Scenario

| Scenario | Before | After | Saved | Multiple |
|---|---|---|---|---|
| Single bug fix | 13,205 | 1,928 | 11,277 | 6.8× |
| Add new feature | 18,400 | 2,800 | 15,600 | 6.5× |
| Write unit tests | 11,200 | 1,600 | 9,600 | 7.0× |
| Refactor a module | 22,000 | 4,100 | 17,900 | 5.3× |
| Config file update | 8,400 | 900 | 7,500 | 9.3× |
| **Average** | **16,213** | **2,466** | **13,747** | **6.6×** |

---

## Installation

### Requirements

- Node.js 20+ (LTS)
- Git (for change detection)
- Ollama (optional, for semantic scoring)

### Install globally

```bash
npm install -g delta-ctx
```

### Or use without installing

```bash
npx delta-ctx init
npx delta-ctx run "your task"
```

### Enable semantic scoring (optional but recommended)

```bash
# Install Ollama from https://ollama.ai, then:
ollama pull nomic-embed-text
ollama serve
```

Delta automatically detects Ollama and enables semantic scoring. Falls back to graph-only mode if Ollama is not running.

---

## Commands

### Core Commands

| Command | Description |
|---|---|
| `delta init` | Index codebase, build graph, detect communities, trace flows, calculate risk |
| `delta run "task"` | Assemble optimized context for a task |
| `delta stats` | Show index statistics and compression rates |
| `delta watch` | Watch for file changes and update index automatically |
| `delta report` | Show session history and tokens saved |
| `delta report --markdown` | Export report as Markdown |

### Graph Intelligence (V2)

| Command | Description |
|---|---|
| `delta communities` | List detected architectural communities |
| `delta communities --show <name>` | Show files in a community with centrality scores |
| `delta communities --verbose` | Show cohesion and coupling scores |
| `delta flows` | List detected execution flows |
| `delta flows --show <id>` | Show full call chain for a flow |
| `delta flows --type HTTP_ROUTE` | Filter flows by entry type |
| `delta flows --file <path>` | Show flows touching a specific file |
| `delta blast <file>` | Calculate blast radius for a file |
| `delta blast <file> --symbol <name>` | Scope blast analysis to one function |
| `delta risk` | Show HIGH risk files with 5-dimension scores |
| `delta risk --file <path>` | Show per-dimension breakdown |
| `delta risk --all` | Show all files including LOW risk |
| `delta hubs` | Show architectural hubs by betweenness centrality |
| `delta hubs --bridges` | Show bridge files (architectural chokepoints) |
| `delta hubs --surprise` | Show unexpected cross-community connections |
| `delta snapshot save <label>` | Save current graph state |
| `delta snapshot list` | List all saved snapshots |
| `delta snapshot diff <label>` | Diff current state vs a snapshot |
| `delta snapshot delete <label>` | Remove a snapshot |

### Memory System (V2)

| Command | Description |
|---|---|
| `delta memory list` | List all memories |
| `delta memory show <id>` | Show memory details |
| `delta memory add` | Add a manual memory |
| `delta memory forget <id>` | Delete a memory |
| `delta memory search <query>` | Search memories by text |
| `delta memory export` | Export memories to JSON |
| `delta memory import <file>` | Import memories from JSON |
| `delta memory stats` | Memory statistics |
| `delta memory confirm <id>` | Re-validate a stale memory |

### Embedding Providers

| Command | Description |
|---|---|
| `delta providers` | Show embedding provider status (Ollama, OpenAI, Azure) |

### File Management

| Command | Description |
|---|---|
| `delta include <file>` | Force-add a file to the next context payload |
| `delta exclude <file>` | Force-remove a file from the next context payload |
| `delta repair` | Fix corrupt or stale index entries |
| `delta graph <file>` | Show dependency graph for a file |
| `delta graph <file> --open` | Open SVG graph in browser |

### Editor Integrations

| Command | Description |
|---|---|
| `delta cursor-init` | Set up Cursor editor integration |
| `delta mcp` | Start MCP server for Claude Code |

### Options

```bash
delta run "task" --budget 4000     # override token budget
delta run "task" --verbose         # show relevance scores
delta run "task" --budget 8000     # thorough mode
```

---

## Graph Intelligence

Delta V2 understands your codebase architecture, not just individual files.

### Community Detection

Delta uses the Leiden algorithm to automatically cluster your codebase into architectural communities:

```
✔ 6 communities detected · modularity: 0.71
  auth (8 files)  payments (6 files)  data (12 files)
  api (9 files)   utils (11 files)    config (8 files)
```

### Execution Flow Tracing

Detects entry points (HTTP routes, CLI commands, event handlers) and traces call chains:

```
POST /api/login           HTTP_ROUTE    depth=6   files=8   crit=0.84
POST /api/register        HTTP_ROUTE    depth=5   files=7   crit=0.76
delta init                CLI_CMD       depth=9   files=14  crit=0.95
```

### Blast Radius

Calculate the full impact of changing any file:

```
∆ Blast Radius: src/utils/jwt.ts
Risk: HIGH (0.84)
  ├─ Dependent files: 23   (direct: 6, transitive: 17)
  ├─ Communities:      3   (auth, api, payments)
  ├─ Flows affected:   4   (avg criticality: 0.81)
  └─ Test gaps:        4   (17% of affected files)
```

### Risk Scoring

Every file scored across 5 dimensions: security sensitivity, test coverage, cross-community callers, flow participation, and surprise coupling.

### Hub & Bridge Detection

Find architectural bottlenecks using betweenness centrality and Tarjan's bridge-finding algorithm.

### Graph Snapshots

Save and diff architectural state across time: "What changed architecturally this sprint?"

---

## Memory System

Delta remembers context across sessions. Architectural decisions, bug fixes, edge cases, and community knowledge are automatically captured and injected as SLOT 0 in context assembly.

```bash
# Memories are auto-captured from delta run sessions
# Manually add important context:
delta memory add

# Stale memories are auto-detected when related files change
```

---

## Integrations

### Claude Code (MCP Server)

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

Claude Code will call Delta automatically before every task.

### VS Code Extension

Install from the VS Code Marketplace: **∆ Delta Context Engine**

Features:
- Sidebar showing live token savings per task
- Context manifest (which files included and why)
- Status bar token counter
- One-click init, run, and watch commands

### Cursor

```bash
delta cursor-init
```

This writes `.cursor/rules` with Delta instructions and automatically updates `.delta/cursor-context.md` on every `delta run`.

### Any AI Assistant (CLI)

```bash
delta run "your task" | pbcopy       # copy to clipboard
delta run "your task" > context.md   # write to file
```

---

## Configuration

Delta works with zero config. To customize, edit `.delta/config.json`:

```json
{
  "version": "1.0",
  "budget": {
    "preset": "conservative",
    "maxTokens": 2000,
    "autoEscalate": true
  },
  "graph": {
    "maxDepth": 2,
    "includeTestFiles": true,
    "resolveNodeModules": false
  },
  "relevance": {
    "semanticThreshold": 0.45,
    "embeddingModel": "nomic-embed-text",
    "combineWithGraph": true
  },
  "indexing": {
    "watchMode": false,
    "incrementalDelay": 500
  },
  "embeddings": {
    "provider": "ollama",
    "model": "nomic-embed-text",
    "baseUrl": "http://localhost:11434",
    "dimensions": 768,
    "timeout": 30000
  }
}
```

### Token Budget Presets

| Preset | Tokens | Best for |
|---|---|---|
| `conservative` | 2,000 | Single file changes, quick fixes |
| `balanced` | 4,000 | Feature work, multi-file changes |
| `thorough` | 8,000 | Large refactors, architecture changes |

### Budget Auto-Escalation

Delta automatically expands the budget for large changes:

```
< 5 files changed   → configured budget (no change)
5–9 files changed   → balanced (4,000 tokens)
≥ 10 files changed  → thorough (8,000 tokens)
```

Disable with `"autoEscalate": false` in config.

### Embedding Providers

| Provider | Setup | Use Case |
|---|---|---|
| Ollama (default) | `ollama serve && ollama pull nomic-embed-text` | Local, private, free |
| OpenAI | Set `OPENAI_API_KEY` env var | Cloud, high quality |
| Azure OpenAI | Set `AZURE_OPENAI_API_KEY` + `AZURE_OPENAI_ENDPOINT` | Enterprise |

### .deltaignore

Works like `.gitignore`. Delta also inherits your `.gitignore` automatically.

```
# .deltaignore
node_modules/**
dist/**
*.generated.ts
coverage/**
```

---

## Language Support

### Tier 1 — Full AST Parsing (tree-sitter)

| Language | Extensions |
|---|---|
| TypeScript | `.ts`, `.tsx` |
| JavaScript | `.js`, `.jsx`, `.mjs` |
| Python | `.py` |
| Go | `.go` |
| Rust | `.rs` |
| Java | `.java` |

### Tier 2 — Pattern Extraction (regex)

C, C++, C#, Ruby, PHP, Swift, Kotlin, Scala, Dart, R, Lua, Perl, Haskell, Elixir, Clojure, and more (15+ languages).

### Tier 3 — Notebook Support

| Format | Extensions |
|---|---|
| Jupyter Notebook | `.ipynb` |
| Databricks | `.dbc` |

### Tier 4 — Minimal Indexing

Shell scripts, config files, markup, styles, and 20+ additional formats are indexed for change detection and dependency tracking.

**56+ file extensions supported across all tiers.**

---

## Monorepo Support

Delta detects and supports:

- Nx (`nx.json`)
- Turborepo (`turbo.json`)
- pnpm workspaces (`pnpm-workspace.yaml`)
- npm/yarn workspaces (`package.json` workspaces field)

Cross-package imports are resolved automatically:

```typescript
import { Button } from '@myapp/ui'
// → resolves to packages/ui/src/index.ts
```

---

## `delta init` Pipeline

```
Step 1:   Save config
Step 2:   Scan files (56+ extensions)
Step 3:   Index files (SHA-256 hashing)
Step 4:   Parse + extract symbols (multi-tier)
Step 5:   Build dependency graph
Step 6:   Detect communities (Leiden algorithm)
Step 7:   Trace execution flows
Step 8:   Calculate risk scores (5 dimensions)
Step 9:   Detect hubs and bridges (Brandes + Tarjan)
Step 10:  Generate embeddings (multi-provider)
```

---

## Session Reporting

```bash
delta report
```

```
∆ Delta - Session Report
─────────────────────────────────────────────
This Week
  Tasks completed:   89
  Tokens used:       171,712
  Tokens saved:      1,156,788
  Avg reduction:     87%

  Weekly budget:     ████░░░░░░░░░░░░░░░░░░░░░░░░░░ 17%
  Est. tasks left:   ~429 at current rate

All Time
  Total tasks:       312
  Total saved:       4,231,089 tokens
  Avg reduction:     85%
```

```bash
delta report --markdown   # exports to .delta/reports/YYYY-MM-DD.md
```

---

## Privacy

- Zero code leaves your machine. All indexing, embedding, and graph building is local only.
- No telemetry without explicit opt-in.
- No API keys required. Delta never reads, stores, or transmits secrets.
- `.delta/` directory is gitignored by default. Add it to your `.gitignore`:

```bash
echo ".delta/" >> .gitignore
```

---

## Performance

| Operation | Target | Typical |
|---|---|---|
| Initial index (10k files) | < 60s | ~23s |
| Incremental re-index | < 6s | ~270ms |
| Context assembly | < 200ms | ~80ms |
| Embedding query | < 50ms | ~12ms |
| Graph traversal (depth=2) | < 30ms | ~8ms |
| Community detection | < 5s | ~1.2s |
| Flow tracing | < 3s | ~800ms |
| Risk scoring | < 2s | ~400ms |

---

## Development

```bash
git clone https://github.com/sohangujari/delta-context-engine
cd delta-context-engine
npm install
npx tsc

# Initialize Delta on itself (dogfooding)
node dist/integrations/cli/index.js init
node dist/integrations/cli/index.js run "fix the login bug"
```

### Project Structure

```
src/
├── core/
│   ├── change-detector/    # git diff + hash tracking
│   ├── ast/                # tree-sitter + pattern + notebook extraction
│   ├── graph/              # dependency graph, communities, flows, risk, hubs, blast radius, diff
│   ├── embeddings/         # multi-provider embeddings (Ollama, OpenAI, Azure)
│   ├── memory/             # persistent memory capture, injection, staleness
│   ├── relevance/          # hybrid scoring (semantic + graph)
│   ├── assembler/          # context assembly + token budget
│   ├── session/            # session tracking + reporting
│   └── indexer/            # file watcher + incremental updates
├── persistence/            # SQLite stores (symbols, graph, vectors, memories, communities, flows, risk, hubs, snapshots)
├── integrations/
│   ├── cli/                # all CLI commands
│   ├── claude-code/        # MCP server
│   ├── cursor/             # Cursor rules injection
│   └── vscode/             # VS Code extension
└── config/                 # defaults, schema, presets
```

---

## Why Delta?

| Tool | Token Reduction | Change-Aware | AST Symbols | Dep Graph | Graph Intelligence | Memory |
|---|---|---|---|---|---|---|
| Raw Claude Code | 0% | ❌ | ❌ | ❌ | ❌ | ❌ |
| `/compact` | ~30% | ❌ | ❌ | ❌ | ❌ | ❌ |
| Cursor RAG | ~40% | ❌ | ❌ | ❌ | ❌ | ❌ |
| Manual CLAUDE.md | ~10% | ❌ | ❌ | ❌ | ❌ | ❌ |
| **∆ Delta** | **85%** | ✅ | ✅ | ✅ | ✅ | ✅ |

---

## License

MIT - see LICENSE

## Contributing

PRs welcome. Please open an issue first for large changes.

```bash
npm test           # run tests
npm run typecheck  # TypeScript strict check
npm run lint       # ESLint
```

---

<p align="center">
  <strong>∆ Delta - Only send what changed.</strong><br>
  <sub>In mathematics, delta (∆) is the symbol for change - the difference between two states.<br>
  That is exactly what this product sends to Claude: not the whole codebase, just the delta.</sub>
</p>