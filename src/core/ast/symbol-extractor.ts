import path from 'path';
import { parseFile, queryNode } from './parser.js';
import {
  TS_FUNCTION_QUERY,
  TS_CLASS_QUERY,
  TS_IMPORT_QUERY,
  TS_TYPE_QUERY,
} from './languages/typescript.js';
import { PY_FUNCTION_QUERY, PY_CLASS_QUERY, PY_IMPORT_QUERY } from './languages/python.js';
import type {
  SymbolMap,
  FunctionSymbol,
  ClassSymbol,
  ImportSymbol,
  ExportSymbol,
  TypeSymbol,
  SupportedLanguage,
} from './symbol-map.js';
import { countTokens } from '../assembler/token-counter.js';
import { formatSymbolMap } from './symbol-map.js';
import Parser from 'tree-sitter';

export async function extractSymbols(filePath: string): Promise<SymbolMap | null> {
  const parseResult = await parseFile(filePath);

  if (!parseResult) {
    return null;
  }

  const { tree, language, source } = parseResult;
  const root = tree.rootNode;

  let symbolMap: SymbolMap;

  switch (language) {
    case 'typescript':
    case 'javascript':
      symbolMap = extractTypeScriptSymbols(filePath, root, source, language);
      break;
    case 'python':
      symbolMap = extractPythonSymbols(filePath, root, source);
      break;
    default:
      return null;
  }

  // Calculate token costs
  const formattedSymbols = formatSymbolMap(symbolMap);
  symbolMap.tokenCount = countTokens(formattedSymbols);
  symbolMap.rawTokenCount = countTokens(source);

  return symbolMap;
}

// ─── TypeScript / JavaScript ──────────────────────────────────────────────────

function extractTypeScriptSymbols(
  filePath: string,
  root: Parser.SyntaxNode,
  source: string,
  language: SupportedLanguage
): SymbolMap {
  const imports = extractTsImports(root, source);
  const functions = extractTsFunctions(root, source);
  const classes = extractTsClasses(root, source);
  const types = extractTsTypes(root, source);
  const exports = buildExports(functions, classes, types, root, source);

  return {
    filePath,
    language,
    exports,
    imports,
    classes,
    functions,
    types,
    tokenCount: 0,    // calculated after
    rawTokenCount: 0, // calculated after
  };
}

