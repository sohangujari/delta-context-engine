---
layout: default
title: Graph Intelligence
nav_order: 4
description: "How Delta understands your codebase architecture"
permalink: /graph-intelligence
---

# Graph Intelligence
{: .fs-8 }

Delta doesn't just index files — it understands how they relate.
{: .fs-5 .fw-300 }

---

## Overview

Graph Intelligence transforms Delta from a file indexer into an **architectural analysis engine**. After `delta init`, Delta knows:

| What V1 understood | What V2 understands |
|:--------------------|:--------------------|
| Files | **Communities** (clusters of related files) |
| Imports | **Flows** (request paths from entry to leaf) |
| Depths | **Risk** (5-dimension security/coverage scoring) |
| Tokens | **Architecture** (hubs, bridges, bottlenecks) |

---

## How It Works

### The Pipeline

During `delta init`, after the basic graph is built (Step 5), four graph intelligence phases run:

```
Step 6:  Community Detection (Leiden algorithm)
           ↓
Step 7:  Execution Flow Tracing (BFS from entry points)
           ↓
Step 8:  Risk Scoring (5 dimensions per file)
           ↓
Step 9:  Hub & Bridge Detection (Brandes + Tarjan)
```

Each phase builds on the previous one:
- **Risk scoring** uses community data to detect cross-community callers
- **Hub detection** uses community data to identify bridge files
- **Blast radius** combines all four for comprehensive impact analysis

---

## Community Detection

### What are communities?

Communities are clusters of files that are **tightly coupled internally** (high cohesion) but **loosely coupled to other clusters** (low coupling). They represent natural architectural boundaries.

### Algorithm: Leiden

