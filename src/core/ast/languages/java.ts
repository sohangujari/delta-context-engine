export const JAVA_EXTENSIONS = ['.java'];

export function extractJavaSymbols(
  filePath: string,
  root: import('tree-sitter').SyntaxNode,
  source: string
): import('../symbol-map.js').SymbolMap {
  const functions: import('../symbol-map.js').FunctionSymbol[] = [];
  const classes: import('../symbol-map.js').ClassSymbol[] = [];
  const imports: import('../symbol-map.js').ImportSymbol[] = [];
  const types: import('../symbol-map.js').TypeSymbol[] = [];

  function walk(node: import('tree-sitter').SyntaxNode): void {
    // Class declarations
    if (node.type === 'class_declaration') {
      const nameNode = node.childForFieldName('name');
      if (nameNode) {
        const methods: import('../symbol-map.js').FunctionSymbol[] = [];
        const body = node.childForFieldName('body');

        if (body) {
          for (let i = 0; i < body.childCount; i++) {
            const child = body.child(i);
            if (child?.type === 'method_declaration') {
              const methodName = child.childForFieldName('name');
              const methodParams = child.childForFieldName('formal_parameters');
              const returnType = child.childForFieldName('type');
              if (methodName) {
                methods.push({
                  name: methodName.text,
                  params: methodParams ? cleanText(methodParams.text) : '()',
                  returnType: returnType ? cleanText(returnType.text) : 'void',
                  visibility: getJavaVisibility(child),
                  isAsync: false,
                  lineNumber: child.startPosition.row + 1,
                });
              }
            }
          }
        }

        classes.push({
          name: nameNode.text,
          methods,
          properties: [],
          lineNumber: node.startPosition.row + 1,
        });

        types.push({
          name: nameNode.text,
          kind: 'interface',
          definition: `class ${nameNode.text}`,
          lineNumber: node.startPosition.row + 1,
        });
      }
    }

    // Interface declarations
    if (node.type === 'interface_declaration') {
      const nameNode = node.childForFieldName('name');
      if (nameNode) {
        types.push({
          name: nameNode.text,
          kind: 'interface',
          definition: `interface ${nameNode.text}`,
          lineNumber: node.startPosition.row + 1,
        });
      }
    }

    // Import declarations
    if (node.type === 'import_declaration') {
      const pathNode = findChildOfType(node, 'scoped_identifier') ??
                       findChildOfType(node, 'identifier');
      if (pathNode) {
        imports.push({
          names: [],
          source: pathNode.text,
          isDefault: false,
          isNamespace: false,
        });
      }
    }

    // Top-level method declarations
    if (node.type === 'method_declaration') {
      const nameNode = node.childForFieldName('name');
      const paramsNode = node.childForFieldName('formal_parameters');
      const returnTypeNode = node.childForFieldName('type');

      if (nameNode) {
        functions.push({
          name: nameNode.text,
          params: paramsNode ? cleanText(paramsNode.text) : '()',
          returnType: returnTypeNode ? cleanText(returnTypeNode.text) : 'void',
          visibility: getJavaVisibility(node),
          isAsync: false,
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

  return {
    filePath,
    language: 'java',
    exports: classes.map((c) => ({
      name: c.name,
      kind: 'class' as const,
    })),
    imports,
    classes,
    functions,
    types,
    tokenCount: 0,
    rawTokenCount: 0,
  };
}

function getJavaVisibility(
  node: import('tree-sitter').SyntaxNode
): 'public' | 'private' | 'protected' {
  const modifiers = findChildOfType(node, 'modifiers');
  if (!modifiers) return 'public';
  const text = modifiers.text;
  if (text.includes('private')) return 'private';
  if (text.includes('protected')) return 'protected';
  return 'public';
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

function cleanText(text: string): string {
  return text.replace(/\s+/g, ' ').trim();
}