function extractTsImports(
  root: Parser.SyntaxNode,
  _source: string
): ImportSymbol[] {
  const imports: ImportSymbol[] = [];

  // Walk the AST looking for import_statement nodes
  function walk(node: Parser.SyntaxNode): void {
    if (node.type === 'import_statement') {
      const sourceNode = node.childForFieldName('source');
      if (!sourceNode) return;

      // Strip quotes from source string
      const rawSource = sourceNode.text.replace(/['"]/g, '');

      const clauseNode = node.childForFieldName('import_clause');
      let names: string[] = [];
      let isDefault = false;
      let isNamespace = false;

      if (clauseNode) {
        const text = clauseNode.text;

        if (text.includes('* as')) {
          isNamespace = true;
        } else if (text.includes('{')) {
          // Named imports: { foo, bar as baz }
          const match = text.match(/\{([^}]+)\}/);
          if (match?.[1]) {
            names = match[1]
              .split(',')
              .map((n) => n.trim().split(' as ')[0]?.trim() ?? '')
              .filter(Boolean);
          }
        } else {
          // Default import
          isDefault = true;
          names = [text.trim()];
        }
      }

      imports.push({
        names,
        source: rawSource,
        isDefault,
        isNamespace,
      });
    }

    for (let i = 0; i < node.childCount; i++) {
      const child = node.child(i);
      if (child) walk(child);
    }
  }

  walk(root);
  return imports;
}

function extractTsFunctions(
  root: Parser.SyntaxNode,
  source: string
): FunctionSymbol[] {
  const functions: FunctionSymbol[] = [];
  const seen = new Set<string>();

  function walk(node: Parser.SyntaxNode, insideExport = false): void {
    const type = node.type;

    if (
      type === 'function_declaration' ||
      type === 'function'
    ) {
      const nameNode = node.childForFieldName('name');
      const paramsNode = node.childForFieldName('parameters');
      const returnTypeNode = node.childForFieldName('return_type');

      if (nameNode && !seen.has(nameNode.text)) {
        seen.add(nameNode.text);
        functions.push({
          name: nameNode.text,
          params: paramsNode ? cleanText(paramsNode.text) : '()',
          returnType: returnTypeNode
            ? cleanText(returnTypeNode.text.replace(/^:\s*/, ''))
            : 'void',
          visibility: insideExport ? 'public' : 'private',
          isAsync: nodeHasChild(node, 'async'),
          lineNumber: node.startPosition.row + 1,
        });
      }
    }

    if (type === 'variable_declarator') {
      const nameNode = node.childForFieldName('name');
      const valueNode = node.childForFieldName('value');

      if (
        nameNode &&
        valueNode &&
        (valueNode.type === 'arrow_function' || valueNode.type === 'function')
      ) {
        if (!seen.has(nameNode.text)) {
          seen.add(nameNode.text);
          const paramsNode = valueNode.childForFieldName('parameters');
          const returnTypeNode = valueNode.childForFieldName('return_type');

          functions.push({
            name: nameNode.text,
            params: paramsNode ? cleanText(paramsNode.text) : '()',
            returnType: returnTypeNode
              ? cleanText(returnTypeNode.text.replace(/^:\s*/, ''))
              : 'unknown',
            visibility: insideExport ? 'public' : 'private',
            isAsync: nodeHasChild(valueNode, 'async'),
            lineNumber: node.startPosition.row + 1,
          });
        }
      }
    }

    const isExport = type === 'export_statement';

    for (let i = 0; i < node.childCount; i++) {
      const child = node.child(i);
      if (child) walk(child, isExport || insideExport);
    }
  }

  walk(root);
  return functions;
}

function extractTsClasses(
  root: Parser.SyntaxNode,
  _source: string
): ClassSymbol[] {
  const classes: ClassSymbol[] = [];

  function walk(node: Parser.SyntaxNode): void {
    if (node.type === 'class_declaration') {
      const nameNode = node.childForFieldName('name');
      if (!nameNode) return;

      const methods: FunctionSymbol[] = [];
      const body = node.childForFieldName('body');
      if (body) {
        for (let i = 0; i < body.childCount; i++) {
          const child = body.child(i);
          if (!child) continue;
          if (child.type === 'method_definition') {
            const methodName = child.childForFieldName('name');
            const methodParams = child.childForFieldName('parameters');
            const returnType = child.childForFieldName('return_type');
            if (methodName) {
              methods.push({
                name: methodName.text,
                params: methodParams ? cleanText(methodParams.text) : '()',
                returnType: returnType
                  ? cleanText(returnType.text.replace(/^:\s*/, ''))
                  : 'void',
                visibility: getMethodVisibility(child),
                isAsync: nodeHasChild(child, 'async'),
                lineNumber: child.startPosition.row + 1,
              });
            }
          }
        }
      }

      const extendsClause = findChildOfType(node, 'class_heritage');
      const extendsText = extendsClause?.text;

      const classSymbol: ClassSymbol = {
        name: nameNode.text,
        methods,
        properties: [],
        lineNumber: node.startPosition.row + 1,
      };

      if (extendsText) {
        classSymbol.extends = extendsText;
      }

      classes.push(classSymbol);
    }

    for (let i = 0; i < node.childCount; i++) {
      const child = node.child(i);
      if (child) walk(child);
    }
  }

  walk(root);
  return classes;
}

function extractTsTypes(
  root: Parser.SyntaxNode,
  _source: string
): TypeSymbol[] {
  const types: TypeSymbol[] = [];
  const seen = new Set<string>();

  function walk(node: Parser.SyntaxNode): void {
    if (
      node.type === 'interface_declaration' ||
      node.type === 'type_alias_declaration' ||
      node.type === 'enum_declaration'
    ) {
      const nameNode = node.childForFieldName('name');
      if (nameNode && !seen.has(nameNode.text)) {
        seen.add(nameNode.text);
        const kind =
          node.type === 'interface_declaration'
            ? 'interface'
            : node.type === 'enum_declaration'
            ? 'enum'
            : 'type';

        types.push({
          name: nameNode.text,
          kind,
          definition: `${kind} ${nameNode.text}`,
          lineNumber: node.startPosition.row + 1,
        });
      }
    }

    for (let i = 0; i < node.childCount; i++) {
      const child = node.child(i);
      if (child) walk(child);
    }
  }

  walk(root);
  return types;
}

function buildExports(
  functions: FunctionSymbol[],
  classes: ClassSymbol[],
  types: TypeSymbol[],
  root: Parser.SyntaxNode,
  _source: string
): ExportSymbol[] {
  const exports: ExportSymbol[] = [];

  // Collect exported names by walking export_statement nodes
  const exportedNames = new Set<string>();

  function walk(node: Parser.SyntaxNode): void {
    if (node.type === 'export_statement') {
      // export { foo, bar }
      const exportClause = findChildOfType(node, 'export_clause');
      if (exportClause) {
        for (let i = 0; i < exportClause.childCount; i++) {
          const child = exportClause.child(i);
          if (child?.type === 'export_specifier') {
            const name = child.childForFieldName('name');
            if (name) exportedNames.add(name.text);
          }
        }
      }

      // export function foo / export class Foo / export const foo
      const decl = node.childForFieldName('declaration');
      if (decl) {
        const nameNode =
          decl.childForFieldName('name') ??
          findChildOfType(decl, 'identifier') ??
          findChildOfType(decl, 'type_identifier');
        if (nameNode) exportedNames.add(nameNode.text);

        // export const foo = ...
        if (decl.type === 'lexical_declaration') {
          for (let i = 0; i < decl.childCount; i++) {
            const child = decl.child(i);
            if (child?.type === 'variable_declarator') {
              const vName = child.childForFieldName('name');
              if (vName) exportedNames.add(vName.text);
            }
          }
        }
      }
    }

    for (let i = 0; i < node.childCount; i++) {
      const child = node.child(i);
      if (child) walk(child);
    }
  }

  walk(root);

  // Match exported names to extracted symbols
  for (const fn of functions) {
    if (fn.visibility === 'public' || exportedNames.has(fn.name)) {
      const asyncPrefix = fn.isAsync ? 'async ' : '';
      exports.push({
        name: fn.name,
        kind: 'function',
        signature: `${asyncPrefix}${fn.name}${fn.params}: ${fn.returnType}`,
      });
    }
  }

  for (const cls of classes) {
    if (exportedNames.has(cls.name)) {
      exports.push({ name: cls.name, kind: 'class' });
    }
  }

  for (const type of types) {
    if (exportedNames.has(type.name)) {
      exports.push({
        name: type.name,
        kind: type.kind === 'interface' ? 'interface' : type.kind === 'enum' ? 'type' : 'type',
        signature: type.definition,
      });
    }
  }

  return exports;
}

// ─── Python ───────────────────────────────────────────────────────────────────

function extractPythonSymbols(
  filePath: string,
  root: Parser.SyntaxNode,
  _source: string
): SymbolMap {
  const functions: FunctionSymbol[] = [];
  const classes: ClassSymbol[] = [];
  const imports: ImportSymbol[] = [];

  function walk(node: Parser.SyntaxNode): void {
    if (node.type === 'function_definition') {
      const nameNode = node.childForFieldName('name');
      const paramsNode = node.childForFieldName('parameters');
      const returnTypeNode = node.childForFieldName('return_type');

      if (nameNode) {
        functions.push({
          name: nameNode.text,
          params: paramsNode ? cleanText(paramsNode.text) : '()',
          returnType: returnTypeNode ? cleanText(returnTypeNode.text) : 'None',
          visibility: nameNode.text.startsWith('_') ? 'private' : 'public',
          isAsync: nodeHasChild(node, 'async'),
          lineNumber: node.startPosition.row + 1,
        });
      }
    }

    if (node.type === 'class_definition') {
      const nameNode = node.childForFieldName('name');
      if (nameNode) {
        classes.push({
          name: nameNode.text,
          methods: [],
          properties: [],
          lineNumber: node.startPosition.row + 1,
        });
      }
    }

    if (node.type === 'import_statement' || node.type === 'import_from_statement') {
      const sourceNode =
        node.childForFieldName('name') ??
        node.childForFieldName('module_name');

      if (sourceNode) {
        imports.push({
          names: [],
          source: sourceNode.text,
          isDefault: false,
          isNamespace: false,
        });
      }
    }

    for (let i = 0; i < node.childCount; i++) {
      const child = node.child(i);
      if (child) walk(child);
    }
  }

  walk(root);

  return {
    filePath,
    language: 'python',
    exports: functions
      .filter((f) => f.visibility === 'public')
      .map((f) => ({
        name: f.name,
        kind: 'function' as const,
        signature: `def ${f.name}${f.params}`,
      })),
    imports,
    classes,
    functions,
    types: [],
    tokenCount: 0,
    rawTokenCount: 0,
  };
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function cleanText(text: string): string {
  return text.replace(/\s+/g, ' ').trim();
}

function nodeHasChild(node: Parser.SyntaxNode, type: string): boolean {
  for (let i = 0; i < node.childCount; i++) {
    if (node.child(i)?.type === type) return true;
  }
  return false;
}

function findChildOfType(
  node: Parser.SyntaxNode,
  type: string
): Parser.SyntaxNode | null {
  for (let i = 0; i < node.childCount; i++) {
    const child = node.child(i);
    if (child?.type === type) return child;
  }
  return null;
}

function getMethodVisibility(
  node: Parser.SyntaxNode
): 'public' | 'private' | 'protected' {
  for (let i = 0; i < node.childCount; i++) {
    const child = node.child(i);
    if (child?.type === 'accessibility_modifier') {
      const text = child.text;
      if (text === 'private') return 'private';
      if (text === 'protected') return 'protected';
    }
  }
  return 'public';
}