import Parser from 'tree-sitter';
import TSLanguage from 'tree-sitter-typescript';
import PYLanguage from 'tree-sitter-python';
import path from 'path';
import fs from 'fs';
import { getLanguageForExtension } from './languages/typescript.js';
import type { SupportedLanguage } from './symbol-map.js';

// Use the actual grammar objects directly — static imports resolve correctly
// Dynamic await import() returns a different module shape at runtime
type TreeSitterLanguage = object;

const LANGUAGE_MAP: Partial<Record<SupportedLanguage, TreeSitterLanguage>> = {
  typescript: TSLanguage.typescript,
  javascript: TSLanguage.typescript, // TS grammar handles JS too
  python: PYLanguage as unknown as TreeSitterLanguage,
};

// Parser instance cache — one per language
const parserCache = new Map<SupportedLanguage, Parser>();

function getParser(language: SupportedLanguage): Parser | null {
  if (parserCache.has(language)) {
    return parserCache.get(language)!;
  }

  const grammar = LANGUAGE_MAP[language];
  if (!grammar) {
    return null;
  }

  try {
    const parser = new Parser();
    parser.setLanguage(grammar as Parameters<typeof parser.setLanguage>[0]);
    parserCache.set(language, parser);
    return parser;
  } catch (err) {
    console.warn(`⚠ Could not initialize parser for ${language}:`, err);
    return null;
  }
}

export interface ParseResult {
  tree: Parser.Tree;
  language: SupportedLanguage;
  source: string;
}

export async function parseFile(filePath: string): Promise<ParseResult | null> {
  const ext = path.extname(filePath).toLowerCase();
  const language = getLanguageForExtension(ext);

  if (language === 'unknown') {
    return null;
  }

  const parser = getParser(language);
  if (!parser) {
    return null;
  }

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
  node: Parser.SyntaxNode,
  queryString: string,
  language: TreeSitterLanguage
): Parser.QueryMatch[] {
  try {
    const lang = language as { query: (s: string) => Parser.Query };
    const query = lang.query(queryString);
    return query.matches(node);
  } catch {
    return [];
  }
}