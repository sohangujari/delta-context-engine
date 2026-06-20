/**
 * Language Registry — Central registry for all supported file extensions.
 *
 * Tier 1 (full):     tree-sitter AST extraction — TS, JS, Python, Go, Rust, Java, C#, C++, Ruby, PHP
 * Tier 2 (pattern):  Regex-based pattern extraction — Kotlin, Swift, Scala, Dart, R, Lua, etc.
 * Tier 3 (notebook): Notebook cell extraction — .ipynb, .dbc
 * Tier 4 (minimal):  Indexing + embedding only, no symbol extraction — Markdown, configs, etc.
 */

import type { SupportedLanguage } from './symbol-map.js';

// ── Types ─────────────────────────────────────────────────────────────────────

export type ExtractionTier = 'full' | 'pattern' | 'notebook' | 'minimal';

export interface LanguageConfig {
  /** File extension including dot, e.g. '.ts' */
  extension: string;
  /** Language identifier */
  language: SupportedLanguage;
  /** Which extraction pipeline to use */
  tier: ExtractionTier;
  /** Display name */
  displayName: string;
}

// ── Registry ──────────────────────────────────────────────────────────────────

const ALL_LANGUAGES: LanguageConfig[] = [
  // ── Tier 1: Full tree-sitter AST ────────────────────────────────────────────
  { extension: '.ts',   language: 'typescript',  tier: 'full', displayName: 'TypeScript' },
  { extension: '.tsx',  language: 'typescript',  tier: 'full', displayName: 'TypeScript (TSX)' },
  { extension: '.js',   language: 'javascript',  tier: 'full', displayName: 'JavaScript' },
  { extension: '.jsx',  language: 'javascript',  tier: 'full', displayName: 'JavaScript (JSX)' },
  { extension: '.mjs',  language: 'javascript',  tier: 'full', displayName: 'JavaScript (ESM)' },
  { extension: '.cjs',  language: 'javascript',  tier: 'full', displayName: 'JavaScript (CJS)' },
  { extension: '.py',   language: 'python',      tier: 'full', displayName: 'Python' },
  { extension: '.pyi',  language: 'python',      tier: 'full', displayName: 'Python (stub)' },
  { extension: '.go',   language: 'go',          tier: 'full', displayName: 'Go' },
  { extension: '.rs',   language: 'rust',        tier: 'full', displayName: 'Rust' },
  { extension: '.java', language: 'java',        tier: 'full', displayName: 'Java' },
  { extension: '.cs',   language: 'csharp',      tier: 'full', displayName: 'C#' },
  { extension: '.cpp',  language: 'cpp',         tier: 'full', displayName: 'C++' },
  { extension: '.cc',   language: 'cpp',         tier: 'full', displayName: 'C++' },
  { extension: '.cxx',  language: 'cpp',         tier: 'full', displayName: 'C++' },
  { extension: '.c',    language: 'cpp',         tier: 'full', displayName: 'C' },
  { extension: '.h',    language: 'cpp',         tier: 'full', displayName: 'C/C++ Header' },
  { extension: '.hpp',  language: 'cpp',         tier: 'full', displayName: 'C++ Header' },
  { extension: '.rb',   language: 'ruby',        tier: 'full', displayName: 'Ruby' },
  { extension: '.php',  language: 'php',         tier: 'full', displayName: 'PHP' },

  // ── Tier 2: Pattern-based (regex) extraction ────────────────────────────────
  { extension: '.kt',   language: 'kotlin',      tier: 'pattern', displayName: 'Kotlin' },
  { extension: '.kts',  language: 'kotlin',      tier: 'pattern', displayName: 'Kotlin Script' },
  { extension: '.swift', language: 'swift',      tier: 'pattern', displayName: 'Swift' },
  { extension: '.scala', language: 'scala',      tier: 'pattern', displayName: 'Scala' },
  { extension: '.sc',   language: 'scala',       tier: 'pattern', displayName: 'Scala Script' },
  { extension: '.dart', language: 'dart',        tier: 'pattern', displayName: 'Dart' },
  { extension: '.r',    language: 'r',           tier: 'pattern', displayName: 'R' },
  { extension: '.R',    language: 'r',           tier: 'pattern', displayName: 'R' },
  { extension: '.lua',  language: 'lua',         tier: 'pattern', displayName: 'Lua' },
  { extension: '.sol',  language: 'solidity',    tier: 'pattern', displayName: 'Solidity' },
  { extension: '.ex',   language: 'elixir',      tier: 'pattern', displayName: 'Elixir' },
  { extension: '.exs',  language: 'elixir',      tier: 'pattern', displayName: 'Elixir Script' },
  { extension: '.erl',  language: 'erlang',      tier: 'pattern', displayName: 'Erlang' },
  { extension: '.hrl',  language: 'erlang',      tier: 'pattern', displayName: 'Erlang Header' },
  { extension: '.hs',   language: 'haskell',     tier: 'pattern', displayName: 'Haskell' },
  { extension: '.clj',  language: 'clojure',     tier: 'pattern', displayName: 'Clojure' },
  { extension: '.cljs', language: 'clojure',     tier: 'pattern', displayName: 'ClojureScript' },
  { extension: '.pl',   language: 'perl',        tier: 'pattern', displayName: 'Perl' },
  { extension: '.pm',   language: 'perl',        tier: 'pattern', displayName: 'Perl Module' },
  { extension: '.groovy', language: 'groovy',    tier: 'pattern', displayName: 'Groovy' },
  { extension: '.m',    language: 'objc',        tier: 'pattern', displayName: 'Objective-C' },
  { extension: '.mm',   language: 'objc',        tier: 'pattern', displayName: 'Objective-C++' },
  { extension: '.jl',   language: 'julia',       tier: 'pattern', displayName: 'Julia' },
  { extension: '.v',    language: 'vlang',       tier: 'pattern', displayName: 'V' },
  { extension: '.zig',  language: 'zig',         tier: 'pattern', displayName: 'Zig' },
  { extension: '.nim',  language: 'nim',         tier: 'pattern', displayName: 'Nim' },
  { extension: '.cr',   language: 'crystal',     tier: 'pattern', displayName: 'Crystal' },
  { extension: '.fs',   language: 'fsharp',      tier: 'pattern', displayName: 'F#' },
  { extension: '.fsx',  language: 'fsharp',      tier: 'pattern', displayName: 'F# Script' },
  { extension: '.ml',   language: 'ocaml',       tier: 'pattern', displayName: 'OCaml' },
  { extension: '.mli',  language: 'ocaml',       tier: 'pattern', displayName: 'OCaml Interface' },

  // ── Tier 3: Notebook extraction ─────────────────────────────────────────────
  { extension: '.ipynb', language: 'notebook',   tier: 'notebook', displayName: 'Jupyter Notebook' },
  { extension: '.dbc',  language: 'notebook',    tier: 'notebook', displayName: 'Databricks Notebook' },

  // ── Tier 4: Minimal (indexed + embedded, no symbols) ───────────────────────
  { extension: '.md',     language: 'markdown',   tier: 'minimal', displayName: 'Markdown' },
  { extension: '.mdx',    language: 'markdown',   tier: 'minimal', displayName: 'MDX' },
  { extension: '.yaml',   language: 'config',     tier: 'minimal', displayName: 'YAML' },
  { extension: '.yml',    language: 'config',     tier: 'minimal', displayName: 'YAML' },
  { extension: '.toml',   language: 'config',     tier: 'minimal', displayName: 'TOML' },
  { extension: '.json',   language: 'config',     tier: 'minimal', displayName: 'JSON' },
  { extension: '.jsonc',  language: 'config',     tier: 'minimal', displayName: 'JSONC' },
  { extension: '.xml',    language: 'config',     tier: 'minimal', displayName: 'XML' },
  { extension: '.proto',  language: 'config',     tier: 'minimal', displayName: 'Protobuf' },
  { extension: '.graphql', language: 'config',    tier: 'minimal', displayName: 'GraphQL' },
  { extension: '.gql',    language: 'config',     tier: 'minimal', displayName: 'GraphQL' },
  { extension: '.sql',    language: 'config',     tier: 'minimal', displayName: 'SQL' },
  { extension: '.sh',     language: 'config',     tier: 'minimal', displayName: 'Shell' },
  { extension: '.bash',   language: 'config',     tier: 'minimal', displayName: 'Bash' },
  { extension: '.zsh',    language: 'config',     tier: 'minimal', displayName: 'Zsh' },
  { extension: '.ps1',    language: 'config',     tier: 'minimal', displayName: 'PowerShell' },
  { extension: '.tf',     language: 'config',     tier: 'minimal', displayName: 'Terraform' },
  { extension: '.hcl',    language: 'config',     tier: 'minimal', displayName: 'HCL' },
  { extension: '.css',    language: 'config',     tier: 'minimal', displayName: 'CSS' },
  { extension: '.scss',   language: 'config',     tier: 'minimal', displayName: 'SCSS' },
  { extension: '.less',   language: 'config',     tier: 'minimal', displayName: 'LESS' },
  { extension: '.html',   language: 'config',     tier: 'minimal', displayName: 'HTML' },
  { extension: '.vue',    language: 'config',     tier: 'minimal', displayName: 'Vue' },
  { extension: '.svelte', language: 'config',     tier: 'minimal', displayName: 'Svelte' },
];

