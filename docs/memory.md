---
layout: default
title: Memory System
nav_order: 5
description: "How Delta remembers context across sessions"
permalink: /memory
---

# Memory System
{: .fs-8 }

Delta remembers. Architectural decisions, bug fixes, and edge cases persist across sessions.
{: .fs-5 .fw-300 }

---

## Overview

The Memory System is Delta's **persistent knowledge store**. When you fix a tricky bug or make an architectural decision, Delta captures that context and automatically injects it into future tasks where it's relevant.

```
Session 1:  "JWT tokens expire after 15 minutes, not 1 hour.
             We use refresh tokens stored in httpOnly cookies."
                    ↓ captured
                    ↓ stored in .delta/delta.db
                    ↓
Session 47: delta run "add token refresh logic"
                    ↓ matched by semantic similarity
                    ↓ injected as SLOT 0 in context
                    ↓
            Claude gets:  "JWT tokens expire after 15 minutes..."
            Result:       Correct implementation on first try
```

---

## How Memories Work

### Capture

Memories are captured from:
- **`delta run` sessions** — Important context is auto-detected
- **Manual entry** — `delta memory add` for critical decisions

### Storage

Memories are stored in the SQLite database (`.delta/delta.db`) with:
- Full text content
- Source file references
- Memory type (architectural decision, bug fix, edge case, etc.)
- Embedding vector (for semantic search)
- Staleness tracking (linked to file hashes)

### Injection

During `delta run`, relevant memories are:
1. Retrieved via semantic similarity to the task description
2. Filtered for staleness (memories referencing changed files are flagged)
3. Injected as **SLOT 0** in the context assembly (highest priority)

### Staleness

When a file referenced by a memory changes, the memory is marked **stale**. Stale memories are:
- Still retrievable but flagged with a warning
- Not automatically injected until confirmed
- Re-validated with `delta memory confirm <id>`

---

## Commands

### List Memories

```bash
delta memory list
```

Shows all memories with their type, source, and staleness status.

### Show Memory Details

```bash
delta memory show <id>
```

Full content, source files, creation date, and staleness status.

### Add a Memory

```bash
delta memory add
```

Interactive prompt to add a manual memory. Use this for:
- Architectural decisions that should persist
- Known edge cases
- Environment-specific quirks
- Team conventions

### Search Memories

```bash
delta memory search "authentication flow"
```

Full-text search across all memories. Returns ranked results.

### Forget a Memory

```bash
delta memory forget <id>
```

Permanently delete a specific memory.

### Confirm Stale Memory

```bash
delta memory confirm <id>
```

Re-validate a stale memory after verifying it's still accurate.

### Export & Import

```bash
# Backup or share memories
delta memory export > memories.json

# Restore or import
delta memory import memories.json
```

### Memory Statistics

```bash
delta memory stats
```

Shows total memories, active vs stale, storage size, and most-referenced files.

---

## Best Practices

{: .tip }
**Add memories for non-obvious decisions.** If you spent time figuring out why something works a certain way, that's a perfect memory candidate.

{: .tip }
**Review stale memories after major refactors.** Run `delta memory list` and confirm or forget memories that reference changed code.

{: .tip }
**Export before major branch changes.** Memories are stored per-project. Export them before switching to a significantly different branch.
