import Parser from 'tree-sitter';
import TSLanguage from 'tree-sitter-typescript';
import PYLanguage from 'tree-sitter-python';
import GOLanguage from 'tree-sitter-go';
import RSLanguage from 'tree-sitter-rust';
import JALanguage from 'tree-sitter-java';
import path from 'path';
import fs from 'fs';
import { getLanguageForExtension } from './languages/typescript.js';
import type { SupportedLanguage } from './symbol-map.js';

type TreeSitterLanguage = object;

const LANGUAGE_MAP: Partial<Record<SupportedLanguage, TreeSitterLanguage>> = {
  typescript: TSLanguage.typescript,
  javascript: TSLanguage.typescript,
  python:     PYLanguage as unknown as TreeSitterLanguage,
  go:         GOLanguage as unknown as TreeSitterLanguage,
  rust:       RSLanguage as unknown as TreeSitterLanguage,
  java:       JALanguage as unknown as TreeSitterLanguage,
};

const parserCache = new Map<SupportedLanguage, Parser>();

function getParser(language: SupportedLanguage): Parser | null {
  if (parserCache.has(language)) {
    return parserCache.get(language)!;
  }

  const grammar = LANGUAGE_MAP[language];
  if (!grammar) return null;

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