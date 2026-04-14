export const RUST_EXTENSIONS = ['.rs'];

export function extractRustSymbols(
  filePath: string,
  root: import('tree-sitter').SyntaxNode,
  source: string
): import('../symbol-map.js').SymbolMap {
  const functions: import('../symbol-map.js').FunctionSymbol[] = [];
  const classes: import('../symbol-map.js').ClassSymbol[] = [];
  const imports: import('../symbol-map.js').ImportSymbol[] = [];
  const types: import('../symbol-map.js').TypeSymbol[] = [];

  function walk(node: import('tree-sitter').SyntaxNode, isPublic = false): void {
    // Function items: fn name(params) -> return_type
    if (node.type === 'function_item') {
      const nameNode = node.childForFieldName('name');
      const paramsNode = node.childForFieldName('parameters');
      const returnTypeNode = node.childForFieldName('return_type');
      const visibility = hasVisibilityPub(node);

      if (nameNode) {
        functions.push({
          name: nameNode.text,
          params: paramsNode ? cleanText(paramsNode.text) : '()',
          returnType: returnTypeNode
            ? cleanText(returnTypeNode.text.replace(/^->\s*/, ''))
            : '()',
          visibility: visibility ? 'public' : 'private',
          isAsync: hasChildOfType(node, 'async'),
          lineNumber: node.startPosition.row + 1,
        });
      }
    }

    // Struct items
    if (node.type === 'struct_item') {
      const nameNode = node.childForFieldName('name');
      if (nameNode) {
        types.push({
          name: nameNode.text,
          kind: 'interface',
          definition: `struct ${nameNode.text}`,
          lineNumber: node.startPosition.row + 1,
        });
      }
    }

    // Enum items
    if (node.type === 'enum_item') {
      const nameNode = node.childForFieldName('name');
      if (nameNode) {
        types.push({
          name: nameNode.text,
          kind: 'enum',
          definition: `enum ${nameNode.text}`,
          lineNumber: node.startPosition.row + 1,
        });
      }
    }

    // Trait items
    if (node.type === 'trait_item') {
      const nameNode = node.childForFieldName('name');
      if (nameNode) {
        types.push({
          name: nameNode.text,
          kind: 'interface',
          definition: `trait ${nameNode.text}`,
          lineNumber: node.startPosition.row + 1,
        });
      }
    }

    // Use declarations: use path::to::module
    if (node.type === 'use_declaration') {
      const argNode = node.childForFieldName('argument');
      if (argNode) {
        imports.push({
          names: [],
          source: cleanText(argNode.text),
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
    language: 'rust',
    exports: functions
      .filter((f) => f.visibility === 'public')
      .map((f) => ({
        name: f.name,
        kind: 'function' as const,
        signature: `pub fn ${f.name}${f.params}`,
      })),
    imports,
    classes,
    functions,
    types,
    tokenCount: 0,
    rawTokenCount: 0,
  };
}

function hasVisibilityPub(node: import('tree-sitter').SyntaxNode): boolean {
  for (let i = 0; i < node.childCount; i++) {
    const child = node.child(i);
    if (child?.type === 'visibility_modifier' && child.text.startsWith('pub')) {
      return true;
    }
  }
  return false;
}

function hasChildOfType(
  node: import('tree-sitter').SyntaxNode,
  type: string
): boolean {
  for (let i = 0; i < node.childCount; i++) {
    if (node.child(i)?.type === type) return true;
  }
  return false;
}

function cleanText(text: string): string {
  return text.replace(/\s+/g, ' ').trim();
}