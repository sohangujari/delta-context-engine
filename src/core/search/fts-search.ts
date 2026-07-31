import type { Database } from '../../persistence/database.js';

// ── Types ─────────────────────────────────────────────────────────────────────

export type SearchScope =
  | 'all'
  | 'symbols'
  | 'files'
  | 'memory'
  | 'flows'
  | 'communities';

export interface FtsResult {
  type: 'symbol' | 'file' | 'memory' | 'flow' | 'community';
  score: number;         // normalised BM25 score (0.0–1.0, 1.0 = best)
  filePath?: string;
  relativePath?: string;
  symbolName?: string;
  symbolKind?: string;
  signature?: string;
  summary?: string;
  communityName?: string;
  memoryId?: string;
  memoryTitle?: string;
  memoryContent?: string;
  flowId?: string;
  flowName?: string;
  entrySymbol?: string;
  snippet?: string;
}

// ── FtsSearch ─────────────────────────────────────────────────────────────────

export class FtsSearch {
  constructor(private db: Database) {}

  /**
   * Search across all FTS5 tables, merge, and sort by score descending.
   */
  search(query: string, scope: SearchScope = 'all', limit = 20): FtsResult[] {
    if (!query.trim()) return [];

    if (scope !== 'all') {
      switch (scope) {
        case 'symbols': return this.searchSymbols(query, limit);
        case 'files': return this.searchFiles(query, limit);
        case 'memory': return this.searchMemory(query, limit);
        case 'flows': return this.searchFlows(query, limit);
        case 'communities': return this.searchCommunities(query, limit);
      }
    }

    return this.searchAll(query, limit);
  }

  searchSymbols(query: string, limit = 20): FtsResult[] {
    const sanitized = sanitizeFtsQuery(query);
    try {
      const rows = this.db.prepare(`
        SELECT file_path, symbol_name, symbol_kind, signature,
               bm25(fts_symbols) as score
        FROM fts_symbols
        WHERE fts_symbols MATCH ?
        ORDER BY score
        LIMIT ?
      `).all(sanitized, limit) as FtsSymbolRow[];

      return rows.map(row => ({
        type: 'symbol' as const,
        score: normalizeBm25(row.score as number),
        filePath: row.file_path as string,
        symbolName: row.symbol_name as string,
        symbolKind: row.symbol_kind as string,
        signature: row.signature as string,
      }));
    } catch {
      return [];
    }
  }

  searchFiles(query: string, limit = 20): FtsResult[] {
    const sanitized = sanitizeFtsQuery(query);
    try {
      const rows = this.db.prepare(`
        SELECT file_path, relative_path, summary, community_name,
               bm25(fts_files) as score
        FROM fts_files
        WHERE fts_files MATCH ?
        ORDER BY score
        LIMIT ?
      `).all(sanitized, limit) as FtsFileRow[];

      return rows.map(row => ({
        type: 'file' as const,
        score: normalizeBm25(row.score as number),
        filePath: row.file_path as string,
        relativePath: row.relative_path as string,
        summary: row.summary as string,
        communityName: row.community_name as string,
      }));
    } catch {
      return [];
    }
  }

  searchMemory(query: string, limit = 10): FtsResult[] {
    const sanitized = sanitizeFtsQuery(query);
    try {
      const rows = this.db.prepare(`
        SELECT memory_id, title, content, topic,
               bm25(fts_memory) as score
        FROM fts_memory
        WHERE fts_memory MATCH ?
        ORDER BY score
        LIMIT ?
      `).all(sanitized, limit) as FtsMemoryRow[];

      return rows.map(row => ({
        type: 'memory' as const,
        score: normalizeBm25(row.score as number),
        memoryId: row.memory_id as string,
        memoryTitle: row.title as string,
        memoryContent: row.content as string,
      }));
    } catch {
      return [];
    }
  }

  searchFlows(query: string, limit = 10): FtsResult[] {
    const sanitized = sanitizeFtsQuery(query);
    try {
      const rows = this.db.prepare(`
        SELECT flow_id, name, entry_symbol, entry_file,
               bm25(fts_flows) as score
        FROM fts_flows
        WHERE fts_flows MATCH ?
        ORDER BY score
        LIMIT ?
      `).all(sanitized, limit) as FtsFlowRow[];

      return rows.map(row => ({
        type: 'flow' as const,
        score: normalizeBm25(row.score as number),
        flowId: row.flow_id as string,
        flowName: row.name as string,
        entrySymbol: row.entry_symbol as string,
        filePath: row.entry_file as string,
      }));
    } catch {
      return [];
    }
  }

  searchCommunities(query: string, limit = 5): FtsResult[] {
    const sanitized = sanitizeFtsQuery(query);
    try {
      const rows = this.db.prepare(`
        SELECT community_id, name, description,
               bm25(fts_communities) as score
        FROM fts_communities
        WHERE fts_communities MATCH ?
        ORDER BY score
        LIMIT ?
      `).all(sanitized, limit) as FtsCommunityRow[];

      return rows.map(row => ({
        type: 'community' as const,
        score: normalizeBm25(row.score as number),
        communityName: row.name as string,
        summary: row.description as string,
      }));
    } catch {
      return [];
    }
  }

  searchAll(query: string, limit = 20): FtsResult[] {
    const allResults = [
      ...this.searchSymbols(query, limit),
      ...this.searchFiles(query, limit),
      ...this.searchMemory(query, Math.floor(limit / 2)),
      ...this.searchFlows(query, Math.floor(limit / 2)),
      ...this.searchCommunities(query, 5),
    ];
    return allResults
      .sort((a, b) => b.score - a.score)
      .slice(0, limit);
  }
}

// ── Utilities ─────────────────────────────────────────────────────────────────

/**
 * Normalise BM25 score to 0.0–1.0 (1.0 = best match).
 * FTS5 BM25 returns negative values — lower (more negative) is better.
 * Typical range: -0.1 (perfect match) to -20 (poor match).
 */
function normalizeBm25(score: number): number {
  const clamped = Math.max(-20, Math.min(0, score));
  return 1.0 - (Math.abs(clamped) / 20);
}

/**
 * Sanitize query for FTS5 MATCH syntax.
 * Removes special characters and wraps words in quotes.
 */
function sanitizeFtsQuery(query: string): string {
  const words = query.trim().split(/\s+/).filter(Boolean);
  if (words.length === 0) return '""';
  if (words.length === 1) {
    return `"${words[0]!.replace(/['"*^{}[\]()]/g, '')}"`;
  }
  return words
    .map(w => `"${w.replace(/['"*^{}[\]()]/g, '')}"`)
    .join(' OR ');
}

// ── Row types (internal) ──────────────────────────────────────────────────────

interface FtsSymbolRow {
  file_path: unknown; symbol_name: unknown; symbol_kind: unknown;
  signature: unknown; score: unknown;
}
interface FtsFileRow {
  file_path: unknown; relative_path: unknown; summary: unknown;
  community_name: unknown; score: unknown;
}
interface FtsMemoryRow {
  memory_id: unknown; title: unknown; content: unknown;
  topic: unknown; score: unknown;
}
interface FtsFlowRow {
  flow_id: unknown; name: unknown; entry_symbol: unknown;
  entry_file: unknown; score: unknown;
}
interface FtsCommunityRow {
  community_id: unknown; name: unknown; description: unknown;
  score: unknown;
}