// ── Singleton instance ────────────────────────────────────────────────────────

class LanguageRegistry {
  private byExtension = new Map<string, LanguageConfig>();

  constructor() {
    for (const lang of ALL_LANGUAGES) {
      this.byExtension.set(lang.extension.toLowerCase(), lang);
    }
  }

  /**
   * Detect language config for a file extension.
   * Returns null if the extension is not supported.
   */
  detect(extension: string): LanguageConfig | null {
    return this.byExtension.get(extension.toLowerCase()) ?? null;
  }

  /**
   * Get the SupportedLanguage for an extension.
   * Returns 'unknown' if not registered.
   */
  getLanguage(extension: string): SupportedLanguage {
    return this.detect(extension)?.language ?? 'unknown';
  }

  /**
   * Get the extraction tier for an extension.
   */
  getTier(extension: string): ExtractionTier | null {
    return this.detect(extension)?.tier ?? null;
  }

  /**
   * Get all supported file extensions.
   */
  getSupportedExtensions(): string[] {
    return [...this.byExtension.keys()];
  }

  /**
   * Get all extensions for a specific tier.
   */
  getExtensionsByTier(tier: ExtractionTier): string[] {
    return ALL_LANGUAGES
      .filter((l) => l.tier === tier)
      .map((l) => l.extension);
  }

  /**
   * Get all registered language configs.
   */
  getAll(): LanguageConfig[] {
    return [...ALL_LANGUAGES];
  }

  /**
   * Check if an extension is supported.
   */
  isSupported(extension: string): boolean {
    return this.byExtension.has(extension.toLowerCase());
  }
}

// Export singleton
export const languageRegistry = new LanguageRegistry();
