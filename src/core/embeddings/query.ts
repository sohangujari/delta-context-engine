import { embed, buildEmbeddingText, checkOllamaAvailable } from './embedder.js';
import { rankBySimilarity, applyThreshold, type ScoredFile } from './similarity.js';
import type { VectorStore } from './vector-store.js';
import type { SymbolStore } from '../../persistence/symbol-store.js';
import { formatSymbolMap } from '../ast/symbol-map.js';

export interface QueryOptions {
  task: string;
  projectRoot: string;
  threshold?: number;
  topK?: number;
  model?: string;
}

export interface QueryResult {
  scored: ScoredFile[];
  queryVector: Float32Array | null;
  embeddingsAvailable: boolean;
  skippedReason?: string | undefined;  // explicitly allow undefined
}

/**
 * Embed the task instruction and rank all indexed files by semantic relevance.
 * Layer 2 of the Delta pipeline.
 * Fails gracefully — if Ollama is down, pipeline continues without embeddings.
 */
export async function queryByTask(
  options: QueryOptions,
  vectorStore: VectorStore,
  symbolStore: SymbolStore
): Promise<QueryResult> {
  const {
    task,
    projectRoot,
    threshold = 0.65,
    topK = 50,
    model = 'nomic-embed-text',
  } = options;

  // Check Ollama is available
  const ollamaCheck = await checkOllamaAvailable(model);
  if (!ollamaCheck.available) {
    return {
      scored: [],
      queryVector: null,
      embeddingsAvailable: false,
      skippedReason: ollamaCheck.reason,
    };
  }

  // Check we have embeddings stored
  const embeddingCount = vectorStore.count();
  if (embeddingCount === 0) {
    return {
      scored: [],
      queryVector: null,
      embeddingsAvailable: false,
      skippedReason: 'No embeddings in index. Run: delta init',
    };
  }

  // Embed the task instruction
  const taskEmbedding = await embed(task, model);
  if (!taskEmbedding) {
    return {
      scored: [],
      queryVector: null,
      embeddingsAvailable: false,
      skippedReason: 'Failed to embed task instruction',
    };
  }

  // Score all files against the task vector
  const allVectors = vectorStore.getAllVectors();
  const allScored = rankBySimilarity(taskEmbedding.vector, allVectors);
  const filtered = applyThreshold(allScored, threshold).slice(0, topK);

  return {
    scored: filtered,
    queryVector: taskEmbedding.vector,
    embeddingsAvailable: true,
  };
}

/**
 * Build embedding text for a file and store the vector.
 * Called during delta init for each file.
 */
export async function embedFile(
  filePath: string,
  projectRoot: string,
  symbolStore: SymbolStore,
  vectorStore: VectorStore,
  model = 'nomic-embed-text'
): Promise<boolean> {
  const symbolMap = symbolStore.get(filePath);
  const symbolText = symbolMap ? formatSymbolMap(symbolMap) : '';
  const summary = symbolMap
    ? (await import('../ast/summary-generator.js')).generateSummary(symbolMap)
    : '';

  const embeddingText = buildEmbeddingText(
    filePath,
    projectRoot,
    symbolText,
    summary
  );

  if (!embeddingText.trim()) return false;

  const result = await embed(embeddingText, model);
  if (!result) return false;

  vectorStore.save(filePath, result.vector, model);
  return true;
}// change
