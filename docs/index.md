---
layout: default
title: Home
nav_order: 1
description: "∆ Delta Context Engine — Only send what changed."
permalink: /
---

# ∆ Delta Context Engine
{: .fs-9 }

Only send what changed. **85% fewer tokens. 6× more tasks on the same weekly budget.**
{: .fs-6 .fw-300 }

[![npm version](https://img.shields.io/npm/v/delta-ctx.svg)](https://www.npmjs.com/package/delta-ctx)
[![npm downloads](https://img.shields.io/npm/dm/delta-ctx.svg)](https://www.npmjs.com/package/delta-ctx)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](https://github.com/sohangujari/delta-context-engine/blob/main/LICENSE)

[Get Started](/delta-context-engine/getting-started){: .btn .btn-primary .fs-5 .mb-4 .mb-md-0 .mr-2 }
[View on npm](https://www.npmjs.com/package/delta-ctx){: .btn .fs-5 .mb-4 .mb-md-0 }

---

## What is Delta?

Delta is an open-source **context intelligence engine** that sits between your editor and Claude. Instead of re-reading your entire codebase on every task, Delta indexes it once, watches for changes, and surgically assembles the minimum possible context payload.

Every AI coding task today sends your **entire codebase** to the LLM — even when only one file changed. Delta fixes this.

```
WITHOUT DELTA:                        WITH DELTA ∆:
─────────────────────────────         ─────────────────────────────
auth.ts        1,800 tokens ←unused   Task instruction   200 tok
user.model.ts  1,200 tokens ←unused   login.ts           800 tok  ← changed
api/routes.ts  3,100 tokens ←unused   Direct deps        600 tok  ← symbols
utils/...      2,400 tokens ←unused   Compressed summary 328 tok
config/db.ts     800 tokens ←unused   ─────────────────────────────
types/...      1,905 tokens ←unused   TOTAL:           1,928 tokens ✅
login.ts         800 tokens ←changed
─────────────────────────────
TOTAL:        12,005 tokens ❌        6.2× fewer tokens
```

---

## Key Features

| Feature | Description |
|:--------|:------------|
| **Context Intelligence** | 4-layer pipeline: change detection → AST extraction → dependency graph → context assembly |
| **Graph Intelligence** | Leiden community detection, execution flow tracing, blast radius, risk scoring, hub/bridge detection |
| **Hybrid Search** | FTS5 full-text + semantic vector search with Reciprocal Rank Fusion across symbols, files, memory, flows, and communities |
| **Memory System** | Persistent memory across sessions — architectural decisions, bug fixes, and edge cases auto-captured |
| **56+ Languages** | Full AST parsing (6 languages), pattern extraction (15+), notebook support, and minimal indexing for 30+ more |
| **14 MCP Tools + 5 Prompts** | blast_radius, codebase_compass, fault_tracer, first_day, merge_guardian |
| **Multi-Provider Embeddings** | Ollama (local), OpenAI, Azure OpenAI — with automatic fallback |
| **Universal Tool Support** | Claude Code (MCP stdio), HTTP MCP server, OpenAI-compatible proxy, Cursor, VS Code |
| **Zero Config** | Works out of the box. Customize when you need to. |

---

## Token Reduction

| Scenario | Before | After | Saved | Multiple |
|:---------|-------:|------:|------:|---------:|
| Single bug fix | 13,205 | 1,928 | 11,277 | **6.8×** |
| Add new feature | 18,400 | 2,800 | 15,600 | **6.5×** |
| Write unit tests | 11,200 | 1,600 | 9,600 | **7.0×** |
| Refactor a module | 22,000 | 4,100 | 17,900 | **5.3×** |
| Config file update | 8,400 | 900 | 7,500 | **9.3×** |
| **Average** | **16,213** | **2,466** | **13,747** | **6.6×** |

---

## Quick Start

```bash
npm install -g delta-ctx
delta init
delta run "fix the JWT expiry bug in login"
```

[Full Installation Guide →](/delta-context-engine/getting-started){: .btn .btn-outline }
