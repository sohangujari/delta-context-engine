import path from 'path';
import fs from 'fs';
import {
  detectMonorepo,
  buildPackageMap,
  resolveMonorepoImport,
  type MonorepoConfig,
} from './monorepo.js';

const SUPPORTED_EXTENSIONS = [
  '.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs', '.py', '.go', '.rs', '.java',
];

const RESOLUTION_ORDER = [
  '.ts', '.tsx', '.js', '.jsx', '.mjs',
  '/index.ts', '/index.tsx', '/index.js',
];

// Cache monorepo config per project root
const monorepoCache = new Map<string, MonorepoConfig>();

function getMonorepoConfig(projectRoot: string): MonorepoConfig {
  if (monorepoCache.has(projectRoot)) {
    return monorepoCache.get(projectRoot)!;
  }
  const config = detectMonorepo(projectRoot);
  monorepoCache.set(projectRoot, config);
  return config;
}

export function resolveImport(
  importSource: string,
  fromFile: string,
  projectRoot: string
): string | null {
  // Node built-ins
  if (importSource.startsWith('node:')) return null;

  // Relative imports — resolve normally
  if (importSource.startsWith('.')) {
    return resolveRelative(importSource, fromFile);
  }

  // Check monorepo package map for cross-package imports
  const monorepo = getMonorepoConfig(projectRoot);
  if (monorepo.type !== 'none' && monorepo.packages.length > 0) {
    const packageMap = buildPackageMap(monorepo);
    const resolved = resolveMonorepoImport(importSource, packageMap);
    if (resolved) return resolved;
  }

  // External package — skip
  return null;
}

function resolveRelative(importSource: string, fromFile: string): string | null {
  const fromDir = path.dirname(fromFile);
  const rawResolved = path.resolve(fromDir, importSource);

  // Exact path with supported extension
  if (
    SUPPORTED_EXTENSIONS.includes(path.extname(rawResolved)) &&
    fs.existsSync(rawResolved)
  ) {
    return rawResolved;
  }

  // Strip .js — TypeScript uses .js in imports but files are .ts
  const withoutJs = rawResolved.replace(/\.js$/, '');

  for (const ext of RESOLUTION_ORDER) {
    const candidate = withoutJs + ext;
    if (fs.existsSync(candidate)) return candidate;
  }

  for (const ext of RESOLUTION_ORDER) {
    const candidate = rawResolved + ext;
    if (fs.existsSync(candidate)) return candidate;
  }

  return null;
}

export function isExternal(importSource: string): boolean {
  return (
    !importSource.startsWith('.') &&
    !importSource.startsWith('/') &&
    !importSource.startsWith('node:') === false ||
    importSource.startsWith('node:') ||
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
    if (absPath) resolved.push(absPath);
  }
  return [...new Set(resolved)];
}// touch
