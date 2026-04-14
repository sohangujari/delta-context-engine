import type { SupportedLanguage } from '../symbol-map.js';

// File extensions this language handler covers
export const TYPESCRIPT_EXTENSIONS = [
  '.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs',
];

export function getLanguageForExtension(ext: string): SupportedLanguage {
  const map: Record<string, SupportedLanguage> = {
    '.ts':   'typescript',
    '.tsx':  'typescript',
    '.js':   'javascript',
    '.jsx':  'javascript',
    '.mjs':  'javascript',
    '.cjs':  'javascript',
    '.py':   'python',
    '.go':   'go',
    '.rs':   'rust',
    '.java': 'java',
  };
  return map[ext.toLowerCase()] ?? 'unknown';
}

// Tree-sitter query strings for TypeScript/JavaScript symbol extraction
// These are used by the parser to locate nodes in the AST

export const TS_FUNCTION_QUERY = `
  [
    (function_declaration
      name: (identifier) @name
      parameters: (formal_parameters) @params
      return_type: (type_annotation)? @return_type)

    (export_statement
      declaration: (function_declaration
        name: (identifier) @name
        parameters: (formal_parameters) @params
        return_type: (type_annotation)? @return_type))

    (lexical_declaration
      (variable_declarator
        name: (identifier) @name
        value: [(arrow_function
                  parameters: (_) @params
                  return_type: (type_annotation)? @return_type)
                (function
                  parameters: (formal_parameters) @params
                  return_type: (type_annotation)? @return_type)]))

    (export_statement
      declaration: (lexical_declaration
        (variable_declarator
          name: (identifier) @name
          value: [(arrow_function
                    parameters: (_) @params
                    return_type: (type_annotation)? @return_type)
                  (function
                    parameters: (formal_parameters) @params
                    return_type: (type_annotation)? @return_type)])))
  ]
`;

export const TS_CLASS_QUERY = `
  [
    (class_declaration
      name: (type_identifier) @name)

    (export_statement
      declaration: (class_declaration
        name: (type_identifier) @name))
  ]
`;

export const TS_IMPORT_QUERY = `
  (import_statement
    (import_clause) @clause
    source: (string) @source)
`;

export const TS_EXPORT_QUERY = `
  [
    (export_statement
      declaration: (_) @decl)

    (export_statement
      (export_clause
        (export_specifier
          name: (identifier) @name)))
  ]
`;

export const TS_TYPE_QUERY = `
  [
    (interface_declaration
      name: (type_identifier) @name)

    (export_statement
      declaration: (interface_declaration
        name: (type_identifier) @name))

    (type_alias_declaration
      name: (type_identifier) @name)

    (export_statement
      declaration: (type_alias_declaration
        name: (type_identifier) @name))

    (enum_declaration
      name: (identifier) @name)

    (export_statement
      declaration: (enum_declaration
        name: (identifier) @name))
  ]
`;