import { EMBEDDING_DIMENSIONS } from './embedder.js';

/**
 * Cosine similarity between two vectors.
 * Returns a value between -1 and 1.
 * For embeddings, values range from ~0 to 1 in practice.
 */
export function cosineSimilarity(a: Float32Array, b: Float32Array): number {
  if (a.length !== b.length) {
    throw new Error(
      `Vector dimensions don't match: ${a.length} vs ${b.length}`
    );
  }

  let dotProduct = 0;
  let normA = 0;
  let normB = 0;

  for (let i = 0; i < a.length; i++) {
    const ai = a[i] ?? 0;
    const bi = b[i] ?? 0;
    dotProduct += ai * bi;
    normA += ai * ai;
    normB += bi * bi;
  }

  const magnitude = Math.sqrt(normA) * Math.sqrt(normB);
  if (magnitude === 0) return 0;

  return dotProduct / magnitude;
}

export interface ScoredFile {
  filePath: string;
  score: number;      // 0.0 - 1.0 cosine similarity
}

/**
 * Score all stored vectors against a query vector.
 * Returns files sorted by similarity descending.
 */
export function rankBySimilarity(
  queryVector: Float32Array,
  candidates: Array<{ filePath: string; vector: Float32Array }>
): ScoredFile[] {
  const scored: ScoredFile[] = [];

  for (const candidate of candidates) {
    try {
      const score = cosineSimilarity(queryVector, candidate.vector);
      scored.push({ filePath: candidate.filePath, score });
    } catch {
      // Dimension mismatch — skip this file
    }
  }

  return scored.sort((a, b) => b.score - a.score);
}

/**
 * Filter to only files above the relevance threshold.
 */
export function applyThreshold(
  scored: ScoredFile[],
  threshold: number
): ScoredFile[] {
  return scored.filter((f) => f.score >= threshold);
}