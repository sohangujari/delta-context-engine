declare module 'tree-sitter-python' {
  import type Parser from 'tree-sitter';
  const language: Parser.Language;
  export default language;
}