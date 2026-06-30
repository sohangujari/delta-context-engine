---
layout: default
title: Getting Started
nav_order: 2
description: "Install and set up Delta Context Engine"
permalink: /getting-started
---

# Getting Started
{: .fs-8 }

Install Delta and index your first project in under 2 minutes.
{: .fs-5 .fw-300 }

---

## Requirements

| Requirement | Version | Notes |
|:------------|:--------|:------|
| **Node.js** | 20+ (LTS recommended) | Required |
| **Git** | Any recent version | For change detection. Optional — falls back to SHA-256 hashing |
| **Ollama** | Latest | Optional — enables semantic scoring with local embeddings |

---

## Installation Options

### Option 1: Global Install (Recommended)

Install Delta globally so the `delta` command is available everywhere:

```bash
npm install -g delta-ctx
```

Verify the installation:

```bash
delta --version
delta --help
```

{: .note }
This is the recommended approach for daily use. The `delta` command will be available in all your projects.

### Option 2: Use Without Installing (`npx`)

Run Delta directly without installing it globally:

```bash
npx delta-ctx init
npx delta-ctx run "your task"
```

{: .tip }
Great for trying Delta out before committing to a global install.

### Option 3: Project-Local Install

Add Delta as a dev dependency to a specific project:

```bash
npm install --save-dev delta-ctx
```

Then use it via `npx` or add scripts to your `package.json`:

```json
{
  "scripts": {
    "delta:init": "delta init",
    "delta:run": "delta run",
    "delta:watch": "delta watch"
  }
}
```

### Option 4: Install from Source

Clone and build from source:

```bash
git clone https://github.com/sohangujari/delta-context-engine
cd delta-context-engine
npm install
npx tsc
npm link
```

{: .note }
After `npm link`, the `delta` command will point to your local build. Useful for development and contributing.

---

## First Run

### Step 1: Initialize Your Project

Navigate to your project root and run:

```bash
cd your-project
delta init
```

This runs the full 10-step pipeline:

```
∆ Delta Context Engine — Initializing
──────────────────────────────────────────────

✔ Config saved to .delta/config.json
✔ 847 files found (56+ extensions)
✔ 847 files indexed (SHA-256 hashing)
✔ Symbols extracted · 12,847 functions · 3,201 exports · 6,421 imports
✔ Dependency graph built · 847 nodes · 2,341 edges
✔ 6 communities detected · modularity: 0.71
✔ 23 execution flows traced · 8 routes · 6 commands
✔ Risk scores calculated · 4 HIGH risk files
✔ 12 hubs · 3 bridges detected
✔ 847 embeddings generated (nomic-embed-text)

──────────────────────────────────────────────
✓ Delta initialized · 847 files · .delta/delta.db (4.2 MB)
```

### Step 2: Run Your First Task

```bash
delta run "fix the JWT expiry bug in login"
```

Delta will:
1. Detect which files changed since the last task
2. Trace the dependency graph from changed files
3. Score every file for relevance (semantic + graph)
4. Assemble a compressed context payload within the token budget
5. Output the context to stdout (or clipboard/file)

### Step 3: Pipe Context Anywhere

```bash
# Copy to clipboard (macOS)
delta run "your task" | pbcopy

# Save to file
delta run "your task" > context.md

# Use with any AI tool that accepts pasted context
```

---

## Enable Semantic Scoring (Optional)

Delta works without embeddings (graph-only mode), but semantic scoring significantly improves relevance.

### Using Ollama (Free, Local, Private)

```bash
# Install Ollama from https://ollama.ai
ollama pull nomic-embed-text
ollama serve
```

Delta auto-detects Ollama and enables semantic scoring. No API keys needed.

### Using OpenAI

Set your API key as an environment variable:

```bash
export OPENAI_API_KEY="sk-..."
```

Delta will use `text-embedding-3-small` by default.

### Using Azure OpenAI

```bash
export AZURE_OPENAI_API_KEY="your-key"
export AZURE_OPENAI_ENDPOINT="https://your-resource.openai.azure.com"
```

### Check Provider Status

```bash
delta providers
```

```
∆ Delta — Embedding Providers
──────────────────────────────────────────────
✔ ollama       running · nomic-embed-text · 768 dimensions
✗ openai       no API key set
✗ azure        no API key set
──────────────────────────────────────────────
Active: ollama
```

---

## What Gets Indexed?

After `delta init`, a `.delta/` directory is created containing:

| File | Purpose |
|:-----|:--------|
| `.delta/config.json` | Your project configuration |
| `.delta/delta.db` | SQLite database with all indexes |
| `.delta/reports/` | Session reports (when generated) |

{: .warning }
Add `.delta/` to your `.gitignore` to avoid committing the database:
```bash
echo ".delta/" >> .gitignore
```

---

## Next Steps

- [Commands Reference](/delta-context-engine/commands) — Full list of all commands and options
- [Graph Intelligence](/delta-context-engine/graph-intelligence) — Communities, flows, risk, hubs, and blast radius
- [Memory System](/delta-context-engine/memory) — How Delta remembers context across sessions
- [Integrations](/delta-context-engine/integrations) — Claude Code, Cursor, VS Code
- [Configuration](/delta-context-engine/configuration) — Customize budgets, providers, and behavior
