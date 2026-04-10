// Calls Ollama REST API to generate embeddings locally.
// Zero API cost, works offline, runs on Apple Silicon.

const OLLAMA_BASE_URL = 'http://localhost:11434';
const DEFAULT_MODEL = 'nomic-embed-text';
const EMBEDDING_DIMENSIONS = 768;

export interface EmbeddingResult {
  vector: Float32Array;
  model: string;
  dimensions: number;
}

/**
 * Embed a single text string using the local Ollama model.
 * Returns null if Ollama is not running or the model is not available.
 */
export async function embed(
  text: string,
  model = DEFAULT_MODEL
): Promise<EmbeddingResult | null> {
  if (!text || text.trim().length === 0) {
    return null;
  }

  try {
    const response = await fetch(`${OLLAMA_BASE_URL}/api/embeddings`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ model, prompt: text }),
      signal: AbortSignal.timeout(30_000), // 30s timeout
    });

    if (!response.ok) {
      console.warn(`⚠ Ollama embedding failed: ${response.status} ${response.statusText}`);
      return null;
    }

    const data = await response.json() as { embedding: number[] };

    if (!data.embedding || !Array.isArray(data.embedding)) {
      console.warn('⚠ Ollama returned invalid embedding format');
      return null;
    }

    return {
      vector: new Float32Array(data.embedding),
      model,
      dimensions: data.embedding.length,
    };
  } catch (err) {
    // Ollama not running — fail silently, pipeline continues without embeddings
    if (isConnectionError(err)) {
      return null;
    }
    console.warn('⚠ Embedding error:', err instanceof Error ? err.message : err);
    return null;
  }
}

/**
 * Embed multiple texts in sequence.
 * Returns a map of text → vector for successful embeddings.
 */
export async function embedBatch(
  texts: Array<{ id: string; text: string }>,
  model = DEFAULT_MODEL,
  onProgress?: (done: number, total: number) => void
): Promise<Map<string, Float32Array>> {
  const results = new Map<string, Float32Array>();

  for (let i = 0; i < texts.length; i++) {
    const item = texts[i];
    if (!item) continue;

    const result = await embed(item.text, model);
    if (result) {
      results.set(item.id, result.vector);
    }

    onProgress?.(i + 1, texts.length);
  }

  return results;
}

/**
 * Check if Ollama is running and the model is available.
 */
export async function checkOllamaAvailable(
  model = DEFAULT_MODEL
): Promise<{ available: boolean; reason?: string }> {
  try {
    const response = await fetch(`${OLLAMA_BASE_URL}/api/tags`, {
      signal: AbortSignal.timeout(3_000),
    });

    if (!response.ok) {
      return { available: false, reason: 'Ollama API not responding' };
    }

    const data = await response.json() as {
      models: Array<{ name: string }>
    };

    const hasModel = data.models.some(
      (m) => m.name.startsWith(model.split(':')[0] ?? model)
    );

    if (!hasModel) {
      return {
        available: false,
        reason: `Model ${model} not found. Run: ollama pull ${model}`,
      };
    }

    return { available: true };
  } catch {
    return {
      available: false,
      reason: 'Ollama not running. Run: ollama serve',
    };
  }
}

/**
 * Build the text to embed for a file.
 * Combines file path + symbol map for richer semantic signal.
 */
export function buildEmbeddingText(
  filePath: string,
  projectRoot: string,
  symbolMapText: string,
  summary: string
): string {
  const relativePath = filePath.replace(projectRoot + '/', '');

  // Combine path context + symbols + summary
  // Path gives structural signal (e.g. "auth/login" vs "payments/stripe")
  // Symbols give semantic signal (function names, types)
  // Summary gives natural language signal
  const parts = [
    `file: ${relativePath}`,
    summary ? `description: ${summary}` : '',
    symbolMapText ? `symbols:\n${symbolMapText}` : '',
  ].filter(Boolean);

  return parts.join('\n');
}

function isConnectionError(err: unknown): boolean {
  if (!(err instanceof Error)) return false;
  return (
    err.message.includes('ECONNREFUSED') ||
    err.message.includes('fetch failed') ||
    err.message.includes('NetworkError') ||
    err.message.includes('timeout')
  );
}

export { EMBEDDING_DIMENSIONS, DEFAULT_MODEL };