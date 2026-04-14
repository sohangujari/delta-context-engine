import chokidar from 'chokidar';
import path from 'path';
import fs from 'fs';
import { loadIgnorePatterns } from '../../config/deltaignore.js';
import { updateFileInGraph } from '../graph/builder.js';
import { embedFile } from '../embeddings/query.js';
import type { GraphStore } from '../../persistence/graph-store.js';
import type { StateStore } from '../../persistence/state-store.js';
import type { SymbolStore } from '../../persistence/symbol-store.js';
import type { VectorStore } from '../embeddings/vector-store.js';

export interface WatcherOptions {
  projectRoot: string;
  graphStore: GraphStore;
  stateStore: StateStore;
  symbolStore: SymbolStore;
  vectorStore: VectorStore;
  debounceMs?: number;
  onUpdate?: (event: WatchEvent) => void;
}

export interface WatchEvent {
  type: 'updated' | 'added' | 'removed' | 'error';
  filePath: string;
  relativePath: string;
  durationMs: number;
  embeddingUpdated: boolean;
  error?: string;
}

const SUPPORTED_EXTENSIONS = new Set([
  '.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs', '.py',
]);

/**
 * Start watching the project for file changes.
 * On every save: re-index the file (AST + graph edges + embedding).
 * Target: <6s per file update (PRD NFR-P2).
 *
 * Returns a stop function - call it to shut down the watcher.
 */
export function startWatcher(options: WatcherOptions): () => Promise<void> {
  const {
    projectRoot,
    graphStore,
    stateStore,
    symbolStore,
    vectorStore,
    debounceMs = 500,
    onUpdate,
  } = options;

  const ignorePatterns = loadIgnorePatterns(projectRoot);

  // Build chokidar ignore list
  // chokidar expects functions or regex - convert our glob patterns
  const ignored = [
    /(^|[/\\])\../,          // dot files
    /node_modules/,
    /\.delta/,
    /dist\//,
    /build\//,
    /coverage\//,
  ];

  const watcher = chokidar.watch(projectRoot, {
    ignored,
    persistent: true,
    ignoreInitial: true,   // don't fire for existing files on start
    awaitWriteFinish: {
      stabilityThreshold: debounceMs,
      pollInterval: 100,
    },
  });

  // Debounce map - prevent rapid successive updates to same file
  const pendingUpdates = new Map<string, ReturnType<typeof setTimeout>>();

  function scheduleUpdate(filePath: string, eventType: 'add' | 'change'): void {
    const ext = path.extname(filePath).toLowerCase();
    if (!SUPPORTED_EXTENSIONS.has(ext)) return;

    // Cancel any pending update for this file
    const existing = pendingUpdates.get(filePath);
    if (existing) clearTimeout(existing);

    const timer = setTimeout(async () => {
      pendingUpdates.delete(filePath);
      await processFileUpdate(filePath, eventType === 'add' ? 'added' : 'updated');
    }, 100); // small extra debounce on top of chokidar's awaitWriteFinish

    pendingUpdates.set(filePath, timer);
  }

  async function processFileUpdate(
    filePath: string,
    type: 'updated' | 'added' | 'removed'
  ): Promise<void> {
    const start = Date.now();
    const relativePath = path.relative(projectRoot, filePath);

    try {
      if (type === 'removed') {
        // Clean up all records for this file
        graphStore.deleteEdgesFor(filePath);
        stateStore.delete(filePath);
        symbolStore.delete(filePath);
        vectorStore.delete(filePath);

        onUpdate?.({
          type: 'removed',
          filePath,
          relativePath,
          durationMs: Date.now() - start,
          embeddingUpdated: false,
        });
        return;
      }

      if (!fs.existsSync(filePath)) return;

      // Re-index: AST + graph edges + state store
      await updateFileInGraph(
        filePath,
        projectRoot,
        graphStore,
        stateStore,
        symbolStore
      );

      // Re-embed: update vector store
      let embeddingUpdated = false;
      try {
        embeddingUpdated = await embedFile(
          filePath,
          projectRoot,
          symbolStore,
          vectorStore
        );
      } catch {
        // Embedding failure is non-fatal - AST index still updated
      }

      const durationMs = Date.now() - start;

      onUpdate?.({
        type,
        filePath,
        relativePath,
        durationMs,
        embeddingUpdated,
      });

    } catch (err) {
      const error = err instanceof Error ? err.message : String(err);
      onUpdate?.({
        type: 'error',
        filePath,
        relativePath,
        durationMs: Date.now() - start,
        embeddingUpdated: false,
        error,
      });
    }
  }

  // Wire chokidar events
  watcher
    .on('change', (filePath) => scheduleUpdate(filePath, 'change'))
    .on('add',    (filePath) => scheduleUpdate(filePath, 'add'))
    .on('unlink', (filePath) => {
      void processFileUpdate(filePath, 'removed');
    })
    .on('error',  (err) => {
      console.error('⚠ Watcher error:', err);
    });

  // Return stop function
  return async (): Promise<void> => {
    // Cancel all pending debounced updates
    for (const timer of pendingUpdates.values()) {
      clearTimeout(timer);
    }
    pendingUpdates.clear();
    await watcher.close();
  };
}