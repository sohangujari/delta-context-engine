import type { SymbolMap } from '../ast/symbol-map.js';
import { formatSymbolMap } from '../ast/symbol-map.js';
import { generateSummary } from '../ast/summary-generator.js';
import { countTokens } from './token-counter.js';

/**
 * Compression levels from most to least verbose.
 * The assembler cascades through these when the budget is exceeded.
 */
export type CompressionLevel =
  | 'full'       // complete file content
  | 'symbols'    // AST symbol map only (signatures, no bodies)
  | 'summary'    // 1-line description
  | 'excluded';  // not included in payload

export interface CompressedFile {
  path: string;
  relativePath: string;
  compressionLevel: CompressionLevel;
  content: string;
  tokenCount: number;
}

export function compressToSymbols(
  filePath: string,
  relativePath: string,
  symbolMap: SymbolMap
): CompressedFile {
  const content = formatSymbolMap(symbolMap);
  return {
    path: filePath,
    relativePath,
    compressionLevel: 'symbols',
    content,
    tokenCount: countTokens(content),
  };
}

export function compressToSummary(
  filePath: string,
  relativePath: string,
  symbolMap: SymbolMap
): CompressedFile {
  const content = generateSummary(symbolMap);
  return {
    path: filePath,
    relativePath,
    compressionLevel: 'summary',
    content,
    tokenCount: countTokens(content),
  };
}

export function compressFull(
  filePath: string,
  relativePath: string,
  rawContent: string
): CompressedFile {
  return {
    path: filePath,
    relativePath,
    compressionLevel: 'full',
    content: rawContent,
    tokenCount: countTokens(rawContent),
  };
}

/**
 * Given a file currently at 'symbols' level, compress it further to 'summary'.
 * Used in the compression cascade when the budget is exceeded.
 */
export function downgrade(
  file: CompressedFile,
  symbolMap: SymbolMap
): CompressedFile {
  if (file.compressionLevel === 'full') {
    return compressToSymbols(file.path, file.relativePath, symbolMap);
  }
  if (file.compressionLevel === 'symbols') {
    return compressToSummary(file.path, file.relativePath, symbolMap);
  }
  // Already at summary or excluded — nothing to downgrade to
  return { ...file, compressionLevel: 'excluded', content: '', tokenCount: 0 };
}