/**
 * Embedding Provider Adapter — Abstraction over multiple embedding backends.
 *
 * Supported providers:
 *   - ollama   (default, local, zero cost)
 *   - openai   (cloud, OpenAI API key required)
 *   - azure    (cloud, Azure OpenAI endpoint + key required)
 *
 * Each provider implements the same EmbeddingProvider interface.
 * The factory resolveProvider() reads config to determine which to use.
 */

// ── Types ─────────────────────────────────────────────────────────────────────

export type ProviderName = 'ollama' | 'openai' | 'azure';

export interface EmbeddingProviderConfig {
  provider: ProviderName;
  model: string;
  /** Base URL for the API (e.g., http://localhost:11434 for Ollama) */
  baseUrl?: string;
  /** API key (for OpenAI/Azure) — sourced from env var */
  apiKeyEnv?: string;
  /** Azure-specific deployment name */
  deploymentName?: string;
  /** Request timeout in milliseconds */
  timeoutMs?: number;
  /** Embedding dimensions (auto-detected if not specified) */
  dimensions?: number;
}

export interface EmbeddingProvider {
  readonly name: ProviderName;
  readonly model: string;

  /** Check if the provider is available and the model is ready */
  checkAvailability(): Promise<{ available: boolean; reason?: string }>;

  /** Generate an embedding for a single text */
  embed(text: string): Promise<Float32Array | null>;

  /** Get the embedding dimensions for this provider/model */
  getDimensions(): number;
}

// ── Default configs ───────────────────────────────────────────────────────────

export const DEFAULT_PROVIDER_CONFIGS: Record<ProviderName, EmbeddingProviderConfig> = {
  ollama: {
    provider: 'ollama',
    model: 'nomic-embed-text',
    baseUrl: 'http://localhost:11434',
    timeoutMs: 30_000,
    dimensions: 768,
  },
  openai: {
    provider: 'openai',
    model: 'text-embedding-3-small',
    baseUrl: 'https://api.openai.com/v1',
    apiKeyEnv: 'OPENAI_API_KEY',
    timeoutMs: 30_000,
    dimensions: 1536,
  },
  azure: {
    provider: 'azure',
    model: 'text-embedding-3-small',
    apiKeyEnv: 'AZURE_OPENAI_API_KEY',
    timeoutMs: 30_000,
    dimensions: 1536,
  },
};

// ── Ollama Provider ───────────────────────────────────────────────────────────

class OllamaProvider implements EmbeddingProvider {
  readonly name: ProviderName = 'ollama';
  readonly model: string;
  private readonly baseUrl: string;
  private readonly timeoutMs: number;
  private readonly dimensions: number;

  constructor(config: EmbeddingProviderConfig) {
    this.model = config.model;
    this.baseUrl = config.baseUrl ?? 'http://localhost:11434';
    this.timeoutMs = config.timeoutMs ?? 30_000;
    this.dimensions = config.dimensions ?? 768;
  }

  async checkAvailability(): Promise<{ available: boolean; reason?: string }> {
    try {
      const response = await fetch(`${this.baseUrl}/api/tags`, {
        signal: AbortSignal.timeout(3_000),
      });

      if (!response.ok) {
        return { available: false, reason: 'Ollama API not responding' };
      }

      const data = await response.json() as { models: Array<{ name: string }> };
      const modelBase = this.model.split(':')[0] ?? this.model;
      const hasModel = data.models.some((m) => m.name.startsWith(modelBase));

      if (!hasModel) {
        return {
          available: false,
          reason: `Model ${this.model} not found. Run: ollama pull ${this.model}`,
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

  async embed(text: string): Promise<Float32Array | null> {
    if (!text || text.trim().length === 0) return null;

    try {
      const response = await fetch(`${this.baseUrl}/api/embeddings`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ model: this.model, prompt: text }),
        signal: AbortSignal.timeout(this.timeoutMs),
      });

      if (!response.ok) return null;

      const data = await response.json() as { embedding: number[] };
      if (!data.embedding || !Array.isArray(data.embedding)) return null;

      return new Float32Array(data.embedding);
    } catch {
      return null;
    }
  }

  getDimensions(): number {
    return this.dimensions;
  }
}

// ── OpenAI Provider ───────────────────────────────────────────────────────────

class OpenAIProvider implements EmbeddingProvider {
  readonly name: ProviderName = 'openai';
  readonly model: string;
  private readonly baseUrl: string;
  private readonly apiKey: string | null;
  private readonly timeoutMs: number;
  private readonly dimensions: number;

  constructor(config: EmbeddingProviderConfig) {
    this.model = config.model;
    this.baseUrl = config.baseUrl ?? 'https://api.openai.com/v1';
    this.apiKey = config.apiKeyEnv ? (process.env[config.apiKeyEnv] ?? null) : null;
    this.timeoutMs = config.timeoutMs ?? 30_000;
    this.dimensions = config.dimensions ?? 1536;
  }

