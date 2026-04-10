import path from 'path';
import fs from 'fs';

const SUPPORTED_EXTENSIONS = [
  '.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs', '.py',
];

// Extensions to try when resolving bare imports (no extension)
const RESOLUTION_ORDER = [
  '.ts', '.tsx', '.js', '.jsx', '.mjs',
  '/index.ts', '/index.tsx', '/index.js',
];

/**
 * Resolve an import source string to an absolute file path.
 * Returns null if the import is external (node_modules) or unresolvable.
 *
 * Examples:
 *   '../utils/auth'     → '/project/src/utils/auth.ts'
 *   './symbol-map.js'   → '/project/src/core/ast/symbol-map.ts'
 *   'chalk'             → null  (external)
 *   'node:path'         → null  (node built-in)
 */
export function resolveImport(
  importSource: string,
  fromFile: string,
  projectRoot: string
): string | null {
  // Skip external packages and node built-ins
  if (isExternal(importSource)) {
    return null;
  }

  // Must be a relative import at this point
  if (!importSource.startsWith('.')) {
    return null;
  }

  const fromDir = path.dirname(fromFile);
  const rawResolved = path.resolve(fromDir, importSource);

  // Try exact path first (import already has extension)
  if (
    SUPPORTED_EXTENSIONS.includes(path.extname(rawResolved)) &&
    fs.existsSync(rawResolved)
  ) {
    return rawResolved;
  }

  // Strip .js extension — TypeScript uses .js in imports but files are .ts
  const withoutJs = rawResolved.replace(/\.js$/, '');

  // Try each extension in resolution order
  for (const ext of RESOLUTION_ORDER) {
    const candidate = withoutJs + ext;
    if (fs.existsSync(candidate)) {
      return candidate;
    }
  }

  // Try the raw path with each extension (no .js stripping)
  for (const ext of RESOLUTION_ORDER) {
    const candidate = rawResolved + ext;
    if (fs.existsSync(candidate)) {
      return candidate;
    }
  }

  return null;
}

export function isExternal(importSource: string): boolean {
  return (
    !importSource.startsWith('.') &&
    !importSource.startsWith('/') &&
    !importSource.startsWith('node:') === false ||
    importSource.startsWith('node:') ||
    // Scoped packages: @anthropic-ai/sdk
    (importSource.startsWith('@') && !importSource.startsWith('@/'))
  );
}

export function resolveImports(
  imports: Array<{ source: string }>,
  fromFile: string,
  projectRoot: string
): string[] {
  const resolved: string[] = [];

  for (const imp of imports) {
    const absPath = resolveImport(imp.source, fromFile, projectRoot);
    if (absPath) {
      resolved.push(absPath);
    }
  }

  return [...new Set(resolved)];
}