import { FtsSearch, type SearchScope, type FtsResult } from './fts-search.js';
import { VectorStore } from '../embeddings/vector-store.js';
import { embed } from '../embeddings/embedder.js';
import { checkProviderAvailable } from '../embeddings/embedder.js';
import { rankBySimilarity } from '../embeddings/similarity.js';
import type { Database } from '../../persistence/database.js';

// ── Types ─────────────────────────────────────────────────────────────────────

export interface HybridSearchOptions {
  query: string;
  projectRoot: string;
  limit?: number;          // default 20
  rrfK?: number;           // default 60
  scope?: SearchScope;     // default 'all'
  threshold?: number;      // minimum RRF score (default 0.005)
}

export interface HybridResult {
  type: 'symbol' | 'file' | 'memory' | 'flow' | 'community';
  rrfScore: number;         // combined RRF score
  ftsScore?: number;        // normalised BM25 score
  vectorScore?: number;     // cosine similarity score
  ftsRank?: number;         // rank in FTS5 results
  vectorRank?: number;      // rank in vector results
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

// ── HybridSearch ──────────────────────────────────────────────────────────────

export class HybridSearch {
  constructor(
    private ftsSearch: FtsSearch,
    private vectorStore: VectorStore,
    private db: Database
  ) {}

  /**
   * Combined FTS5 + vector search using Reciprocal Rank Fusion.
   * Falls back to FTS5-only if embedding provider unavailable.
   */
  async search(options: HybridSearchOptions): Promise<HybridResult[]> {
    const {
      query,
      limit = 20,
      rrfK = 60,
      scope = 'all',
      threshold = 0.005,
    } = options;

    // Step 1: FTS5 keyword search
    const ftsResults = this.ftsSearch.search(query, scope, limit * 2);

    // Step 2: Vector similarity search (files only)
    const vectorResults = await this.vectorSearch(query, limit * 2);

    // Step 3: If no vector results, convert FTS to HybridResult
    if (vectorResults.length === 0) {
      return ftsResults
        .map(r => ({ ...r, rrfScore: r.score, ftsScore: r.score, ftsRank: 0 }))
        .slice(0, limit);
    }

    // Step 4: RRF fusion
    const merged = this.fuseWithRRF(ftsResults, vectorResults, rrfK);

    // Step 5: Filter by threshold + limit
    return merged
      .filter(r => r.rrfScore >= threshold)
      .slice(0, limit);
  }

  /**
   * Embed the query and rank all stored vectors by cosine similarity.
   * Returns results as FtsResult[] for uniform RRF processing.
   */
  private async vectorSearch(query: string, limit: number): Promise<FtsResult[]> {
    try {
      const check = await checkProviderAvailable();
      if (!check.available) return [];

      const embeddingResult = await embed(query);
      if (!embeddingResult) return [];

      const allVectors = this.vectorStore.getAllVectors();
      if (allVectors.length === 0) return [];

      const ranked = rankBySimilarity(embeddingResult.vector, allVectors);

      return ranked.slice(0, limit).map(item => ({
        type: 'file' as const,
        score: item.score,
        filePath: item.filePath,
        relativePath: item.filePath, // will be overridden in merge
      }));
    } catch {
      return [];
    }
  }

  /**
   * Reciprocal Rank Fusion: combine two ranked lists using position-based scoring.
   *
   * For each result: RRF_score = Σ 1/(k + rank_in_list)
   * k = 60 (standard constant) — reduces the impact of top-ranked results.
   */
  private fuseWithRRF(
    ftsResults: FtsResult[],
    vectorResults: FtsResult[],
    k: number
  ): HybridResult[] {
    const scoreMap = new Map<string, HybridResult>();

    // Process FTS5 results
    ftsResults.forEach((result, rank) => {
      const key = this.resultKey(result);
      const rrfContribution = 1 / (k + rank + 1);
      const existing = scoreMap.get(key);
      if (existing) {
        existing.rrfScore += rrfContribution;
        existing.ftsScore = result.score;
        existing.ftsRank = rank + 1;
      } else {
        scoreMap.set(key, {
          ...result,
          rrfScore: rrfContribution,
          ftsScore: result.score,
          ftsRank: rank + 1,
        });
      }
    });

    // Process vector results
    vectorResults.forEach((result, rank) => {
      const key = this.resultKey(result);
      const rrfContribution = 1 / (k + rank + 1);
      const existing = scoreMap.get(key);
      if (existing) {
        existing.rrfScore += rrfContribution;
        existing.vectorScore = result.score;
        existing.vectorRank = rank + 1;
      } else {
        scoreMap.set(key, {
          ...result,
          rrfScore: rrfContribution,
          vectorScore: result.score,
          vectorRank: rank + 1,
        });
      }
    });

    // Sort by RRF score descending
    return [...scoreMap.values()].sort((a, b) => b.rrfScore - a.rrfScore);
  }

  /**
   * Unique key per result — used to detect duplicates across FTS + vector lists.
   */
  private resultKey(result: FtsResult): string {
    if (result.type === 'symbol') return `sym:${result.filePath}:${result.symbolName}`;
    if (result.type === 'file') return `file:${result.filePath}`;
    if (result.type === 'memory') return `mem:${result.memoryId}`;
    if (result.type === 'flow') return `flow:${result.flowId}`;
    return `com:${result.communityName}`;
  }
}
