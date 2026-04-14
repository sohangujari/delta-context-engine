import type { SymbolMap } from './symbol-map.js';

export function generateSummary(symbolMap: SymbolMap): string {
  const parts: string[] = [];

  // File type context
  const fileName = symbolMap.filePath.split('/').pop() ?? symbolMap.filePath;

  // What it exports
  if (symbolMap.exports.length > 0) {
    const exportNames = symbolMap.exports
      .slice(0, 4)
      .map((e) => e.name)
      .join(', ');
    const more =
      symbolMap.exports.length > 4
        ? ` +${symbolMap.exports.length - 4} more`
        : '';
    parts.push(`exports: ${exportNames}${more}`);
  }

  // What it imports from (key deps)
  if (symbolMap.imports.length > 0) {
    const sources = [
      ...new Set(
        symbolMap.imports
          .map((i) => i.source.split('/').pop() ?? i.source)
          .filter((s) => !s.startsWith('@types'))
          .slice(0, 3)
      ),
    ].join(', ');
    if (sources) {
      parts.push(`uses: ${sources}`);
    }
  }

  // Classes
  if (symbolMap.classes.length > 0) {
    const classNames = symbolMap.classes.map((c) => c.name).join(', ');
    parts.push(`classes: ${classNames}`);
  }

  // Types
  if (symbolMap.types.length > 0) {
    const typeNames = symbolMap.types
      .slice(0, 3)
      .map((t) => t.name)
      .join(', ');
    parts.push(`types: ${typeNames}`);
  }

  const detail = parts.length > 0 ? ` - ${parts.join(' · ')}` : '';
  return `${fileName}${detail}`;
}