import type { ScoredFile } from '../embeddings/similarity.js';
import type { TraversalResult } from '../graph/traverser.js';

export interface RelevanceScore {
  filePath: string;
  relativePath: string;
  semanticScore: number;   // 0.0–1.0 from embeddings
  graphScore: number;      // 0.0–1.0 from depth
  finalScore: number;      // weighted combination
  depth: number;           // 0=changed, 1=touched, 2=ancestor, 999=unrelated
  included: boolean;       // passes threshold
  reason: string;          // human-readable explanation
}

export interface ScorerOptions {
  semanticThreshold: number;    // default 0.65
  semanticWeight: number;       // default 0.4
  graphWeight: number;          // default 0.6
  maxDepth: number;             // default 2
}

const DEFAULT_OPTIONS: ScorerOptions = {
  semanticThreshold: 0.65,
  semanticWeight: 0.4,
  graphWeight: 0.6,
  maxDepth: 2,
};

/**
 * Graph depth → score mapping.
 * Depth always wins over semantics for exclusion:
 * a file at depth=3+ is excluded regardless of semantic score.
 */
function graphDepthToScore(depth: number): number {
  switch (depth) {
    case 0:   return 1.0;   // CHANGED — always include
    case 1:   return 0.8;   // TOUCHED — strong signal
    case 2:   return 0.5;   // ANCESTOR — moderate signal
    default:  return 0.0;   // UNRELATED — exclude
  }
}

/**
 * Combine semantic similarity score with graph depth score.
 *
 * Rules:
 * - depth=0 (changed)  → always included, score=1.0
 * - depth=3+           → always excluded, score=0.0
 * - depth=1,2          → weighted combination of semantic + graph
 * - semantic alone cannot include a depth=3+ file
 * - graph alone cannot exclude a depth=0 file
 */
export function scoreFile(
  filePath: string,
  relativePath: string,
  depth: number,
  semanticScore: number,
  options: Partial<ScorerOptions> = {}
): RelevanceScore {
  const opts = { ...DEFAULT_OPTIONS, ...options };

  // Changed files always included — no scoring needed
  if (depth === 0) {
    return {
      filePath,
      relativePath,
      semanticScore,
      graphScore: 1.0,
      finalScore: 1.0,
      depth,
      included: true,
      reason: 'CHANGED (depth=0) — always included',
    };
  }

  // Depth beyond maxDepth — always excluded regardless of semantic score
  if (depth > opts.maxDepth) {
    return {
      filePath,
      relativePath,
      semanticScore,
      graphScore: 0.0,
      finalScore: 0.0,
      depth,
      included: false,
      reason: `depth=${depth} exceeds maxDepth=${opts.maxDepth}`,
    };
  }

  // Depth 1 or 2 — weighted combination
  const graphScore = graphDepthToScore(depthLabel(depth));
  const finalScore =
    semanticScore * opts.semanticWeight + graphScore * opts.graphWeight;

  // Include if final score is above threshold OR if it's a direct dep (depth=1)
  // Direct deps (depth=1) are always included — they're imported by changed code
  const included = depth === 1 || finalScore >= opts.semanticThreshold;

  const reason = included
    ? `depth=${depth} · semantic=${semanticScore.toFixed(2)} · final=${finalScore.toFixed(2)}`
    : `excluded · semantic=${semanticScore.toFixed(2)} below threshold`;

  return {
    filePath,
    relativePath,
    semanticScore,
    graphScore,
    finalScore,
    depth,
    included,
    reason,
  };
}

// Map numeric depth to the label used in graphDepthToScore
function depthLabel(depth: number): number {
  return depth; // identity for now, allows future remapping
}

/**
 * Score all files in the traversal result.
 * Combines graph traversal output with semantic scores.
 */
export function scoreAllFiles(
  traversal: TraversalResult,
  semanticScores: Map<string, number>,   // filePath → semantic score
  options: Partial<ScorerOptions> = {}
): RelevanceScore[] {
  const scores: RelevanceScore[] = [];

  // Score changed files
  for (const f of traversal.changed) {
    const semantic = semanticScores.get(f.path) ?? 0.5;
    scores.push(scoreFile(f.path, f.relativePath, 0, semantic, options));
  }

  // Score touched files (depth=1)
  for (const f of traversal.touched) {
    const semantic = semanticScores.get(f.path) ?? 0.5;
    scores.push(scoreFile(f.path, f.relativePath, 1, semantic, options));
  }

  // Score ancestor files (depth=2)
  for (const f of traversal.ancestors) {
    const semantic = semanticScores.get(f.path) ?? 0.3;
    scores.push(scoreFile(f.path, f.relativePath, 2, semantic, options));
  }

  return scores.sort((a, b) => b.finalScore - a.finalScore);
}

export function buildSemanticScoreMap(
  scored: ScoredFile[]
): Map<string, number> {
  const map = new Map<string, number>();
  for (const s of scored) {
    map.set(s.filePath, s.score);
  }
  return map;
}