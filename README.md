# ∆ Delta Context Engine

Delta is a context intelligence engine that sits between your editor and Claude.
It indexes your codebase once, watches for changes continuously, and on every task surgically assembles the minimum possible context payload - sending only the changed file, its direct dependencies at symbol-level, and a compressed structural summary of everything else.

---

## The Problem

Every time you run a task in Claude Code, it re-reads your entire codebase:

```
EVERY TASK TODAY (without Delta):
──────────────────────────────────────────────────────
CLAUDE.md            2,000 tokens  ← re-injected always
auth.ts              1,800 tokens  ← unchanged
user.model.ts        1,200 tokens  ← unchanged
api/routes.ts        3,100 tokens  ← unchanged
utils/helpers.ts     2,400 tokens  ← unchanged
config/db.ts           800 tokens  ← unchanged
types/index.ts       1,905 tokens  ← unchanged
                    ────────────
TOTAL:              13,205 tokens  ← for ONE bug fix
```

**98.5% of those tokens carry zero new information.**

---

## The Solution

Delta indexes your codebase once, detects what changed, and sends only the delta:

```
SAME TASK (with Delta ∆):
──────────────────────────────────────────────────────
Task instruction       200 tokens  ← the actual ask
Changed file only      800 tokens  ← login.ts only
Direct deps symbols    600 tokens  ← signatures only
Compressed summary     328 tokens  ← rest of app
                      ──────────
TOTAL:               1,928 tokens  ← 6.8× fewer ✅
```