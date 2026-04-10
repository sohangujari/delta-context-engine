import path from 'path';
import type { GraphStore } from '../../persistence/graph-store.js';
import type { ClassifiedFile } from '../change-detector/state-classifier.js';

export interface TraversalResult {
  files: Map<string, ClassifiedFile>;  // path → classification
  changed: ClassifiedFile[];
  touched: ClassifiedFile[];           // depth=1
  ancestors: ClassifiedFile[];         // depth=2
  unrelated: ClassifiedFile[];
}

/**
 * Starting from the set of changed files, walk the dependency graph
 * outward to maxDepth and classify every reachable file.
 *
 * depth=0  CHANGED   → full content in context
 * depth=1  TOUCHED   → symbol map only
 * depth=2  ANCESTOR  → 1-line summary only
 * depth=3+ UNRELATED → excluded from context
 */
export function traverseFromChanged(
  changedPaths: string[],
  graphStore: GraphStore,
  projectRoot: string,
  maxDepth = 2
): TraversalResult {
  const files = new Map<string, ClassifiedFile>();

  // Seed with changed files at depth=0
  for (const filePath of changedPaths) {
    files.set(filePath, {
      path: filePath,
      relativePath: path.relative(projectRoot, filePath),
      state: 'CHANGED',
      depth: 0,
    });
  }

  // BFS outward from changed files
  let frontier = [...changedPaths];

  for (let depth = 1; depth <= maxDepth; depth++) {
    const nextFrontier: string[] = [];

    for (const filePath of frontier) {
      // Get all files that THIS file imports (dependencies)
      const deps = graphStore.getDependencies(filePath);

      // Also get files that import THIS file (dependents/consumers)
      // This catches cases where login.ts imports auth.ts — we want
      // both directions so auth.ts is marked as touched
      const dependents = graphStore.getDependents(filePath);

      const neighbors = [...deps, ...dependents];

      for (const neighbor of neighbors) {
        if (files.has(neighbor)) {
          // Already classified at an equal or lower depth — skip
          const existing = files.get(neighbor)!;
          if (existing.depth <= depth) continue;
        }

        const state =
          depth === 1 ? 'TOUCHED' : depth === 2 ? 'ANCESTOR' : 'UNRELATED';

        files.set(neighbor, {
          path: neighbor,
          relativePath: path.relative(projectRoot, neighbor),
          state,
          depth,
        });

        if (depth < maxDepth) {
          nextFrontier.push(neighbor);
        }
      }
    }

    frontier = nextFrontier;
    if (frontier.length === 0) break;
  }

  // Bucket into categories
  const changed: ClassifiedFile[] = [];
  const touched: ClassifiedFile[] = [];
  const ancestors: ClassifiedFile[] = [];
  const unrelated: ClassifiedFile[] = [];

  for (const file of files.values()) {
    switch (file.state) {
      case 'CHANGED':   changed.push(file);   break;
      case 'TOUCHED':   touched.push(file);   break;
      case 'ANCESTOR':  ancestors.push(file); break;
      default:          unrelated.push(file); break;
    }
  }

  return { files, changed, touched, ancestors, unrelated };
}

export function formatTraversalResult(
  result: TraversalResult,
  allProjectFiles: string[],
  projectRoot: string
): string {
  const lines: string[] = [];
  const classifiedPaths = new Set(result.files.keys());

  lines.push(`Graph traversal result:`);
  lines.push(`  CHANGED  (depth=0): ${result.changed.length} file(s)`);
  lines.push(`  TOUCHED  (depth=1): ${result.touched.length} file(s)`);
  lines.push(`  ANCESTOR (depth=2): ${result.ancestors.length} file(s)`);

  const unrelatedCount =
    allProjectFiles.filter((f) => !classifiedPaths.has(f)).length;
  lines.push(`  UNRELATED (excluded): ${unrelatedCount} file(s)`);

  if (result.changed.length > 0) {
    lines.push('');
    lines.push('Changed:');
    for (const f of result.changed) {
      lines.push(`  ● ${f.relativePath}`);
    }
  }

  if (result.touched.length > 0) {
    lines.push('');
    lines.push('Touched (symbols only):');
    for (const f of result.touched) {
      lines.push(`  ○ ${f.relativePath}`);
    }
  }

  if (result.ancestors.length > 0) {
    lines.push('');
    lines.push('Ancestors (summary only):');
    for (const f of result.ancestors) {
      lines.push(`  · ${f.relativePath}`);
    }
  }

  return lines.join('\n');
}