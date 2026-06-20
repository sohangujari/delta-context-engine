/**
 * Notebook Extractor — Parses .ipynb and .dbc notebook files.
 *
 * Extracts code cells + markdown headings, strips magic commands,
 * and returns a SymbolMap for pipeline compatibility.
 */

import fs from 'fs';
import type {
  SymbolMap,
  FunctionSymbol,
  ImportSymbol,
} from './symbol-map.js';

// ── Types ─────────────────────────────────────────────────────────────────────

interface JupyterNotebook {
  cells: JupyterCell[];
  metadata?: {
    kernelspec?: {
      language?: string;
    };
    language_info?: {
      name?: string;
    };
  };
}

interface JupyterCell {
  cell_type: 'code' | 'markdown' | 'raw';
  source: string | string[];
  metadata?: Record<string, unknown>;
}

// ── Magic command patterns to strip ───────────────────────────────────────────

const MAGIC_PATTERNS = [
  /^%\w+/,            // IPython line magics: %time, %matplotlib
  /^%%\w+/,           // IPython cell magics: %%sql, %%bash
  /^!\s*/,            // Shell commands: !pip install
  /^#\s*MAGIC\b/,     // Databricks magic: # MAGIC
  /^#\s*COMMAND\b/,   // Databricks command delimiter
  /^%run\b/,          // Databricks %run
  /^%sql\b/,          // Databricks %sql
  /^%python\b/,       // Databricks %python
  /^%scala\b/,        // Databricks %scala
  /^%r\b/,            // Databricks %r
  /^%sh\b/,           // Databricks %sh
  /^%md\b/,           // Databricks %md
];

function isMagicLine(line: string): boolean {
  const trimmed = line.trim();
  return MAGIC_PATTERNS.some((p) => p.test(trimmed));
}

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * Extract symbols from a Jupyter notebook (.ipynb) file.
 */
export function extractNotebookSymbols(filePath: string): SymbolMap | null {
  try {
    const raw = fs.readFileSync(filePath, 'utf-8');
    const notebook = JSON.parse(raw) as JupyterNotebook;

    if (!notebook.cells || !Array.isArray(notebook.cells)) {
      return null;
    }

    // Detect language from metadata
    const language =
      notebook.metadata?.kernelspec?.language ??
      notebook.metadata?.language_info?.name ??
      'python';

    // Collect code from all code cells
    const codeLines: string[] = [];
    const markdownHeadings: string[] = [];

    for (const cell of notebook.cells) {
      const source = Array.isArray(cell.source)
        ? cell.source.join('')
        : cell.source;

      if (cell.cell_type === 'code') {
        // Strip magic commands
        const lines = source.split('\n');
        const cleanLines = lines.filter((l) => !isMagicLine(l));
        codeLines.push(...cleanLines);
      } else if (cell.cell_type === 'markdown') {
        // Extract headings for context
        const headings = source
          .split('\n')
          .filter((l) => l.startsWith('#'))
          .map((l) => l.replace(/^#+\s*/, '').trim());
        markdownHeadings.push(...headings);
      }
    }

    const fullCode = codeLines.join('\n');

    // Extract symbols from the collected code
    const functions = extractCodeFunctions(fullCode, language);
    const imports = extractCodeImports(fullCode, language);

    return {
      filePath,
      language: 'notebook',
      exports: functions.map((f) => ({
        name: f.name,
        kind: 'function' as const,
        signature: `${f.name}${f.params}`,
      })),
      imports,
      classes: [],
      functions,
      types: [],
      tokenCount: 0,
      rawTokenCount: 0,
    };
  } catch {
    // Invalid JSON or structure
    return null;
  }
}

/**
 * Extract symbols from a Databricks .dbc file.
 * .dbc files are essentially ZIP archives containing notebooks.
 * For simplicity, we treat them as single-cell text files.
 */
export function extractDatabricksSymbols(filePath: string): SymbolMap | null {
  try {
    const raw = fs.readFileSync(filePath, 'utf-8');

    // Databricks source files may just be plain text with magic commands
    const lines = raw.split('\n');
    const cleanLines = lines.filter((l) => !isMagicLine(l));
    const fullCode = cleanLines.join('\n');

    const functions = extractCodeFunctions(fullCode, 'python');
    const imports = extractCodeImports(fullCode, 'python');

    return {
      filePath,
      language: 'notebook',
      exports: functions.map((f) => ({
        name: f.name,
        kind: 'function' as const,
        signature: `${f.name}${f.params}`,
      })),
      imports,
      classes: [],
      functions,
      types: [],
      tokenCount: 0,
      rawTokenCount: 0,
    };
  } catch {
    return null;
  }
}

// ── Code extraction helpers ───────────────────────────────────────────────────

function extractCodeFunctions(code: string, language: string): FunctionSymbol[] {
  const functions: FunctionSymbol[] = [];
  const seen = new Set<string>();

  // Python-style functions (most common in notebooks)
  const pyPattern = /^\s*(?:async\s+)?def\s+(\w+)\s*(\([^)]*\))/gm;
  let match: RegExpExecArray | null;

  while ((match = pyPattern.exec(code)) !== null) {
    const name = match[1];
    if (!name || seen.has(name)) continue;
    seen.add(name);

    functions.push({
      name,
      params: (match[2] ?? '()').replace(/\s+/g, ' ').trim(),
      returnType: '',
      visibility: name.startsWith('_') ? 'private' : 'public',
      isAsync: match[0]?.includes('async') ?? false,
      lineNumber: code.slice(0, match.index).split('\n').length,
    });
  }

  // R-style function assignments (for R notebooks)
  if (language === 'r' || language === 'R') {
    const rPattern = /^\s*(\w+)\s*<-\s*function\s*(\([^)]*\))/gm;
    while ((match = rPattern.exec(code)) !== null) {
      const name = match[1];
      if (!name || seen.has(name)) continue;
      seen.add(name);

      functions.push({
        name,
        params: (match[2] ?? '()').replace(/\s+/g, ' ').trim(),
        returnType: '',
        visibility: 'public',
        isAsync: false,
        lineNumber: code.slice(0, match.index).split('\n').length,
      });
    }
  }

  // Scala-style def (for Databricks Scala notebooks)
  if (language === 'scala') {
    const scalaPattern = /^\s*def\s+(\w+)\s*(\([^)]*\))?/gm;
    while ((match = scalaPattern.exec(code)) !== null) {
      const name = match[1];
      if (!name || seen.has(name)) continue;
      seen.add(name);

      functions.push({
        name,
        params: (match[2] ?? '()').replace(/\s+/g, ' ').trim(),
        returnType: '',
        visibility: 'public',
        isAsync: false,
        lineNumber: code.slice(0, match.index).split('\n').length,
      });
    }
  }

  return functions;
}

function extractCodeImports(code: string, language: string): ImportSymbol[] {
  const imports: ImportSymbol[] = [];

  // Python imports
  const pyImportPattern = /^\s*(?:from\s+([\w.]+)\s+)?import\s+([\w.,\s*]+)/gm;
  let match: RegExpExecArray | null;

  while ((match = pyImportPattern.exec(code)) !== null) {
    const source = match[1] ?? match[2]?.split(',')[0]?.trim() ?? '';
    if (!source) continue;

    imports.push({
      names: [],
      source: source.trim(),
      isDefault: false,
      isNamespace: match[0]?.includes('import *') ?? false,
    });
  }

  return imports;
}