Delta uses the [Leiden algorithm](https://www.nature.com/articles/s41598-019-41695-z), which is the state-of-the-art for community detection:

1. **Local Moving Phase** — Each node (file) tries joining the community of its neighbors. Moves are accepted if they improve modularity (a quality measure of community structure).

2. **Refinement Phase** — Within each community, nodes are re-examined for sub-community structure to catch misplacements.

3. **Aggregation Phase** — Each community becomes a single super-node. Edges between super-nodes become weighted by the number of cross-community edges.

4. **Iteration** — Repeat until convergence (modularity stops improving).

### Auto-naming

Communities are automatically named based on:
- **Path prefix** — If most files share a directory (e.g., `src/auth/`), that becomes the name
- **Dominant exports** — Exported function names that appear frequently

### Quality Controls

- **Oversized communities** (>25% of codebase) are split into sub-communities
- **Tiny communities** (<3 files) are merged into the nearest neighbor
- **Deterministic results** via seeded PRNG

### Commands

```bash
delta communities                # List all communities
delta communities --show auth    # Files in the "auth" community
delta communities --verbose      # Cohesion and coupling scores
```

---

## Execution Flow Tracing

### What are execution flows?

An execution flow traces the path from an **entry point** (HTTP route, CLI command, event handler) through the dependency graph to its **leaf nodes**. Flows answer: "When a user hits POST /api/login, which files are involved?"

### Entry Point Detection

Delta detects entry points via pattern matching:

| Type | Pattern | Example |
|:-----|:--------|:--------|
| **HTTP_ROUTE** | `app.get()`, `router.post()`, `@Get()`, `@app.get()` | `app.post('/api/login', handler)` |
| **CLI_CMD** | `.command()`, `yargs.command()` | `program.command('init')` |
| **EVENT** | `.on()`, `.subscribe()`, `consumer.run` | `emitter.on('payment.completed')` |
| **EXPORT** | Functions exported from `index.ts` / `main.ts` | `export function createUser()` |
| **TEST** | `describe()`, `it()`, `test()` in test files | `describe('AuthService')` |

### BFS Tracing

From each entry point, Delta performs a **breadth-first search** through the dependency graph:

```
Entry: POST /api/login
  ↓  depth=0  src/api/routes/auth.ts         → full content
  ↓  depth=1  src/auth/login.ts              → symbols
  ↓  depth=1  src/middleware/auth-guard.ts    → symbols
  ↓  depth=2  src/utils/jwt.ts               → summary
  ↓  depth=2  src/persistence/user-store.ts  → summary
  ↓  depth=3  src/config/env.ts              → excluded
```

### Criticality Scoring

Each flow receives a **criticality score** (0–1):

```
criticality = 0.5 × (fileCount / 10) + 0.5 × (depth / 8)
```

High file count + high depth = high criticality = more important to monitor.

### Commands

```bash
delta flows                         # List all flows
delta flows --type HTTP_ROUTE       # Only HTTP routes
delta flows --show <id>             # Full call chain
delta flows --file src/utils/jwt.ts # Flows touching a file
```

---

## Risk Scoring

### 5 Dimensions

Every file is scored across 5 independent dimensions, each normalized to 0–1:

| Dimension | Weight | What it measures | How |
|:----------|:-------|:-----------------|:----|
| **Security** | 25% | Sensitive operations | Keywords in path/exports: `password`, `auth`, `token`, `eval`, `exec`, `env`, `readFile`, etc. |
| **Test Coverage** | 20% | Whether tests exist | Checks if any test file imports this module. No importer = 1.0 risk |
| **Cross-Community** | 20% | Blast surface area | Number of communities that depend on this file. 3+ communities = 1.0 |
| **Flow Participation** | 20% | Criticality | Number of execution flows × max flow criticality |
| **Surprise Coupling** | 15% | Unexpected connections | Cross-community edges with low edge count (suspicious coupling) |

### Risk Levels

```
overall = Σ (dimension × weight)

HIGH:    ≥ 0.7
MEDIUM:  ≥ 0.4
LOW:     < 0.4
```

### Commands

```bash
delta risk                       # Show HIGH risk files
delta risk --file src/utils/jwt.ts  # Per-dimension breakdown
delta risk --all                 # Include LOW risk files
```

---

## Hub & Bridge Detection

### Hubs (Betweenness Centrality)

A **hub** is a file that sits on many shortest paths between other files. If you change a hub, many parts of the codebase are affected.

Delta uses **Brandes betweenness centrality**:
- Time complexity: O(V·E)
- For graphs > 2000 nodes: samples 10% of sources for performance
- Results normalized to 0–1

Files with betweenness ≥ 0.7 are marked as **hubs**.

### Bridges (Tarjan's Algorithm)

A **bridge** is an edge (or the files on that edge) whose removal **disconnects** the graph. Bridges are architectural chokepoints — single points of failure.

Delta uses **Tarjan's bridge-finding algorithm**:
- Time complexity: O(V+E)
- Identifies which communities each bridge connects

### Commands

```bash
delta hubs              # Top hubs by betweenness
delta hubs --bridges    # Bridge files (chokepoints)
delta hubs --surprise   # Unexpected cross-community connections
delta hubs --all        # Full metrics table
```

---

## Blast Radius

Blast radius combines **all graph intelligence** to answer: "If I change this file, what breaks?"

### 6-Step Algorithm

1. **Reverse BFS** — Find all direct and transitive dependents
2. **Community Spread** — How many communities are affected?
3. **Flow Impact** — Which execution flows are disrupted?
4. **Test Coverage** — Which affected files have no tests?
5. **Surprise Connections** — Unexpected cross-community edges?
6. **Risk Score** — Weighted 4-dimension formula:

```
risk = 0.25 × dependentCount
     + 0.25 × communitySpread
     + 0.30 × flowCriticality
     + 0.20 × testCoverage
```

### Commands

```bash
delta blast src/utils/jwt.ts                  # Full blast radius
delta blast src/utils/jwt.ts --symbol verify  # Scoped to one function
delta blast src/utils/jwt.ts --depth 3        # Limit traversal depth
```

---

## Graph Snapshots

Snapshots freeze the entire graph state at a point in time. Diff them later to see architectural evolution.

### What's Saved

- All files and their hashes
- All graph edges
- Community assignments
- Risk scores per file
- Hub/bridge status per file

### Commands

```bash
delta snapshot save "sprint-42"      # Save current state
delta snapshot list                  # List all snapshots
delta snapshot diff "sprint-42"      # Diff current vs saved
delta snapshot delete "sprint-42"    # Remove a snapshot
```
