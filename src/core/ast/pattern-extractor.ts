/**
 * Pattern Extractor — Regex-based symbol extraction for Tier 2 languages.
 *
 * These languages don't have tree-sitter grammars installed, so we use
 * regex patterns to extract functions, classes, imports, and types.
 * This gives ~80% accuracy vs full AST parsing.
 */

import type {
  SymbolMap,
  FunctionSymbol,
  ClassSymbol,
  ImportSymbol,
  ExportSymbol,
  TypeSymbol,
  SupportedLanguage,
} from './symbol-map.js';

// ── Language-specific patterns ────────────────────────────────────────────────

interface LanguagePatterns {
  /** Match function/method declarations. Groups: [name, params?] */
  functions: RegExp[];
  /** Match class/struct declarations. Groups: [name] */
  classes: RegExp[];
  /** Match import/require statements. Groups: [source] */
  imports: RegExp[];
  /** Match type/interface declarations. Groups: [name] */
  types: RegExp[];
}

const PATTERNS: Partial<Record<SupportedLanguage, LanguagePatterns>> = {
  kotlin: {
    functions: [
      /^\s*(?:(?:public|private|protected|internal|override)\s+)*fun\s+(?:<[^>]+>\s+)?(\w+)\s*(\([^)]*\))/gm,
    ],
    classes: [
      /^\s*(?:(?:data|sealed|abstract|open|inner|enum)\s+)*class\s+(\w+)/gm,
      /^\s*(?:(?:fun)\s+)?interface\s+(\w+)/gm,
      /^\s*object\s+(\w+)/gm,
    ],
    imports: [
      /^\s*import\s+([\w.]+(?:\.\*)?)/gm,
    ],
    types: [
      /^\s*typealias\s+(\w+)/gm,
    ],
  },
  swift: {
    functions: [
      /^\s*(?:(?:public|private|internal|fileprivate|open|override|static|class)\s+)*func\s+(\w+)\s*(\([^)]*\))/gm,
    ],
    classes: [
      /^\s*(?:(?:public|private|internal|fileprivate|open|final)\s+)*class\s+(\w+)/gm,
      /^\s*(?:(?:public|private|internal)\s+)*struct\s+(\w+)/gm,
      /^\s*(?:(?:public|private|internal)\s+)*enum\s+(\w+)/gm,
      /^\s*(?:(?:public|private|internal)\s+)*protocol\s+(\w+)/gm,
    ],
    imports: [
      /^\s*import\s+(\w+)/gm,
    ],
    types: [
      /^\s*typealias\s+(\w+)/gm,
    ],
  },
  scala: {
    functions: [
      /^\s*(?:(?:override|private|protected)\s+)*def\s+(\w+)\s*(\([^)]*\))?/gm,
    ],
    classes: [
      /^\s*(?:(?:abstract|sealed|final|case)\s+)*class\s+(\w+)/gm,
      /^\s*object\s+(\w+)/gm,
      /^\s*trait\s+(\w+)/gm,
    ],
    imports: [
      /^\s*import\s+([\w.]+(?:\.\{[^}]+\}|\.\*|\._)?)/gm,
    ],
    types: [
      /^\s*type\s+(\w+)/gm,
    ],
  },
  dart: {
    functions: [
      /^\s*(?:(?:static|async|external)\s+)*(?:\w+\s+)?(\w+)\s*(\([^)]*\))\s*(?:async\s*)?{/gm,
    ],
    classes: [
      /^\s*(?:abstract\s+)?class\s+(\w+)/gm,
      /^\s*(?:abstract\s+)?mixin\s+(\w+)/gm,
      /^\s*enum\s+(\w+)/gm,
    ],
    imports: [
      /^\s*import\s+['"]([^'"]+)['"]/gm,
    ],
    types: [
      /^\s*typedef\s+(\w+)/gm,
    ],
  },
  r: {
    functions: [
      /^\s*(\w+)\s*<-\s*function\s*(\([^)]*\))/gm,
      /^\s*(\w+)\s*=\s*function\s*(\([^)]*\))/gm,
    ],
    classes: [
      /^\s*setClass\s*\(\s*["'](\w+)["']/gm,
    ],
    imports: [
      /^\s*library\s*\(\s*["']?(\w+)["']?\s*\)/gm,
      /^\s*require\s*\(\s*["']?(\w+)["']?\s*\)/gm,
    ],
    types: [],
  },
  lua: {
    functions: [
      /^\s*(?:local\s+)?function\s+(?:[\w.]+[.:])?(\w+)\s*(\([^)]*\))/gm,
    ],
    classes: [],
    imports: [
      /^\s*(?:local\s+\w+\s*=\s*)?require\s*[\("]+([^"')]+)["')]+/gm,
    ],
    types: [],
  },
  solidity: {
    functions: [
      /^\s*function\s+(\w+)\s*(\([^)]*\))/gm,
    ],
    classes: [
      /^\s*contract\s+(\w+)/gm,
      /^\s*library\s+(\w+)/gm,
      /^\s*interface\s+(\w+)/gm,
    ],
    imports: [
      /^\s*import\s+["']([^"']+)["']/gm,
      /^\s*import\s+\{[^}]+\}\s+from\s+["']([^"']+)["']/gm,
    ],
    types: [
      /^\s*struct\s+(\w+)/gm,
      /^\s*enum\s+(\w+)/gm,
    ],
  },
  elixir: {
    functions: [
      /^\s*(?:def|defp)\s+(\w+)\s*(\([^)]*\))?/gm,
    ],
    classes: [
      /^\s*defmodule\s+([\w.]+)/gm,
    ],
    imports: [
      /^\s*(?:import|use|alias|require)\s+([\w.]+)/gm,
    ],
    types: [
      /^\s*@type\s+(\w+)/gm,
    ],
  },
  haskell: {
    functions: [
      /^(\w+)\s*::\s*(.+)$/gm,
    ],
    classes: [
      /^\s*(?:class|data|newtype)\s+(\w+)/gm,
    ],
    imports: [
      /^\s*import\s+(?:qualified\s+)?([\w.]+)/gm,
    ],
    types: [
      /^\s*type\s+(\w+)/gm,
    ],
  },
  clojure: {
    functions: [
      /\(\s*defn-?\s+(\S+)/gm,
    ],
    classes: [
      /\(\s*defrecord\s+(\S+)/gm,
      /\(\s*defprotocol\s+(\S+)/gm,
    ],
    imports: [
      /\(\s*:(?:require|import|use)\s+\[?\s*([\w.-]+)/gm,
    ],
    types: [],
  },
  perl: {
    functions: [
      /^\s*sub\s+(\w+)/gm,
    ],
    classes: [
      /^\s*package\s+([\w:]+)/gm,
    ],
    imports: [
      /^\s*use\s+([\w:]+)/gm,
      /^\s*require\s+([\w:]+)/gm,
    ],
    types: [],
  },
  groovy: {
    functions: [
      /^\s*(?:(?:public|private|protected|static)\s+)*(?:def\s+)?(\w+)\s*(\([^)]*\))/gm,
    ],
    classes: [
      /^\s*(?:(?:abstract|final)\s+)?class\s+(\w+)/gm,
      /^\s*interface\s+(\w+)/gm,
    ],
    imports: [
      /^\s*import\s+([\w.]+)/gm,
    ],
    types: [],
  },
  julia: {
    functions: [
      /^\s*function\s+(\w+)\s*(\([^)]*\))?/gm,
      /^\s*(\w+)\s*(\([^)]*\))\s*=/gm,
    ],
    classes: [
      /^\s*(?:(?:abstract|mutable)\s+)?(?:type|struct)\s+(\w+)/gm,
    ],
    imports: [
      /^\s*(?:using|import)\s+([\w.,\s]+)/gm,
    ],
    types: [],
  },
  fsharp: {
    functions: [
      /^\s*let\s+(?:inline\s+)?(\w+)\s*/gm,
    ],
    classes: [
      /^\s*type\s+(\w+)/gm,
      /^\s*module\s+(\w+)/gm,
    ],
    imports: [
      /^\s*open\s+([\w.]+)/gm,
    ],
    types: [],
  },
  ocaml: {
    functions: [
      /^\s*let\s+(?:rec\s+)?(\w+)/gm,
    ],
    classes: [
      /^\s*module\s+(\w+)/gm,
    ],
    imports: [
      /^\s*open\s+([\w.]+)/gm,
    ],
    types: [
      /^\s*type\s+(\w+)/gm,
    ],
  },
};

// ── Default fallback patterns ─────────────────────────────────────────────────

const DEFAULT_PATTERNS: LanguagePatterns = {
  functions: [
    // Common function patterns across many languages
    /^\s*(?:(?:public|private|protected|static|export|async)\s+)*(?:function|func|def|fn|sub|proc)\s+(\w+)\s*(\([^)]*\))?/gm,
  ],
  classes: [
    /^\s*(?:(?:public|private|abstract|final|sealed)\s+)*(?:class|struct|interface|module|protocol|trait|enum)\s+(\w+)/gm,
  ],
  imports: [
    /^\s*(?:import|require|use|include|from)\s+['"]?([^\s'";\n]+)['"]?/gm,
  ],
  types: [
    /^\s*(?:type|typedef|typealias|newtype)\s+(\w+)/gm,
  ],
};

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * Extract symbols from source code using regex patterns.
 * Returns a SymbolMap compatible with the full AST extraction pipeline.
 */
export function extractWithPatterns(
  filePath: string,
  source: string,
  language: SupportedLanguage
): SymbolMap {
  const patterns = PATTERNS[language] ?? DEFAULT_PATTERNS;

  const functions = extractFunctions(source, patterns);
  const classes = extractClasses(source, patterns);
  const imports = extractImports(source, patterns);
  const types = extractTypes(source, patterns);

  const exports: ExportSymbol[] = functions
    .filter((f) => f.visibility === 'public')
    .map((f) => ({
      name: f.name,
      kind: 'function' as const,
      signature: `${f.name}${f.params}`,
    }));

  return {
    filePath,
    language,
    exports,
    imports,
    classes,
    functions,
    types,
    tokenCount: 0,    // calculated by caller
    rawTokenCount: 0,  // calculated by caller
  };
}

// ── Private extraction helpers ────────────────────────────────────────────────

function extractFunctions(source: string, patterns: LanguagePatterns): FunctionSymbol[] {
  const functions: FunctionSymbol[] = [];
  const seen = new Set<string>();

  for (const pattern of patterns.functions) {
    // Reset regex state
    const regex = new RegExp(pattern.source, pattern.flags);
    let match: RegExpExecArray | null;

    while ((match = regex.exec(source)) !== null) {
      const name = match[1];
      if (!name || seen.has(name)) continue;
      seen.add(name);

      const params = match[2] ?? '()';
      const lineNumber = source.slice(0, match.index).split('\n').length;

      functions.push({
        name,
        params: cleanText(params),
        returnType: '',
        visibility: 'public',
        isAsync: false,
        lineNumber,
      });
    }
  }

  return functions;
}

function extractClasses(source: string, patterns: LanguagePatterns): ClassSymbol[] {
  const classes: ClassSymbol[] = [];
  const seen = new Set<string>();

  for (const pattern of patterns.classes) {
    const regex = new RegExp(pattern.source, pattern.flags);
    let match: RegExpExecArray | null;

    while ((match = regex.exec(source)) !== null) {
      const name = match[1];
      if (!name || seen.has(name)) continue;
      seen.add(name);

      const lineNumber = source.slice(0, match.index).split('\n').length;

      classes.push({
        name,
        methods: [],
        properties: [],
        lineNumber,
      });
    }
  }

  return classes;
}

function extractImports(source: string, patterns: LanguagePatterns): ImportSymbol[] {
  const imports: ImportSymbol[] = [];

  for (const pattern of patterns.imports) {
    const regex = new RegExp(pattern.source, pattern.flags);
    let match: RegExpExecArray | null;

    while ((match = regex.exec(source)) !== null) {
      const importSource = match[1];
      if (!importSource) continue;

      imports.push({
        names: [],
        source: importSource.trim(),
        isDefault: false,
        isNamespace: false,
      });
    }
  }

  return imports;
}

function extractTypes(source: string, patterns: LanguagePatterns): TypeSymbol[] {
  const types: TypeSymbol[] = [];
  const seen = new Set<string>();

  for (const pattern of patterns.types) {
    const regex = new RegExp(pattern.source, pattern.flags);
    let match: RegExpExecArray | null;

    while ((match = regex.exec(source)) !== null) {
      const name = match[1];
      if (!name || seen.has(name)) continue;
      seen.add(name);

      const lineNumber = source.slice(0, match.index).split('\n').length;

      types.push({
        name,
        kind: 'type',
        definition: `type ${name}`,
        lineNumber,
      });
    }
  }

  return types;
}

function cleanText(text: string): string {
  return text.replace(/\s+/g, ' ').trim();
}
