import path from 'path';
import { extractSymbols } from '../ast/symbol-extractor.js';
import { generateSummary } from '../ast/summary-generator.js';
import { resolveImports } from './resolver.js';
import type { GraphStore } from '../../persistence/graph-store.js';
import type { StateStore } from '../../persistence/state-store.js';
import type { SymbolStore } from '../../persistence/symbol-store.js';
import { hashFile } from '../change-detector/hash-tracker.js';

export interface BuildGraphOptions {
  projectRoot: string;
  allFiles: string[];
  graphStore: GraphStore;
  stateStore: StateStore;
  symbolStore: SymbolStore;
  onProgress?: (done: number, total: number, filePath: string) => void;
}

export interface GraphBuildResult {
  filesProcessed: number;
  edgesCreated: number;
  errors: string[];
}

export async function buildFullGraph(
  options: BuildGraphOptions
): Promise<GraphBuildResult> {
  const {
    projectRoot,
    allFiles,
    graphStore,
    stateStore,
    symbolStore,
    onProgress,
  } = options;

  let filesProcessed = 0;
  let edgesCreated = 0;
  const errors: string[] = [];

  // Pass 1: Index all files — AST + state + symbol maps
  for (const filePath of allFiles) {
    try {
      const symbolMap = await extractSymbols(filePath);
      const now = new Date().toISOString();
      const hash = hashFile(filePath);
      const summary = symbolMap ? generateSummary(symbolMap) : '';

      stateStore.save({
        path: filePath,
        hash,
        state: 'UNRELATED',
        tokenCount: symbolMap?.rawTokenCount ?? 0,
        symbolTokenCount: symbolMap?.tokenCount ?? 0,
        summary,
        lastIndexed: now,
        lastChanged: now,
      });

      if (symbolMap) {
        symbolStore.save(symbolMap);
      }

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
      const symbolMap = symbolStore.get(filePath);

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
      const msg = err instanceof Error ? err.message : String(err);
      errors.push(`${path.relative(projectRoot, filePath)}: ${msg}`);
    }
  }

  return { filesProcessed, edgesCreated, errors };
}

export async function updateFileInGraph(
  filePath: string,
  projectRoot: string,
  graphStore: GraphStore,
  stateStore: StateStore,
  symbolStore: SymbolStore
): Promise<void> {
  const symbolMap = await extractSymbols(filePath);
  const now = new Date().toISOString();
  const hash = hashFile(filePath);
  const summary = symbolMap ? generateSummary(symbolMap) : '';

  stateStore.save({
    path: filePath,
    hash,
    state: 'UNRELATED',
    tokenCount: symbolMap?.rawTokenCount ?? 0,
    symbolTokenCount: symbolMap?.tokenCount ?? 0,
    summary,
    lastIndexed: now,
    lastChanged: now,
  });

  if (!symbolMap) {
    graphStore.deleteEdgesFor(filePath);
    symbolStore.delete(filePath);
    return;
  }

  symbolStore.save(symbolMap);

  const resolvedDeps = resolveImports(
    symbolMap.imports,
    filePath,
    projectRoot
  );

  graphStore.saveEdges(filePath, resolvedDeps);
}