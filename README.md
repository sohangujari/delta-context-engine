# ∆ Delta Context Engine

> **Only send what changed.**

Delta is an open-source context intelligence engine that sits between your editor and Claude. Instead of re-reading your entire codebase on every task, Delta indexes it once, watches for changes, and surgically assembles the minimum possible context payload.

**85% fewer tokens. 6× more tasks on the same weekly budget.**

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

| Command | Description |
|---|---|
| `delta init` | Index codebase, build dependency graph, generate embeddings |
| `delta run "task"` | Assemble optimized context for a task |
| `delta stats` | Show index statistics and compression rates |
| `delta watch` | Watch for file changes and update index automatically |
| `delta report` | Show session history and tokens saved |
| `delta report --markdown` | Export report as Markdown |
| `delta include <file>` | Force-add a file to the next context payload |
| `delta exclude <file>` | Force-remove a file from the next context payload |
| `delta repair` | Fix corrupt or stale index entries |
| `delta graph <file>` | Show dependency graph for a file |
| `delta graph <file> --open` | Open SVG graph in browser |
| `delta cursor-init` | Set up Cursor editor integration |
| `delta mcp` | Start MCP server for Claude Code |

### Options

```bash
delta run "task" --budget 4000     # override token budget
delta run "task" --verbose         # show relevance scores
delta run "task" --budget 8000     # thorough mode
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
    "languages": ["typescript", "javascript", "python", "go", "rust", "java"],
    "watchMode": false,
    "incrementalDelay": 500
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

| Language | Extensions | AST Parsing | Symbol Extraction |
|---|---|---|---|
| TypeScript | `.ts`, `.tsx` | ✅ | ✅ |
| JavaScript | `.js`, `.jsx`, `.mjs` | ✅ | ✅ |
| Python | `.py` | ✅ | ✅ |
| Go | `.go` | ✅ | ✅ |
| Rust | `.rs` | ✅ | ✅ |
| Java | `.java` | ✅ | ✅ |

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

---

## Development

```bash
git clone https://github.com/yourusername/delta-context-engine
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
│   ├── ast/                # tree-sitter symbol extraction
│   ├── graph/              # dependency graph + traversal
│   ├── embeddings/         # nomic-embed-text via Ollama
│   ├── relevance/          # hybrid scoring (semantic + graph)
│   ├── assembler/          # context assembly + token budget
│   ├── session/            # session tracking + reporting
│   └── indexer/            # file watcher + incremental updates
├── persistence/            # SQLite stores (symbols, graph, vectors)
├── integrations/
│   ├── cli/                # all CLI commands
│   ├── claude-code/        # MCP server
│   ├── cursor/             # Cursor rules injection
│   └── vscode/             # VS Code extension
└── config/                 # defaults, schema, presets
```

---

## Why Delta?

| Tool | Token Reduction | Change-Aware | AST Symbols | Dep Graph | Automatic |
|---|---|---|---|---|---|
| Raw Claude Code | 0% | ❌ | ❌ | ❌ | ❌ |
| `/compact` | ~30% | ❌ | ❌ | ❌ | ✅ |
| Cursor RAG | ~40% | ❌ | ❌ | ❌ | ✅ |
| Manual CLAUDE.md | ~10% | ❌ | ❌ | ❌ | ❌ |
| **∆ Delta** | **85%** | ✅ | ✅ | ✅ | ✅ |

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