import {
  MemoryStore,
  type MemoryItem,
} from '../../persistence/memory-store.js';
import { countTokens } from '../assembler/token-counter.js';

// ── Types ─────────────────────────────────────────────────────────────────────

export interface InjectionResult {
  /** Formatted memory block to prepend to context */
  memoryBlock: string;
  /** Token count of the memory block */
  tokenCount: number;
  /** Memories that were used in the injection */
  memoriesUsed: MemoryItem[];
}

// ── Constants ─────────────────────────────────────────────────────────────────

const MAX_MEMORIES = 3;

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * Query the memory store for relevant memories and build an injection block.
 *
 * Strategy:
 *   1. Query by file path for each changed file
 *   2. Query by task text (LIKE search)
 *   3. Deduplicate
 *   4. Filter out STALE memories
 *   5. Sort by confidence (HIGH first) then by lastAccessed DESC
 *   6. Take top N memories
 *   7. Format as a [MEMORY] block
 *
 * If the block exceeds the budget, truncate to top 1 memory.
 */
export function injectMemories(
  task: string,
  changedFiles: string[],
  memoryStore: MemoryStore,
  tokenBudget: number,
  maxMemories: number = MAX_MEMORIES
): InjectionResult {
  // Collect candidate memories
  const seen = new Set<string>();
  const candidates: MemoryItem[] = [];

  // 1. Query by file path
  for (const filePath of changedFiles) {
    const fileMemories = memoryStore.getByFilePath(filePath);
    for (const m of fileMemories) {
      if (!seen.has(m.id)) {
        seen.add(m.id);
        candidates.push(m);
      }
    }
  }

  // 2. Query by task text — extract meaningful keywords
  const keywords = extractKeywords(task);
  if (keywords.length > 0) {
    for (const keyword of keywords.slice(0, 3)) {
      const textMatches = memoryStore.search(keyword);
      for (const m of textMatches) {
        if (!seen.has(m.id)) {
          seen.add(m.id);
          candidates.push(m);
        }
      }
    }
  }

  // 3. Filter out STALE (but track them for warning display)
  const activeMemories = candidates.filter((m) => m.confidence !== 'STALE');

  if (activeMemories.length === 0) {
    return { memoryBlock: '', tokenCount: 0, memoriesUsed: [] };
  }

  // 4. Sort: HIGH → MEDIUM → LOW, then by lastAccessed DESC
  const confidenceOrder = { HIGH: 0, MEDIUM: 1, LOW: 2, STALE: 3 };
  activeMemories.sort((a, b) => {
    const confDiff = confidenceOrder[a.confidence] - confidenceOrder[b.confidence];
    if (confDiff !== 0) return confDiff;
    return b.lastAccessed.localeCompare(a.lastAccessed);
  });

  // 5. Take top N
  const selected = activeMemories.slice(0, maxMemories);

  // 6. Format block
  let memoryBlock = formatMemoryBlock(selected);
  let tokenCount = countTokens(memoryBlock);

  // 7. If too large, truncate to top 1
  if (tokenCount > tokenBudget && selected.length > 1) {
    const truncated = selected.slice(0, 1);
    memoryBlock = formatMemoryBlock(truncated);
    tokenCount = countTokens(memoryBlock);
    return { memoryBlock, tokenCount, memoriesUsed: truncated };
  }

  // If still too large even with 1, return empty
  if (tokenCount > tokenBudget) {
    return { memoryBlock: '', tokenCount: 0, memoriesUsed: [] };
  }

  return { memoryBlock, tokenCount, memoriesUsed: selected };
}

/**
 * Get stale memories for display warnings (not for injection).
 */
export function getStaleMemoriesForFiles(
  changedFiles: string[],
  memoryStore: MemoryStore
): MemoryItem[] {
  const seen = new Set<string>();
  const staleMemories: MemoryItem[] = [];

  for (const filePath of changedFiles) {
    const fileMemories = memoryStore.getByFilePath(filePath);
    for (const m of fileMemories) {
      if (m.confidence === 'STALE' && !seen.has(m.id)) {
        seen.add(m.id);
        staleMemories.push(m);
      }
    }
  }

  return staleMemories;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

/**
 * Format selected memories into a [MEMORY] block for context injection.
 */
function formatMemoryBlock(memories: MemoryItem[]): string {
  if (memories.length === 0) return '';

  const lines: string[] = [];
  lines.push('[MEMORY]');
  lines.push('─'.repeat(45));

  for (let i = 0; i < memories.length; i++) {
    const m = memories[i];
    if (!m) continue;

    lines.push(`${m.title} (${m.confidence} confidence)`);

    // Include the content, truncated to keep it concise
    const contentLines = m.content.split('\n').filter((l) => {
      // Skip markdown headings and metadata sections
      return !l.startsWith('## ') && !l.startsWith('## Captured At') && l.trim() !== '';
    });

    // Take first ~5 meaningful lines of content
    const meaningful = contentLines.slice(0, 5);
    for (const line of meaningful) {
      lines.push(line);
    }

    if (i < memories.length - 1) {
      lines.push('─'.repeat(45));
    }
  }

  lines.push('─'.repeat(45));

  return lines.join('\n');
}

/**
 * Extract meaningful search keywords from a task string.
 * Filters out common stop words and short words.
 */
function extractKeywords(task: string): string[] {
  const stopWords = new Set([
    'the', 'a', 'an', 'in', 'on', 'at', 'to', 'for', 'of', 'with',
    'and', 'or', 'but', 'is', 'are', 'was', 'were', 'be', 'been',
    'has', 'have', 'had', 'do', 'does', 'did', 'will', 'would',
    'could', 'should', 'may', 'might', 'can', 'this', 'that',
    'it', 'its', 'not', 'no', 'so', 'if', 'then', 'than',
    'how', 'what', 'when', 'where', 'who', 'which', 'why',
    'fix', 'add', 'update', 'change', 'modify', 'make', 'create',
  ]);

  return task
    .toLowerCase()
    .replace(/[^a-z0-9\s-_]/g, ' ')
    .split(/\s+/)
    .filter((w) => w.length > 2 && !stopWords.has(w));
}
