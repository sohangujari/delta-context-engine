import path from 'path';
import { extractSymbols } from '../ast/symbol-extractor.js';
import { resolveImports } from './resolver.js';
import type { GraphStore } from '../../persistence/graph-store.js';
import type { StateStore } from '../../persistence/state-store.js';
import { hashFile } from '../change-detector/hash-tracker.js';

export interface BuildGraphOptions {
  projectRoot: string;
  allFiles: string[];
  graphStore: GraphStore;
  stateStore: StateStore;
  onProgress?: (done: number, total: number, filePath: string) => void;
}

export interface GraphBuildResult {
  filesProcessed: number;
  edgesCreated: number;
  errors: string[];
}

/**
 * Build the full dependency graph for all files.
 * Called once during `delta init`.
 *
 * Order per file:
 *   1. Extract symbols (AST parse)
 *   2. Save file record to indexed_files  ← must happen before edges
 *   3. Resolve imports to absolute paths
 *   4. Save dependency edges to graph_edges
 */
export async function buildFullGraph(
  options: BuildGraphOptions
): Promise<GraphBuildResult> {
  const { projectRoot, allFiles, graphStore, stateStore, onProgress } = options;

  let filesProcessed = 0;
  let edgesCreated = 0;
  const errors: string[] = [];

  // Pass 1: Index all files (AST + state store)
  // We do this in a first pass so that when we save edges in Pass 2,
  // all file records already exist
  for (const filePath of allFiles) {
    try {
      const symbolMap = await extractSymbols(filePath);
      const now = new Date().toISOString();
      const hash = hashFile(filePath);

      stateStore.save({
        path: filePath,
        hash,
        state: 'UNRELATED',
        tokenCount: symbolMap?.rawTokenCount ?? 0,
        symbolTokenCount: symbolMap?.tokenCount ?? 0,
        summary: '',
        lastIndexed: now,
        lastChanged: now,
      });

      filesProcessed++;
      onProgress?.(filesProcessed, allFiles.length * 2, filePath);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      errors.push(`${path.relative(projectRoot, filePath)}: ${msg}`);
      filesProcessed++;
      onProgress?.(filesProcessed, allFiles.length * 2, filePath);
    }
  }

  // Pass 2: Build dependency graph edges
  for (const filePath of allFiles) {
    try {
      const symbolMap = await extractSymbols(filePath);

      if (symbolMap && symbolMap.imports.length > 0) {
        const resolvedDeps = resolveImports(
          symbolMap.imports,
          filePath,
          projectRoot
        );

        if (resolvedDeps.length > 0) {
          graphStore.saveEdges(filePath, resolvedDeps);
          edgesCreated += resolvedDeps.length;
        }
      }

      onProgress?.(
        allFiles.length + filesProcessed,
        allFiles.length * 2,
        filePath
      );
    } catch (err) {
      // Edge building errors are non-fatal — file is already indexed
      const msg = err instanceof Error ? err.message : String(err);
      errors.push(`${path.relative(projectRoot, filePath)}: ${msg}`);
    }
  }

  return { filesProcessed, edgesCreated, errors };
}

/**
 * Update graph edges for a single file.
 * Called on file save during incremental re-index (Phase 2).
 */
export async function updateFileInGraph(
  filePath: string,
  projectRoot: string,
  graphStore: GraphStore,
  stateStore: StateStore
): Promise<void> {
  const symbolMap = await extractSymbols(filePath);
  const now = new Date().toISOString();
  const hash = hashFile(filePath);

  // Always update the file record first
  stateStore.save({
    path: filePath,
    hash,
    state: 'UNRELATED',
    tokenCount: symbolMap?.rawTokenCount ?? 0,
    symbolTokenCount: symbolMap?.tokenCount ?? 0,
    summary: '',
    lastIndexed: now,
    lastChanged: now,
  });

  if (!symbolMap) {
    graphStore.deleteEdgesFor(filePath);
    return;
  }

  const resolvedDeps = resolveImports(
    symbolMap.imports,
    filePath,
    projectRoot
  );

  graphStore.saveEdges(filePath, resolvedDeps);
}