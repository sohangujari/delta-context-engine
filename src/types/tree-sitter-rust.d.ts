declare module 'tree-sitter-rust' {
  import type Parser from 'tree-sitter';
  const language: Parser.Language;
  export default language;
}