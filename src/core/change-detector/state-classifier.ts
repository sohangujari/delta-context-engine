import fs from 'fs';
import path from 'path';
import { getGitChangedFiles } from './git-diff.js';
import { detectChangedByHash, walkDirectory } from './hash-tracker.js';
import { loadIgnorePatterns } from '../../config/deltaignore.js';
import type { StateStore } from '../../persistence/state-store.js';

export type FileState = 'CHANGED' | 'TOUCHED' | 'ANCESTOR' | 'UNRELATED';

export interface ClassifiedFile {
  path: string;         // absolute path
  relativePath: string; // relative to project root
  state: FileState;
  depth: number;        // 0=changed, 1=direct dep, 2=transitive, 3+=unrelated
}

export interface ClassificationResult {
  changed: ClassifiedFile[];
  all: Map<string, ClassifiedFile>;  // path → classification
  strategy: 'git' | 'hash' | 'hybrid';
  changedCount: number;
  totalFiles: number;
}

export async function classifyFiles(
  projectRoot: string,
  stateStore: StateStore,
  allIndexedFiles?: string[]
): Promise<ClassificationResult> {
  const ignorePatterns = loadIgnorePatterns(projectRoot);

  // Step 1: Get changed files via git (primary strategy)
  const gitResult = await getGitChangedFiles(projectRoot);

  let changedPaths: string[];
  let strategy: 'git' | 'hash' | 'hybrid';

  if (gitResult.isGitRepo && gitResult.changedFiles.length > 0) {
    // Pure git strategy — fast and accurate
    changedPaths = gitResult.changedFiles.filter((f) => fs.existsSync(f));
    strategy = 'git';
  } else if (gitResult.isGitRepo && gitResult.changedFiles.length === 0) {
    // Git says nothing changed — cross-check with hashes
    // (handles cases where git cache is stale)
    const allFiles =
      allIndexedFiles ??
      walkDirectory(projectRoot, projectRoot, ignorePatterns);

    const hashChanged = detectChangedByHash(
      allFiles,
      (p) => stateStore.getHash(p)
    );

    changedPaths = hashChanged;
    strategy = hashChanged.length > 0 ? 'hybrid' : 'git';
  } else {
    // Not a git repo — fall back to hash comparison entirely
    const allFiles =
      allIndexedFiles ??
      walkDirectory(projectRoot, projectRoot, ignorePatterns);

    changedPaths = detectChangedByHash(allFiles, (p) => stateStore.getHash(p));
    strategy = 'hash';
  }

  // Step 2: Build classification map
  // At this stage (Phase 1), depth-1/2 classification happens in the
  // graph traverser (M1.4). Here we emit CHANGED or UNRELATED only.
  // The graph traverser will upgrade UNRELATED → TOUCHED/ANCESTOR.
  const changedSet = new Set(changedPaths);
  const allFiles =
    allIndexedFiles ??
    walkDirectory(projectRoot, projectRoot, ignorePatterns);

  const all = new Map<string, ClassifiedFile>();

  for (const filePath of allFiles) {
    const isChanged = changedSet.has(filePath);
    const classified: ClassifiedFile = {
      path: filePath,
      relativePath: path.relative(projectRoot, filePath),
      state: isChanged ? 'CHANGED' : 'UNRELATED',
      depth: isChanged ? 0 : 999,
    };
    all.set(filePath, classified);
  }

  // Ensure all changed files are in the map even if not in allFiles
  // (e.g. newly created files)
  for (const filePath of changedPaths) {
    if (!all.has(filePath) && fs.existsSync(filePath)) {
      all.set(filePath, {
        path: filePath,
        relativePath: path.relative(projectRoot, filePath),
        state: 'CHANGED',
        depth: 0,
      });
    }
  }

  const changed = [...all.values()].filter((f) => f.state === 'CHANGED');

  return {
    changed,
    all,
    strategy,
    changedCount: changed.length,
    totalFiles: all.size,
  };
}

export function summarizeClassification(result: ClassificationResult): string {
  const lines: string[] = [];
  lines.push(`Strategy: ${result.strategy}`);
  lines.push(`Changed: ${result.changedCount} / ${result.totalFiles} files`);
  if (result.changed.length > 0) {
    for (const f of result.changed) {
      lines.push(`  CHANGED  ${f.relativePath}`);
    }
  } else {
    lines.push('  No changes detected');
  }
  return lines.join('\n');
}