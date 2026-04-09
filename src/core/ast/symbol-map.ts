// Core data types — used by every layer of the pipeline

export interface FunctionSymbol {
  name: string;
  params: string;
  returnType: string;
  visibility: 'public' | 'private' | 'protected';
  isAsync: boolean;
  lineNumber: number;
}

export interface ClassSymbol {
  name: string;
  methods: FunctionSymbol[];
  properties: string[];
  extends?: string;
  implements?: string[];
  lineNumber: number;
}

export interface ImportSymbol {
  names: string[];        // what is imported: ['useState', 'useEffect']
  source: string;         // raw import path: '../utils/auth'
  resolvedPath?: string;  // absolute path after resolution
  isDefault: boolean;
  isNamespace: boolean;   // import * as X
}

export interface ExportSymbol {
  name: string;
  kind: 'function' | 'class' | 'const' | 'type' | 'interface' | 'enum' | 'default';
  signature?: string;
}

export interface TypeSymbol {
  name: string;
  kind: 'interface' | 'type' | 'enum';
  definition: string;
  lineNumber: number;
}

export interface SymbolMap {
  filePath: string;
  language: SupportedLanguage;
  exports: ExportSymbol[];
  imports: ImportSymbol[];
  classes: ClassSymbol[];
  functions: FunctionSymbol[];
  types: TypeSymbol[];
  tokenCount: number;
  rawTokenCount: number;
}

export type SupportedLanguage =
  | 'typescript'
  | 'javascript'
  | 'python'
  | 'go'
  | 'rust'
  | 'java'
  | 'unknown';

export function formatSymbolMap(symbolMap: SymbolMap): string {
  const lines: string[] = [];

  lines.push(`FILE: ${symbolMap.filePath}`);

  if (symbolMap.exports.length > 0) {
    lines.push('exports:');
    for (const exp of symbolMap.exports) {
      if (exp.signature) {
        lines.push(`  ${exp.signature}`);
      } else {
        lines.push(`  ${exp.kind} ${exp.name}`);
      }
    }
  }

  if (symbolMap.imports.length > 0) {
    lines.push('imports:');
    for (const imp of symbolMap.imports) {
      const names = imp.isNamespace
        ? ['* (namespace)']
        : imp.isDefault
        ? ['default']
        : imp.names;
      const resolved = imp.resolvedPath ?? imp.source;
      lines.push(`  ${names.join(', ')} ← ${resolved}`);
    }
  }

  if (symbolMap.types.length > 0) {
    lines.push('types:');
    for (const t of symbolMap.types) {
      lines.push(`  ${t.kind} ${t.name}`);
    }
  }

  return lines.join('\n');
}