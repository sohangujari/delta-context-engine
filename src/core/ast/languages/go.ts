export const GO_EXTENSIONS = ['.go'];

export function extractGoSymbols(
  filePath: string,
  root: import('tree-sitter').SyntaxNode,
  source: string
): import('../symbol-map.js').SymbolMap {
  const functions: import('../symbol-map.js').FunctionSymbol[] = [];
  const classes: import('../symbol-map.js').ClassSymbol[] = [];
  const imports: import('../symbol-map.js').ImportSymbol[] = [];
  const types: import('../symbol-map.js').TypeSymbol[] = [];

  function walk(node: import('tree-sitter').SyntaxNode): void {
    // Function declarations: func Name(params) returnType
    if (node.type === 'function_declaration') {
      const nameNode = node.childForFieldName('name');
      const paramsNode = node.childForFieldName('parameters');
      const resultNode = node.childForFieldName('result');

      if (nameNode) {
        functions.push({
          name: nameNode.text,
          params: paramsNode ? cleanText(paramsNode.text) : '()',
          returnType: resultNode ? cleanText(resultNode.text) : '',
          visibility: isExported(nameNode.text) ? 'public' : 'private',
          isAsync: false,
          lineNumber: node.startPosition.row + 1,
        });
      }
    }

    // Method declarations: func (receiver Type) Name(params) returnType
    if (node.type === 'method_declaration') {
      const nameNode = node.childForFieldName('name');
      const paramsNode = node.childForFieldName('parameters');
      const resultNode = node.childForFieldName('result');

      if (nameNode) {
        functions.push({
          name: nameNode.text,
          params: paramsNode ? cleanText(paramsNode.text) : '()',
          returnType: resultNode ? cleanText(resultNode.text) : '',
          visibility: isExported(nameNode.text) ? 'public' : 'private',
          isAsync: false,
          lineNumber: node.startPosition.row + 1,
        });
      }
    }

    // Struct types
    if (node.type === 'type_declaration') {
      const specNode = findChildOfType(node, 'type_spec');
      if (specNode) {
        const nameNode = specNode.childForFieldName('name');
        const typeNode = specNode.childForFieldName('type');
        if (nameNode) {
          const kind = typeNode?.type === 'struct_type' ? 'interface' : 'type';
          types.push({
            name: nameNode.text,
            kind,
            definition: `type ${nameNode.text}`,
            lineNumber: node.startPosition.row + 1,
          });
        }
      }
    }

    // Import declarations
    if (node.type === 'import_declaration') {
      const specs = findChildrenOfType(node, 'import_spec');
      for (const spec of specs) {
        const pathNode = spec.childForFieldName('path');
        if (pathNode) {
          const source = pathNode.text.replace(/['"]/g, '');
          imports.push({
            names: [],
            source,
            isDefault: false,
            isNamespace: false,
          });
        }
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
    language: 'go',
    exports: functions
      .filter((f) => f.visibility === 'public')
      .map((f) => ({
        name: f.name,
        kind: 'function' as const,
        signature: `func ${f.name}${f.params}`,
      })),
    imports,
    classes,
    functions,
    types,
    tokenCount: 0,
    rawTokenCount: 0,
  };
}

// Go exports start with uppercase
function isExported(name: string): boolean {
  return name.length > 0 && name[0] === name[0]?.toUpperCase() &&
    name[0] !== name[0]?.toLowerCase();
}

function cleanText(text: string): string {
  return text.replace(/\s+/g, ' ').trim();
}

function findChildOfType(
  node: import('tree-sitter').SyntaxNode,
  type: string
): import('tree-sitter').SyntaxNode | null {
  for (let i = 0; i < node.childCount; i++) {
    const child = node.child(i);
    if (child?.type === type) return child;
  }
  return null;
}

function findChildrenOfType(
  node: import('tree-sitter').SyntaxNode,
  type: string
): import('tree-sitter').SyntaxNode[] {
  const results: import('tree-sitter').SyntaxNode[] = [];
  for (let i = 0; i < node.childCount; i++) {
    const child = node.child(i);
    if (child?.type === type) results.push(child);
  }
  return results;
}