---
layout: default
title: Commands
nav_order: 3
description: "Complete reference for all Delta CLI commands"
permalink: /commands
---

# Commands Reference
{: .fs-8 }

Complete reference for every `delta` CLI command.
{: .fs-5 .fw-300 }

---

## Overview

Delta provides **25 commands** organized into 6 categories:

| Category | Commands |
|:---------|:---------|
| [Core](#core-commands) | `init`, `run`, `stats`, `watch`, `report`, `repair` |
| [Search](#search-commands) | `search` |
| [Graph Intelligence](#graph-intelligence-commands) | `communities`, `flows`, `blast`, `risk`, `hubs`, `snapshot` |
| [Memory](#memory-commands) | `memory` (with 9 subcommands) |
| [File Management](#file-management-commands) | `include`, `exclude`, `graph` |
| [Integrations](#integration-commands) | `cursor-init`, `mcp`, `serve`, `proxy`, `providers` |

---

## Core Commands

### `delta init`

Index your codebase. This is the first command you run in any project.

```bash
delta init [path]
```

| Argument | Default | Description |
|:---------|:--------|:------------|
| `path` | `.` (current directory) | Project root directory to index |

**What it does (11 steps):**

1. Saves configuration to `.delta/config.json`
2. Scans for files (56+ extensions, respects `.gitignore` + `.deltaignore`)
3. Indexes files with SHA-256 hashing
4. Parses and extracts symbols (functions, imports, exports, types) via tree-sitter
5. Builds the dependency graph (import/require resolution)
6. Detects architectural communities (Leiden algorithm)
7. Traces execution flows (HTTP routes, CLI commands, events)
8. Calculates risk scores (5 dimensions per file)
9. Detects hubs and bridges (Brandes centrality + Tarjan)
10. Generates embeddings (if provider available)
11. Builds FTS5 search index across symbols, files, memory, flows, and communities

**Example:**

```bash
# Index current directory
delta init

# Index a specific project
delta init /path/to/project
```

{: .tip }
Re-run `delta init` anytime to rebuild the full index. Delta is incremental — only changed files are re-processed.

---

### `delta run`

Assemble optimized context for a task. This is the command you use most.

```bash
delta run "task description" [options]
```

| Option | Default | Description |
|:-------|:--------|:------------|
| `--budget <tokens>` | `2000` | Override the token budget |
| `--verbose` | `false` | Show relevance scores and detailed manifest |
| `--root <path>` | `.` | Project root directory |

**How it works:**

1. Detects which files changed since the last run (via `git diff` or hash comparison)
2. Traces the dependency graph from changed files (depth 0 → full, depth 1 → symbols, depth 2 → summaries)
3. Scores every file for relevance using hybrid scoring (semantic embeddings + graph distance)
4. Injects relevant memories from the memory system
5. Assembles a compressed context payload within the token budget
6. Outputs the context to stdout

**Examples:**

```bash
# Basic usage
delta run "fix the JWT expiry bug in login"

# Higher budget for complex tasks
delta run "refactor the payment module" --budget 8000

# See what's included and why
delta run "add unit tests for auth" --verbose

# Copy to clipboard (macOS)
delta run "your task" | pbcopy

# Save to file
delta run "your task" > context.md
```

**Output format:**

```
Context Manifest:
  ✅ src/auth/login.ts              (full)    800 tok
  ○  src/utils/jwt.ts               (symbols) 180 tok
  ○  src/types/auth.ts              (symbols) 120 tok
  ·  src/config/env.ts              (summary)  30 tok
  ✗  src/payments/stripe.ts         (excluded)

──────────────────────────────────────────────
Before:  ████████████████████ 13,205
After:   ██░░░░░░░░░░░░░░░░░░  1,928
Saved:   11,277 tokens  (85% reduction · 6.8× fewer)
```

---

### `delta stats`

Show index statistics and compression rates.

```bash
delta stats [--root <path>]
```

**Output:**

```
∆ Delta — Index Statistics
──────────────────────────────────────────────
Files indexed:      847
Symbols extracted:  12,847 functions · 3,201 exports
Graph edges:        2,341
Communities:        6
Embeddings:         847 vectors (768 dimensions)
Database size:      4.2 MB
```

---

### `delta watch`

Watch for file changes and update the index automatically in real-time.

```bash
delta watch [--root <path>]
```

Runs continuously in the background. When you save a file, Delta:
1. Detects the change
2. Re-parses the file
3. Updates the dependency graph
4. Re-scores affected files

{: .tip }
Run `delta watch` in a separate terminal while coding. Your index stays fresh without manual re-runs.

---

### `delta report`

Show session history and tokens saved.

```bash
delta report [options]
```

| Option | Description |
|:-------|:------------|
| `--markdown` | Export report as Markdown to `.delta/reports/YYYY-MM-DD.md` |
| `--root <path>` | Project root directory |

**Output:**

```
∆ Delta - Session Report
─────────────────────────────────────────────
This Week
  Tasks completed:   89
  Tokens used:       171,712
  Tokens saved:      1,156,788
  Avg reduction:     87%

  Weekly budget:     ████░░░░░░░░░░░░░░░░░░ 17%
  Est. tasks left:   ~429 at current rate

All Time
  Total tasks:       312
  Total saved:       4,231,089 tokens
  Avg reduction:     85%
```

---

### `delta repair`

Fix corrupt or stale index entries. Useful after git rebase, branch switch, or disk issues.

```bash
delta repair [--root <path>]
```

**What it does:**
- Removes entries for files that no longer exist
- Re-hashes files with stale checksums
- Rebuilds broken graph edges
- Cleans orphaned embeddings

---

## Graph Intelligence Commands

### `delta communities`

List detected architectural communities. Communities are clusters of files that are tightly coupled internally but loosely coupled to other clusters.

```bash
delta communities [options]
```

| Option | Description |
|:-------|:------------|
| `--root <path>` | Project root directory |
| `--show <name>` | Show all files in a specific community |
| `--verbose` | Show cohesion and coupling scores |

**Examples:**

```bash
# List all communities
delta communities

# See which files belong to "auth"
delta communities --show auth

# See quality scores
delta communities --verbose
```

**Output:**

```
∆ Delta — Architectural Communities
──────────────────────────────────────────────
Community             Files  Cohesion  Coupling
auth                    8     0.82      0.15
payments                6     0.78      0.21
data-layer             12     0.71      0.18
api-routes              9     0.69      0.24
utils                  11     0.85      0.31
config                  8     0.91      0.12
──────────────────────────────────────────────
6 communities · modularity: 0.71
```

{: .note }
Communities are detected using the **Leiden algorithm**, which is the state-of-the-art for community detection in large graphs.

---

### `delta flows`

List detected execution flows. Flows trace entry points (HTTP routes, CLI commands, event handlers) through the dependency graph.

```bash
delta flows [options]
```

| Option | Description |
|:-------|:------------|
| `--root <path>` | Project root directory |
| `--type <type>` | Filter by entry type: `HTTP_ROUTE`, `CLI_CMD`, `EVENT`, `EXPORT`, `TEST` |
| `--show <id>` | Show full call chain for a specific flow |
| `--file <path>` | Show flows touching a specific file |

**Examples:**

```bash
# List all flows
delta flows

# Show only HTTP routes
delta flows --type HTTP_ROUTE

# See full call chain
delta flows --show <flow-id>

# What flows touch this file?
delta flows --file src/utils/jwt.ts
```

**Output:**

```
∆ Delta — Execution Flows
──────────────────────────────────────────────────────────────
Name                        Type        Depth  Files  Criticality
POST /api/login             HTTP_ROUTE  6      8      0.84 ← HIGH
POST /api/register          HTTP_ROUTE  5      7      0.76
delta init                  CLI_CMD     9      14     0.95 ← HIGH
delta run                   CLI_CMD     8      12     0.89 ← HIGH
handlePaymentWebhook        EVENT       4      5      0.62
```

---

### `delta blast`

Calculate the **blast radius** of changing a specific file. Shows every file, community, and execution flow affected by a change.

```bash
delta blast <file> [options]
```

| Option | Default | Description |
|:-------|:--------|:------------|
| `--root <path>` | `.` | Project root directory |
| `--symbol <name>` | — | Scope analysis to a specific function |
| `--depth <n>` | `5` | Maximum traversal depth |

**Example:**

```bash
delta blast src/utils/jwt.ts
```

**Output:**

```
∆ Blast Radius: src/utils/jwt.ts
──────────────────────────────────────────────
Risk: HIGH (0.84)
  ├─ Dependent files: 23   (direct: 6, transitive: 17)
  ├─ Communities:      3   (auth, api, payments)
  ├─ Flows affected:   4   (avg criticality: 0.81)
  └─ Test gaps:        4   (17% of affected files)

Direct dependents (depth=1):
  src/auth/login.ts
  src/auth/register.ts
  src/middleware/auth-guard.ts
  src/api/routes/protected.ts
  src/utils/token-refresh.ts
  src/workers/session-cleanup.ts  ← SURPRISE

Flows affected:
  POST /api/login           crit=0.84  3 steps affected ← HIGH
  POST /api/register        crit=0.76  2 steps affected
  handleTokenRefresh        crit=0.55  1 step affected

Test gaps (no coverage):
  src/middleware/auth-guard.ts
  src/workers/session-cleanup.ts
  src/api/routes/protected.ts
  src/utils/token-refresh.ts
──────────────────────────────────────────────
Recommendation: REVIEW before committing
```

{: .important }
Blast radius is essential before refactoring. Always run `delta blast` on a file before making significant changes to understand the full impact.

---

### `delta risk`

Show file risk scores across 5 dimensions.

```bash
delta risk [options]
```

| Option | Description |
|:-------|:------------|
| `--root <path>` | Project root directory |
| `--file <path>` | Show per-dimension breakdown for one file |
| `--all` | Include LOW risk files in output |

**Risk Dimensions:**

| Dimension | What it measures |
|:----------|:-----------------|
| **Security** | Keywords in path/exports (password, auth, token, eval, exec) |
| **Test Coverage** | Whether any test file imports this module |
| **Cross-Community** | Number of communities that depend on this file |
| **Flow Participation** | How many critical execution flows touch this file |
| **Surprise Coupling** | Unexpected cross-community edges (weak connections) |

**Examples:**

```bash
# Show high risk files
delta risk

# Detailed breakdown for one file
delta risk --file src/utils/jwt.ts
```

**Output (per-file breakdown):**

```
∆ Risk Score: src/utils/jwt.ts
──────────────────────────────────────────────
Overall:  HIGH (0.82)

Dimensions:
  Security:           ████████░░  0.80
  Test coverage:      ██████████  1.00
  Cross-community:    ██████░░░░  0.60
  Flow participation: ████████░░  0.75
  Surprise coupling:  ████░░░░░░  0.40
```

---

### `delta hubs`

Show architectural hubs (bottleneck files) and bridges (chokepoint files whose removal disconnects communities).

```bash
delta hubs [options]
```

| Option | Description |
|:-------|:------------|
| `--root <path>` | Project root directory |
| `--bridges` | Show bridge files only |
| `--surprise` | Show high surprise-coupling files only |
| `--all` | Show all metrics |

**Example:**

```bash
# Top hubs by betweenness centrality
delta hubs

# Bridge files (architectural chokepoints)
delta hubs --bridges
```

**Output:**

```
∆ Delta — Architectural Hubs
──────────────────────────────────────────────
TOP HUBS (by betweenness centrality):
  src/persistence/delta-db.ts     0.92  ← 23 dependents  [HUB]
  src/core/graph/graph-store.ts   0.81  ← 18 dependents  [HUB] [BRIDGE]
  src/utils/helpers.ts            0.74  ← 15 dependents  [HUB]

BRIDGES (removal disconnects communities):
  src/core/graph/graph-store.ts   connects: data-layer ↔ api-routes
  src/config/env.ts               connects: config ↔ utils
```

{: .note }
**Hubs** use Brandes betweenness centrality (O(VE), sampled for large graphs). **Bridges** use Tarjan's algorithm (O(V+E)).

---

### `delta snapshot`

Save and compare graph states over time. Answer: "What changed architecturally this sprint?"

```bash
delta snapshot <subcommand> [args] [options]
```

| Subcommand | Description |
|:-----------|:------------|
| `save <label>` | Save current graph state with a label |
| `list` | List all saved snapshots |
| `diff <label>` | Compare current state to a snapshot |
| `delete <label>` | Remove a snapshot |

| Option | Description |
|:-------|:------------|
| `--root <path>` | Project root directory |
| `--notes <text>` | Add notes to a snapshot |

**Examples:**

```bash
# Save a snapshot before a sprint
delta snapshot save "sprint-42-start" --notes "Before payments refactor"

# After the sprint, see what changed
delta snapshot diff "sprint-42-start"

# List all snapshots
delta snapshot list

# Clean up old snapshots
delta snapshot delete "sprint-40-start"
```

**Diff output:**

```
∆ Graph Diff: "sprint-42-start" → current
──────────────────────────────────────────────
Snapshot: 847 files · 2,341 edges
Current:  862 files · 2,489 edges

Files added (15):
  + src/payments/stripe-v2.ts
  + src/payments/refund-handler.ts
  ...

Files modified (23):
  ~ src/payments/checkout.ts
  ~ src/api/routes/billing.ts
  ...

Edges: +148 added · -12 removed

New hubs:
  src/payments/stripe-v2.ts

Risk delta: +0.034
──────────────────────────────────────────────
+15 files · ~23 modified · +148 edges · +1 new hub
```

---

## Memory Commands

### `delta memory`

Manage Delta's persistent memory system. Memories are automatically captured during `delta run` and injected as context in future tasks.

```bash
delta memory <subcommand> [options]
```

| Subcommand | Description |
|:-----------|:------------|
| `list` | List all memories with source, type, and staleness |
| `show <id>` | Show full details of a specific memory |
| `add` | Interactively add a manual memory |
| `forget <id>` | Delete a specific memory |
| `search <query>` | Full-text search across all memories |
| `export` | Export all memories to JSON |
| `import <file>` | Import memories from a JSON file |
| `stats` | Show memory statistics |
| `confirm <id>` | Re-validate a stale memory |

**Examples:**

```bash
# List all memories
delta memory list

# Search for relevant context
delta memory search "authentication flow"

# Add an important architectural decision
delta memory add

# Export for backup or sharing
delta memory export > memories.json

# Import on another machine
delta memory import memories.json

# Check memory health
delta memory stats
```

{: .note }
Memories are automatically marked as **stale** when the files they reference change. Use `delta memory confirm <id>` to re-validate a memory after verifying it's still accurate.

---

## File Management Commands

### `delta include`

Force-add a file to the next context payload, regardless of relevance scoring.

```bash
delta include <file> [--root <path>]
```

### `delta exclude`

Force-remove a file from the next context payload.

```bash
delta exclude <file> [--root <path>]
```

### `delta graph`

Show the dependency graph for a specific file.

```bash
delta graph <file> [options]
```

| Option | Description |
|:-------|:------------|
| `--root <path>` | Project root directory |
| `--open` | Render and open SVG graph in browser |

**Examples:**

```bash
# Text view of dependencies
delta graph src/auth/login.ts

# Open visual graph in browser
delta graph src/auth/login.ts --open
```

---

## Search Commands

### `delta search`

Hybrid search across your entire codebase — symbols, files, memory, flows, and communities.

```bash
delta search <query> [options]
```

| Option | Default | Description |
|:-------|:--------|:------------|
| `--root <path>` | `.` | Project root |
| `--scope <scope>` | `all` | `all`, `symbols`, `files`, `memory`, `flows`, `communities` |
| `--limit <n>` | `20` | Max results |
| `--json` | off | Output as JSON |
| `-v, --verbose` | off | Show BM25/RRF scores |

**How search works:**
- Uses FTS5 full-text search with BM25 scoring across 5 virtual tables
- When embeddings are available, automatically switches to **Hybrid mode**: combines FTS5 + vector search using Reciprocal Rank Fusion (RRF, k=60)
- Results are grouped by type: symbols → files → memory → flows → communities

**Examples:**

```bash
# Search everything
delta search "authentication"

# Search only symbols
delta search "validateToken" --scope symbols

# JSON output for scripting
delta search "payment" --json

# Verbose with scores
delta search "error handling" -v
```

---

## Integration Commands

### `delta mcp`

Start the MCP (Model Context Protocol) server. Exposes 14 tools and 5 prompts.

```bash
delta mcp [options]
```

| Option | Default | Description |
|:-------|:--------|:------------|
| `--transport <type>` | `stdio` | Transport: `stdio` or `http` |
| `--port <port>` | `7734` | HTTP server port (only with `--transport http`) |
| `--host <host>` | `127.0.0.1` | HTTP server host (only with `--transport http`) |

**Examples:**

```bash
# stdio mode (for Claude Code)
delta mcp

# HTTP mode (for any MCP client)
delta mcp --transport http

# HTTP on custom port
delta mcp --transport http --port 8080
```

See [Integrations](/delta-context-engine/integrations) for setup instructions.

### `delta serve`

Start an HTTP MCP server for universal tool access.

```bash
delta serve [options]
```

| Option | Default | Description |
|:-------|:--------|:------------|
| `--root <path>` | `.` | Project root |
| `--port <port>` | `7734` | Server port |
| `--host <host>` | `127.0.0.1` | Server host |

Exposes all 14 MCP tools and 5 prompts over HTTP. Any MCP-compatible client can connect.

**Endpoints:**

| Endpoint | Method | Description |
|:---------|:-------|:------------|
| `/mcp` | POST | JSON-RPC MCP requests |
| `/health` | GET | Server status |

**Example:**

```bash
# Start server
delta serve --port 7734

# Health check
curl http://127.0.0.1:7734/health

# Call a tool
curl -X POST http://127.0.0.1:7734/mcp \
  -H 'Content-Type: application/json' \
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/call","params":{"name":"get_stats","arguments":{}}}'
```

### `delta proxy`

Start an OpenAI-compatible proxy that auto-injects Delta context into every LLM request.

```bash
delta proxy [options]
```

| Option | Default | Description |
|:-------|:--------|:------------|
| `--root <path>` | `.` | Project root |
| `--port <port>` | `7735` | Proxy port |
| `--provider <name>` | `openai` | `openai`, `codex`, `anthropic`, `gemini`, `opencode`, `local` |
| `--model <model>` | Provider default | Model name override |
| `--api-key <key>` | `$OPENAI_API_KEY` | API key |

**How it works:** Intercepts LLM requests, extracts the task, runs Delta's full pipeline, injects context as a system message, then forwards to the provider.

**Example:**

```bash
# Start proxy
delta proxy --provider openai

# Point your tools at the proxy
export OPENAI_API_BASE=http://127.0.0.1:7735/v1
```

### `delta cursor-init`

Set up Cursor editor integration.

```bash
delta cursor-init
```

Writes `.cursor/rules` with Delta instructions and auto-updates `.delta/cursor-context.md` on every `delta run`.

### `delta providers`

Show embedding provider status and which one is active.

```bash
delta providers
```

---

## Global Options

These options work with most commands:

| Option | Description |
|:-------|:------------|
| `--root <path>` | Project root directory (default: `.`) |
| `--help` | Show help for a command |
| `--version` | Show Delta version |

```bash
# Get help for any command
delta run --help
delta blast --help
delta memory --help
```
