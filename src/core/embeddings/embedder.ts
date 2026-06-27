// Embedding module — delegates to the configured EmbeddingProvider.
// Default: Ollama (local, zero cost, offline).
// Supports: OpenAI, Azure OpenAI via provider adapter.

import {
  resolveProvider,
  type EmbeddingProvider,
  type EmbeddingProviderConfig,
  DEFAULT_PROVIDER_CONFIGS,
} from './provider.js';

const OLLAMA_BASE_URL = 'http://localhost:11434';
const DEFAULT_MODEL = 'nomic-embed-text';
const EMBEDDING_DIMENSIONS = 768;

export interface EmbeddingResult {
  vector: Float32Array;
  model: string;
  dimensions: number;
}

// ── Provider instance (lazy-initialized) ──────────────────────────────────────

let activeProvider: EmbeddingProvider | null = null;

/**
 * Get or create the active embedding provider.
 * On first call, resolves from config. Subsequent calls return cached instance.
 */
export function getActiveProvider(
  config?: { embeddings?: Partial<EmbeddingProviderConfig> }
): EmbeddingProvider {
  if (!activeProvider) {
    activeProvider = resolveProvider(config);
  }
  return activeProvider;
}

/**
 * Set a specific provider (useful for testing or explicit config).
 */
export function setActiveProvider(provider: EmbeddingProvider): void {
  activeProvider = provider;
}

/**
 * Reset the active provider (forces re-resolution on next call).
 */
export function resetProvider(): void {
  activeProvider = null;
}

// ── Public API (backward-compatible) ──────────────────────────────────────────

/**
 * Embed a single text string using the active provider.
 * Returns null if the provider is not available.
 *
 * The `model` parameter is kept for backward compatibility but is ignored
 * when a non-Ollama provider is active (it uses its own configured model).
 */
export async function embed(
  text: string,
  model = DEFAULT_MODEL
): Promise<EmbeddingResult | null> {
  if (!text || text.trim().length === 0) {
    return null;
  }

  const provider = getActiveProvider();

  try {
    const vector = await provider.embed(text);
    if (!vector) return null;

    return {
      vector,
      model: provider.model,
      dimensions: vector.length,
    };
  } catch (err) {
    if (isConnectionError(err)) {
      return null;
    }
    console.warn('⚠ Embedding error:', err instanceof Error ? err.message : err);
    return null;
  }
}

/**
 * Embed multiple texts in sequence.
 * Returns a map of id → vector for successful embeddings.
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
 * Kept for backward compatibility — delegates to the Ollama provider check.
 */
export async function checkOllamaAvailable(
  model = DEFAULT_MODEL
): Promise<{ available: boolean; reason?: string }> {
  // Always check Ollama specifically, regardless of active provider
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
 * Check if the active provider is available.
 * Uses the adapter's checkAvailability() method.
 */
export async function checkProviderAvailable(
  config?: { embeddings?: Partial<EmbeddingProviderConfig> }
): Promise<{ available: boolean; reason?: string; providerName: string }> {
  const provider = getActiveProvider(config);
  const check = await provider.checkAvailability();
  return {
    ...check,
    providerName: provider.name,
  };
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