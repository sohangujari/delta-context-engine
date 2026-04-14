declare module 'tree-sitter-go' {
  import type Parser from 'tree-sitter';
  const language: Parser.Language;
  export default language;
}