  async checkAvailability(): Promise<{ available: boolean; reason?: string }> {
    if (!this.apiKey) {
      return {
        available: false,
        reason: `API key not set. Export OPENAI_API_KEY or set embeddings.apiKeyEnv in config`,
      };
    }

    try {
      const response = await fetch(`${this.baseUrl}/models`, {
        headers: { Authorization: `Bearer ${this.apiKey}` },
        signal: AbortSignal.timeout(5_000),
      });

      if (!response.ok) {
        return { available: false, reason: `OpenAI API returned ${response.status}` };
      }

      return { available: true };
    } catch {
      return { available: false, reason: 'Could not reach OpenAI API' };
    }
  }

  async embed(text: string): Promise<Float32Array | null> {
    if (!text || text.trim().length === 0 || !this.apiKey) return null;

    try {
      const response = await fetch(`${this.baseUrl}/embeddings`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${this.apiKey}`,
        },
        body: JSON.stringify({
          model: this.model,
          input: text,
        }),
        signal: AbortSignal.timeout(this.timeoutMs),
      });

      if (!response.ok) return null;

      const data = await response.json() as {
        data: Array<{ embedding: number[] }>;
      };

      const embedding = data.data?.[0]?.embedding;
      if (!embedding || !Array.isArray(embedding)) return null;

      return new Float32Array(embedding);
    } catch {
      return null;
    }
  }

  getDimensions(): number {
    return this.dimensions;
  }
}

// ── Azure OpenAI Provider ─────────────────────────────────────────────────────

class AzureProvider implements EmbeddingProvider {
  readonly name: ProviderName = 'azure';
  readonly model: string;
  private readonly baseUrl: string | null;
  private readonly apiKey: string | null;
  private readonly deploymentName: string;
  private readonly timeoutMs: number;
  private readonly dimensions: number;

  constructor(config: EmbeddingProviderConfig) {
    this.model = config.model;
    this.baseUrl = config.baseUrl ?? (process.env['AZURE_OPENAI_ENDPOINT'] ?? null);
    this.apiKey = config.apiKeyEnv ? (process.env[config.apiKeyEnv] ?? null) : null;
    this.deploymentName = config.deploymentName ?? config.model;
    this.timeoutMs = config.timeoutMs ?? 30_000;
    this.dimensions = config.dimensions ?? 1536;
  }

  async checkAvailability(): Promise<{ available: boolean; reason?: string }> {
    if (!this.apiKey) {
      return {
        available: false,
        reason: 'AZURE_OPENAI_API_KEY not set',
      };
    }
    if (!this.baseUrl) {
      return {
        available: false,
        reason: 'AZURE_OPENAI_ENDPOINT not set. Set baseUrl in config or export AZURE_OPENAI_ENDPOINT',
      };
    }

    return { available: true };
  }

  async embed(text: string): Promise<Float32Array | null> {
    if (!text || text.trim().length === 0 || !this.apiKey || !this.baseUrl) return null;

    const url = `${this.baseUrl}/openai/deployments/${this.deploymentName}/embeddings?api-version=2024-02-01`;

    try {
      const response = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'api-key': this.apiKey,
        },
        body: JSON.stringify({ input: text }),
        signal: AbortSignal.timeout(this.timeoutMs),
      });

      if (!response.ok) return null;

      const data = await response.json() as {
        data: Array<{ embedding: number[] }>;
      };

      const embedding = data.data?.[0]?.embedding;
      if (!embedding || !Array.isArray(embedding)) return null;

      return new Float32Array(embedding);
    } catch {
      return null;
    }
  }

  getDimensions(): number {
    return this.dimensions;
  }
}

// ── Factory ───────────────────────────────────────────────────────────────────

/**
 * Create an embedding provider from config.
 * Falls back to Ollama if provider is unrecognized.
 */
export function createProvider(config: EmbeddingProviderConfig): EmbeddingProvider {
  switch (config.provider) {
    case 'openai':
      return new OpenAIProvider(config);
    case 'azure':
      return new AzureProvider(config);
    case 'ollama':
    default:
      return new OllamaProvider(config);
  }
}

/**
 * Resolve the configured provider from a Delta config object.
 * If no embeddings config exists, defaults to Ollama.
 */
export function resolveProvider(
  config?: { embeddings?: Partial<EmbeddingProviderConfig> }
): EmbeddingProvider {
  const embeddingsConfig = config?.embeddings;

  if (!embeddingsConfig?.provider) {
    return createProvider(DEFAULT_PROVIDER_CONFIGS.ollama);
  }

  const providerName = embeddingsConfig.provider;
  const defaults = DEFAULT_PROVIDER_CONFIGS[providerName] ?? DEFAULT_PROVIDER_CONFIGS.ollama;

  const mergedConfig: EmbeddingProviderConfig = {
    ...defaults,
    ...embeddingsConfig,
    provider: providerName,
  };

  return createProvider(mergedConfig);
}

/**
 * Get a summary of all available providers and their status.
 */
export async function checkAllProviders(): Promise<
  Array<{ name: ProviderName; available: boolean; reason?: string; model: string }>
> {
  const results: Array<{
    name: ProviderName;
    available: boolean;
    reason?: string;
    model: string;
  }> = [];

  for (const [name, config] of Object.entries(DEFAULT_PROVIDER_CONFIGS)) {
    const provider = createProvider(config);
    const check = await provider.checkAvailability();
    results.push({
      name: name as ProviderName,
      available: check.available,
      model: config.model,
      ...(check.reason ? { reason: check.reason } : {}),
    });
  }

  return results;
}
