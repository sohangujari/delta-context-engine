import type { RelevanceScore } from './scorer.js';
import type { TraversalResult } from '../graph/traverser.js';

export interface RankedContext {
  changed: RelevanceScore[];    // depth=0, always full content
  touched: RelevanceScore[];    // depth=1, symbols only
  ancestors: RelevanceScore[];  // depth=2, summaries only
  excluded: RelevanceScore[];   // below threshold or too deep
}

/**
 * Take scored files and bucket them into context slots.
 * This is the final ranking step before the assembler.
 *
 * The assembler uses these buckets to build the priority stack.
 */
export function rankForContext(scores: RelevanceScore[]): RankedContext {
  const changed: RelevanceScore[] = [];
  const touched: RelevanceScore[] = [];
  const ancestors: RelevanceScore[] = [];
  const excluded: RelevanceScore[] = [];

  for (const score of scores) {
    if (!score.included) {
      excluded.push(score);
      continue;
    }

    switch (score.depth) {
      case 0:
        changed.push(score);
        break;
      case 1:
        touched.push(score);
        break;
      case 2:
        ancestors.push(score);
        break;
      default:
        excluded.push(score);
    }
  }

  // Sort each bucket by final score descending
  touched.sort((a, b) => b.finalScore - a.finalScore);
  ancestors.sort((a, b) => b.finalScore - a.finalScore);

  return { changed, touched, ancestors, excluded };
}

/**
 * Format relevance scores for verbose output.
 */
export function formatRelevanceScores(
  ranked: RankedContext,
  showExcluded = false
): string {
  const lines: string[] = [];

  lines.push('Relevance Scores:');

  for (const f of ranked.changed) {
    lines.push(
      `  ● [CHANGED ] ${f.relativePath.padEnd(45)} score=1.00`
    );
  }

  for (const f of ranked.touched) {
    lines.push(
      `  ○ [TOUCHED ] ${f.relativePath.padEnd(45)} ` +
      `semantic=${f.semanticScore.toFixed(2)} final=${f.finalScore.toFixed(2)}`
    );
  }

  for (const f of ranked.ancestors) {
    lines.push(
      `  · [ANCESTOR] ${f.relativePath.padEnd(45)} ` +
      `semantic=${f.semanticScore.toFixed(2)} final=${f.finalScore.toFixed(2)}`
    );
  }

  if (showExcluded && ranked.excluded.length > 0) {
    lines.push('');
    lines.push('  Excluded by relevance scorer:');
    for (const f of ranked.excluded.slice(0, 5)) {
      lines.push(`  ✗ ${f.relativePath.padEnd(45)} ${f.reason}`);
    }
    if (ranked.excluded.length > 5) {
      lines.push(`  ... and ${ranked.excluded.length - 5} more`);
    }
  }

  return lines.join('\n');
}