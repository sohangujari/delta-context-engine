---
layout: default
title: Configuration
nav_order: 6
description: "Customize Delta's behavior, budgets, and providers"
permalink: /configuration
---

# Configuration
{: .fs-8 }

Delta works with zero config. Customize when you need more control.
{: .fs-5 .fw-300 }

---

## Config File

After `delta init`, configuration is stored at `.delta/config.json`:

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

---

## Token Budget

### Presets

| Preset | Tokens | Best for |
|:-------|-------:|:---------|
| `conservative` | 2,000 | Single file changes, quick fixes |
| `balanced` | 4,000 | Feature work, multi-file changes |
| `thorough` | 8,000 | Large refactors, architecture changes |

### Override per task

```bash
delta run "task" --budget 4000
delta run "task" --budget 8000
```

### Auto-Escalation

Delta automatically expands the budget based on the number of changed files:

| Changed Files | Budget |
|:-------------|:-------|
| < 5 files | Configured budget (no change) |
| 5–9 files | `balanced` (4,000 tokens) |
| ≥ 10 files | `thorough` (8,000 tokens) |

Disable with:

```json
{
  "budget": {
    "autoEscalate": false
  }
}
```

---

## Embedding Providers

### Ollama (Default — Local, Free, Private)

```json
{
  "embeddings": {
    "provider": "ollama",
    "model": "nomic-embed-text",
    "baseUrl": "http://localhost:11434",
    "dimensions": 768,
    "timeout": 30000
  }
}
```

Setup:

```bash
# Install from https://ollama.ai
ollama pull nomic-embed-text
ollama serve
```

{: .tip }
Ollama runs entirely on your machine. No data leaves your computer.

### OpenAI

```json
{
  "embeddings": {
    "provider": "openai",
    "model": "text-embedding-3-small",
    "dimensions": 1536
  }
}
```

Set your API key:

```bash
export OPENAI_API_KEY="sk-..."
```

### Azure OpenAI

```json
{
  "embeddings": {
    "provider": "azure",
    "model": "text-embedding-ada-002",
    "dimensions": 1536
  }
}
```

Set your credentials:

```bash
export AZURE_OPENAI_API_KEY="your-key"
export AZURE_OPENAI_ENDPOINT="https://your-resource.openai.azure.com"
```

### LM Studio

```json
{
  "embeddings": {
    "provider": "ollama",
    "model": "nomic-embed-text",
    "baseUrl": "http://localhost:1234"
  }
}
```

{: .note }
LM Studio uses the same OpenAI-compatible API as Ollama. Just change the `baseUrl`.

### Check status

```bash
delta providers
```

---

## Graph Settings

```json
{
  "graph": {
    "maxDepth": 2,
    "includeTestFiles": true,
    "resolveNodeModules": false
  }
}
```

| Setting | Default | Description |
|:--------|:--------|:------------|
| `maxDepth` | `2` | How deep to trace the dependency graph from changed files |
| `includeTestFiles` | `true` | Whether to include test files in the graph |
| `resolveNodeModules` | `false` | Whether to resolve imports from `node_modules` |

---

## Relevance Scoring

```json
{
  "relevance": {
    "semanticThreshold": 0.45,
    "embeddingModel": "nomic-embed-text",
    "combineWithGraph": true
  }
}
```

| Setting | Default | Description |
|:--------|:--------|:------------|
| `semanticThreshold` | `0.45` | Minimum cosine similarity score to include a file |
| `embeddingModel` | `nomic-embed-text` | Embedding model for semantic scoring |
| `combineWithGraph` | `true` | Combine semantic + graph scores (recommended) |

---

## .deltaignore

Works like `.gitignore`. Place at your project root. Delta also inherits your `.gitignore` automatically.

```
# .deltaignore
node_modules/**
dist/**
build/**
*.generated.ts
*.min.js
coverage/**
.next/**
__pycache__/**
*.pyc
vendor/**
```

{: .note }
You don't need to add `node_modules` or `dist` — Delta ignores them by default. Use `.deltaignore` for project-specific exclusions.

---

## Language Support

### Tier 1 — Full AST Parsing (tree-sitter)

| Language | Extensions | Symbol Extraction |
|:---------|:-----------|:------------------|
| TypeScript | `.ts`, `.tsx` | Functions, classes, interfaces, types, imports, exports |
| JavaScript | `.js`, `.jsx`, `.mjs` | Functions, classes, imports, exports |
| Python | `.py` | Functions, classes, imports, decorators |
| Go | `.go` | Functions, types, interfaces, imports |
| Rust | `.rs` | Functions, structs, traits, impls, mods |
| Java | `.java` | Classes, methods, interfaces, imports |

### Tier 2 — Pattern Extraction (regex)

C, C++, C#, Ruby, PHP, Swift, Kotlin, Scala, Dart, R, Lua, Perl, Haskell, Elixir, Clojure, and more.

Extracts function signatures, class definitions, and imports via regex patterns.

### Tier 3 — Notebook Support

| Format | Extensions |
|:-------|:-----------|
| Jupyter Notebook | `.ipynb` |
| Databricks | `.dbc` |

Extracts code cells, markdown cells, and metadata.

### Tier 4 — Minimal Indexing

Shell scripts (`.sh`, `.bash`, `.zsh`), config files (`.yml`, `.json`, `.toml`, `.xml`), markup (`.md`, `.html`), styles (`.css`, `.scss`, `.less`), and 20+ additional formats.

Indexed for change detection, dependency tracking, and token counting. No symbol extraction.

**56+ file extensions supported across all tiers.**

---

## Performance Tuning

| Setting | Impact |
|:--------|:-------|
| Lower `maxDepth` | Faster indexing, less context |
| Higher `semanticThreshold` | Fewer files included, more precise |
| `resolveNodeModules: false` | Much faster indexing (default) |
| `includeTestFiles: false` | Reduces index size for large test suites |
| `autoEscalate: false` | Consistent budget, predictable costs |

---

## Monorepo Support

Delta auto-detects monorepo setups:

| Tool | Detection |
|:-----|:----------|
| Nx | `nx.json` |
| Turborepo | `turbo.json` |
| pnpm workspaces | `pnpm-workspace.yaml` |
| npm/yarn workspaces | `package.json` `workspaces` field |

Cross-package imports are resolved automatically:

```typescript
import { Button } from '@myapp/ui'
// → resolves to packages/ui/src/index.ts
```
