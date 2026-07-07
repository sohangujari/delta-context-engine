import path from 'path';
import fs from 'fs';
import { languageRegistry } from './language-registry.js';
import type { SupportedLanguage } from './symbol-map.js';

type TreeSitterLanguage = object;

// Dynamic imports for tree-sitter (native addon).
// These are optional — if tree-sitter fails to install (e.g., on Node 23),
// Delta falls back to regex-based pattern extraction (Tier 2).

let Parser: any = null;
let LANGUAGE_MAP: Partial<Record<SupportedLanguage, TreeSitterLanguage>> = {};
let treeSitterAvailable = false;

async function loadTreeSitter(): Promise<void> {
  try {
    const parserModule = await import('tree-sitter');
    Parser = parserModule.default;

    const [TSLang, PYLang, GOLang, RSLang, JALang] = await Promise.all([
      import('tree-sitter-typescript').then(m => m.default).catch(() => null),
      import('tree-sitter-python').then(m => m.default).catch(() => null),
      import('tree-sitter-go').then(m => m.default).catch(() => null),
      import('tree-sitter-rust').then(m => m.default).catch(() => null),
      import('tree-sitter-java').then(m => m.default).catch(() => null),
    ]);

    LANGUAGE_MAP = {
      ...(TSLang ? { typescript: (TSLang as any).typescript, javascript: (TSLang as any).typescript } : {}),
      ...(PYLang ? { python: PYLang as unknown as TreeSitterLanguage } : {}),
      ...(GOLang ? { go: GOLang as unknown as TreeSitterLanguage } : {}),
      ...(RSLang ? { rust: RSLang as unknown as TreeSitterLanguage } : {}),
      ...(JALang ? { java: JALang as unknown as TreeSitterLanguage } : {}),
    };

    treeSitterAvailable = true;
  } catch {
    // tree-sitter not available — will use regex fallback
    treeSitterAvailable = false;
  }
}

// Initialize on first import
const initPromise = loadTreeSitter();

/**
 * Ensure tree-sitter is loaded. Call before first parse.
 * Safe to call multiple times.
 */
export async function ensureTreeSitter(): Promise<boolean> {
  await initPromise;
  return treeSitterAvailable;
}

const parserCache = new Map<SupportedLanguage, any>();

function getParser(language: SupportedLanguage): any | null {
  if (!treeSitterAvailable || !Parser) return null;

  if (parserCache.has(language)) {
    return parserCache.get(language)!;
  }

  const grammar = LANGUAGE_MAP[language];
  if (!grammar) return null;

  try {
    const parser = new Parser();
    parser.setLanguage(grammar);
    parserCache.set(language, parser);
    return parser;
  } catch (err) {
    console.warn(`⚠ Could not initialize parser for ${language}:`, err);
    return null;
  }
}

export interface ParseResult {
  tree: any; // Parser.Tree when tree-sitter available
  language: SupportedLanguage;
  source: string;
}

export async function parseFile(filePath: string): Promise<ParseResult | null> {
  await initPromise;

  const ext = path.extname(filePath).toLowerCase();
  const language = languageRegistry.getLanguage(ext);

  // Only attempt tree-sitter parsing for languages with grammars
  if (language === 'unknown') return null;

  const parser = getParser(language);
  if (!parser) return null;

  try {
    const source = fs.readFileSync(filePath, 'utf-8');
    const tree = parser.parse(source);
    return { tree, language, source };
  } catch (err) {
    console.warn(`⚠ Parse failed for ${filePath}:`, err);
    return null;
  }
}

export function queryNode(
  node: any,
  queryString: string,
  language: TreeSitterLanguage
): any[] {
  try {
    const lang = language as { query: (s: string) => any };
    const query = lang.query(queryString);
    return query.matches(node);
  } catch {
    return [];
  }
}