import path from 'path';
import type { Database } from '../../persistence/database.js';
import { MemoryStore, type MemoryItem } from '../../persistence/memory-store.js';

// ── Types ─────────────────────────────────────────────────────────────────────

export interface StalenessReport {
  /** Number of memories newly marked stale */
  stalledCount: number;
  /** Details of each newly stale memory */
  staleMemories: Array<{
    memoryId: string;
    title: string;
    linkedFile: string;
  }>;
}

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * Mark memories as STALE when their linked files have been modified.
 *
 * Called after file-change detection or file-watcher updates.
 * Queries `memory_file_links` for each changed file path and marks
 * all linked memories whose confidence is not already STALE.
 *
 * @param changedPaths - Relative paths (to project root) of files that changed
 * @param memoryStore  - MemoryStore instance to update
 * @returns StalenessReport with count and details
 */
export function markRelatedMemoriesStale(
  changedPaths: string[],
  memoryStore: MemoryStore
): StalenessReport {
  const report: StalenessReport = {
    stalledCount: 0,
    staleMemories: [],
  };

  // Track already-processed memory IDs to avoid double-marking
  const processed = new Set<string>();

  for (const filePath of changedPaths) {
    const linkedMemories = memoryStore.getByFilePath(filePath);

    for (const memory of linkedMemories) {
      // Skip if already stale or already processed in this batch
      if (memory.confidence === 'STALE' || processed.has(memory.id)) {
        continue;
      }

      processed.add(memory.id);
      memoryStore.markStale(memory.id);

      report.stalledCount++;
      report.staleMemories.push({
        memoryId: memory.id,
        title: memory.title,
        linkedFile: filePath,
      });
    }
  }

  return report;
}

/**
 * Check for memories that haven't been accessed in `maxAgeDays` days
 * and mark them as STALE.
 *
 * This is useful for periodic maintenance — memories that are never
 * accessed likely describe outdated patterns.
 *
 * @param memoryStore - MemoryStore instance
 * @param maxAgeDays  - Days since last access before marking stale (default: 30)
 * @returns StalenessReport with count and details
 */
export function checkAgeBasedStaleness(
  memoryStore: MemoryStore,
  maxAgeDays = 30
): StalenessReport {
  const report: StalenessReport = {
    stalledCount: 0,
    staleMemories: [],
  };

  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - maxAgeDays);
  const cutoffStr = cutoff.toISOString();

  // Get all non-stale memories and check their last_accessed date
  const allMemories = memoryStore.list();

  for (const memory of allMemories) {
    if (memory.confidence === 'STALE') continue;

    if (memory.lastAccessed < cutoffStr) {
      memoryStore.markStale(memory.id);

      report.stalledCount++;
      report.staleMemories.push({
        memoryId: memory.id,
        title: memory.title,
        linkedFile: memory.filePaths[0] ?? '(no linked files)',
      });
    }
  }

  return report;
}

/**
 * Get a summary of the current staleness state for display.
 */
export function formatStalenessWarning(report: StalenessReport): string {
  if (report.stalledCount === 0) return '';

  const lines: string[] = [];
  lines.push(
    `⚠ ${report.stalledCount} memor${report.stalledCount === 1 ? 'y' : 'ies'} marked stale (linked files changed):`
  );

  for (const entry of report.staleMemories.slice(0, 5)) {
    lines.push(`  ⚠ ${entry.title} ← ${entry.linkedFile}`);
  }

  if (report.staleMemories.length > 5) {
    lines.push(`  ... and ${report.staleMemories.length - 5} more`);
  }

  lines.push('  Run: delta memory confirm <id> to re-validate');

  return lines.join('\n');
}
