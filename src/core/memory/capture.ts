import path from 'path';
import {
  MemoryStore,
  type MemoryItem,
  type MemoryType,
} from '../../persistence/memory-store.js';
import type { ContextPayload } from '../assembler/context-builder.js';

// ── Heuristic keyword → memory type mapping ──────────────────────────────────

const TYPE_PATTERNS: Array<{ pattern: RegExp; type: MemoryType }> = [
  { pattern: /\b(explain|how\s+does|what\s+is|architecture|design|structure)\b/i, type: 'ARCHITECTURAL' },
  { pattern: /\b(fix|bug|error|crash|broken|issue|regression)\b/i,               type: 'BUG' },
  { pattern: /\b(flow|trace|path|pipeline|sequence|chain|lifecycle)\b/i,          type: 'FLOW' },
  { pattern: /\b(why|decided|chose|decision|trade-?off|chose|picked)\b/i,         type: 'DECISION' },
  { pattern: /\b(edge\s*case|careful|idempotent|race|concurren|corner)\b/i,       type: 'EDGE_CASE' },
];

/**
 * Infer a MemoryType from the task string using keyword heuristics.
 * Falls back to 'FLOW' if no pattern matches.
 */
function inferType(task: string): MemoryType {
  for (const { pattern, type } of TYPE_PATTERNS) {
    if (pattern.test(task)) {
      return type;
    }
  }
  return 'FLOW';
}

/**
 * Derive a topic from the changed file paths.
 * Uses the first meaningful directory segment(s) from the most common path prefix.
 *
 * e.g. "src/auth/login.ts" → "auth"
 *      "src/payments/stripe/webhook.ts" → "payments/stripe"
 */
function deriveTopic(task: string, changedFiles: string[], projectRoot: string): string {
  if (changedFiles.length === 0) return 'general';

  // Extract relative directory segments for each file
  const dirSegments = changedFiles.map((f) => {
    const rel = path.relative(projectRoot, f);
    const parts = rel.split(path.sep);
    // Remove the filename and common prefixes like 'src'
    const dirs = parts.slice(0, -1).filter(
      (d) => !['src', 'lib', 'app', 'packages', 'internal', 'cmd'].includes(d)
    );
    return dirs;
  });

  // Find the most common first directory
  const firstDirs = new Map<string, number>();
  for (const segs of dirSegments) {
    if (segs.length > 0 && segs[0]) {
      firstDirs.set(segs[0], (firstDirs.get(segs[0]) ?? 0) + 1);
    }
  }

  if (firstDirs.size === 0) return 'general';

  // Use the most common prefix
  const sorted = [...firstDirs.entries()].sort((a, b) => b[1] - a[1]);
  const topDir = sorted[0]?.[0] ?? 'general';

  // Try to add a second level for more specificity
  const secondDirs = new Map<string, number>();
  for (const segs of dirSegments) {
    if (segs.length > 1 && segs[0] === topDir && segs[1]) {
      secondDirs.set(segs[1], (secondDirs.get(segs[1]) ?? 0) + 1);
    }
  }

  if (secondDirs.size === 1) {
    const secondDir = [...secondDirs.keys()][0];
    if (secondDir) return `${topDir}/${secondDir}`;
  }

  return topDir;
}

/**
 * Build a clean title from the task string.
 * Truncates to 80 chars and cleans up.
 */
function deriveTitle(task: string): string {
  // Remove leading "fix ", "explain ", etc. for cleaner title
  const cleaned = task
    .replace(/^["']|["']$/g, '')     // strip surrounding quotes
    .replace(/\s+/g, ' ')            // normalize whitespace
    .trim();

  if (cleaned.length <= 80) return cleaned;
  return cleaned.slice(0, 77) + '...';
}

/**
 * Build structured Markdown content for the memory item.
 */
function buildContent(
  task: string,
  changedFiles: string[],
  projectRoot: string,
  payload: ContextPayload
): string {
  const lines: string[] = [];

  lines.push('## Task');
  lines.push(task);
  lines.push('');

  lines.push('## Changed Files');
  for (const f of changedFiles) {
    const rel = path.relative(projectRoot, f);
    // Find compression level in manifest
    const manifestEntry = payload.manifest.included.find(
      (m) => m.relativePath === rel
    );
    const level = manifestEntry?.compressionLevel ?? 'unknown';
    lines.push(`- ${rel} (${level} content sent)`);
  }
  lines.push('');

  // Summarize touched dependencies from the manifest
  const touchedFiles = payload.manifest.included.filter(
    (m) => m.reason.startsWith('TOUCHED')
  );
  if (touchedFiles.length > 0) {
    lines.push('## Context Summary');
    const changedNames = changedFiles.map((f) => path.basename(f));
    const touchedNames = touchedFiles.map((f) => path.basename(f.relativePath));
    lines.push(
      `Modified ${changedNames.join(', ')} which depends on ${touchedNames.join(', ')} (depth=1).`
    );
    lines.push('');
  }

  lines.push('## Captured At');
  lines.push(new Date().toISOString());

  return lines.join('\n');
}

// ── Public API ────────────────────────────────────────────────────────────────

export interface CaptureResult {
  memory: MemoryItem;
  topic: string;
}

/**
 * Capture a structured memory from a delta run.
 *
 * Called after context assembly. Analyzes the task + changed files + payload
 * to create a persistent memory item.
 *
 * Returns null if capture is not useful (< 3 tokens context, no changed files).
 */
export function captureMemory(
  task: string,
  changedFiles: string[],
  payload: ContextPayload,
  projectRoot: string,
  memoryStore: MemoryStore
): CaptureResult | null {
  // Guard: skip capture for trivial context
  if (changedFiles.length === 0 || payload.totalTokens < 3) {
    return null;
  }

  const type = inferType(task);
  const topic = deriveTopic(task, changedFiles, projectRoot);
  const title = deriveTitle(task);
  const content = buildContent(task, changedFiles, projectRoot, payload);

  // Derive tags from changed file paths and task keywords
  const tags = new Set<string>();

  // Add directory names as tags
  for (const f of changedFiles) {
    const rel = path.relative(projectRoot, f);
    const parts = rel.split(path.sep);
    for (const part of parts.slice(0, -1)) {
      if (!['src', 'lib', 'app', 'packages', 'internal', 'cmd'].includes(part)) {
        tags.add(part.toLowerCase());
      }
    }
    // Add filename without extension as tag
    const basename = path.basename(f, path.extname(f)).toLowerCase();
    if (basename.length > 2) {
      tags.add(basename);
    }
  }

  // Relative file paths for linking
  const relativeFilePaths = changedFiles.map((f) => path.relative(projectRoot, f));

  const now = new Date().toISOString();

  const item: MemoryItem = {
    id: MemoryStore.generateId(),
    topic,
    type,
    title,
    content,
    confidence: 'MEDIUM',
    source: 'auto',
    createdAt: now,
    updatedAt: now,
    lastAccessed: now,
    filePaths: relativeFilePaths,
    tags: [...tags],
  };

  // Check if a memory with the same topic already exists —
  // if so, promote its confidence toward HIGH
  const existing = memoryStore.getByTopic(topic);
  const previousSessions = existing.filter(
    (m) => m.source === 'auto' && m.type === type
  );

  if (previousSessions.length >= 1) {
    // This topic has been captured before → promote to HIGH
    item.confidence = 'HIGH';
  }

  memoryStore.save(item);

  return { memory: item, topic };
}
