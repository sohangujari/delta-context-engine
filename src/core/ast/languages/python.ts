export const PYTHON_EXTENSIONS = ['.py'];

export const PY_FUNCTION_QUERY = `
  [
    (function_definition
      name: (identifier) @name
      parameters: (parameters) @params
      return_type: (type)? @return_type)

    (decorated_definition
      definition: (function_definition
        name: (identifier) @name
        parameters: (parameters) @params
        return_type: (type)? @return_type))
  ]
`;

export const PY_CLASS_QUERY = `
  [
    (class_definition
      name: (identifier) @name)

    (decorated_definition
      definition: (class_definition
        name: (identifier) @name))
  ]
`;

export const PY_IMPORT_QUERY = `
  [
    (import_statement
      name: (dotted_name) @source)

    (import_from_statement
      module_name: (dotted_name) @source
      name: [(wildcard_import)
             (dotted_name) @name
             (aliased_import name: (dotted_name) @name)])
  ]
`;