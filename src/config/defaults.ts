export const DELTA_DIR = '.delta';
export const CONFIG_FILE = '.delta/config.json';
export const DB_FILE = '.delta/delta.db';
export const STATE_FILE = '.delta/state.json';
export const HISTORY_DIR = '.delta/history';

export const DEFAULT_CONFIG = {
  version: '1.0',
  budget: {
    preset: 'conservative' as const,
    maxTokens: 2000,
    slots: {
      task: 200,
      changedFiles: 800,
      symbols: 400,
      summaries: 300,
      skeleton: 300,
    },
  },
  graph: {
    maxDepth: 2,
    includeTestFiles: true,
    resolveNodeModules: false,
  },
  relevance: {
    semanticThreshold: 0.45,
    embeddingModel: 'nomic-embed-text',
    combineWithGraph: true,
  },
  indexing: {
    languages: ['typescript', 'javascript', 'python'],
    watchMode: false,
    incrementalDelay: 500,
  },
  ignore: [
    'node_modules/**',
    '**/node_modules/**',
    'dist/**',
    'build/**',
    '.next/**',
    '.delta/**',
    '.claude/**',
    'packages/**',
    '*.generated.ts',
    'coverage/**',
  ],
} as const;

export const BUDGET_PRESETS = {
  conservative: 2000,
  balanced: 4000,
  thorough: 8000,
} as const;

export type BudgetPreset = keyof typeof BUDGET_PRESETS;// trigger change
