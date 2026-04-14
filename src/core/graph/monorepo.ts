import fs from 'fs';
import path from 'path';

export type MonorepoType = 'nx' | 'turborepo' | 'pnpm' | 'npm-workspaces' | 'none';

export interface MonorepoConfig {
  type: MonorepoType;
  packages: PackageInfo[];
  root: string;
}

export interface PackageInfo {
  name: string;        // package.json name e.g. "@myapp/ui"
  directory: string;   // absolute path to package root
  srcDir: string;      // absolute path to src/ or lib/
  main?: string | undefined;       // main entry point
}

/**
 * Detect monorepo type and discover all packages.
 */
export function detectMonorepo(projectRoot: string): MonorepoConfig {
  // Nx
  if (fs.existsSync(path.join(projectRoot, 'nx.json'))) {
    return {
      type: 'nx',
      packages: discoverPackages(projectRoot),
      root: projectRoot,
    };
  }

  // Turborepo
  if (fs.existsSync(path.join(projectRoot, 'turbo.json'))) {
    return {
      type: 'turborepo',
      packages: discoverPackages(projectRoot),
      root: projectRoot,
    };
  }

  // pnpm workspaces
  if (fs.existsSync(path.join(projectRoot, 'pnpm-workspace.yaml'))) {
    return {
      type: 'pnpm',
      packages: discoverPackages(projectRoot),
      root: projectRoot,
    };
  }

  // npm/yarn workspaces (package.json workspaces field)
  const pkgPath = path.join(projectRoot, 'package.json');
  if (fs.existsSync(pkgPath)) {
    try {
      const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf-8')) as {
        workspaces?: string[] | { packages: string[] };
      };
      if (pkg.workspaces) {
        return {
          type: 'npm-workspaces',
          packages: discoverPackages(projectRoot),
          root: projectRoot,
        };
      }
    } catch {
      // not a valid package.json
    }
  }

  return { type: 'none', packages: [], root: projectRoot };
}

/**
 * Discover all packages in the monorepo by finding package.json files.
 * Searches common monorepo package directories.
 */
function discoverPackages(projectRoot: string): PackageInfo[] {
  const packages: PackageInfo[] = [];
  const searchDirs = ['packages', 'apps', 'libs', 'services', 'modules'];

  for (const searchDir of searchDirs) {
    const searchPath = path.join(projectRoot, searchDir);
    if (!fs.existsSync(searchPath)) continue;

    try {
      const entries = fs.readdirSync(searchPath, { withFileTypes: true });
      for (const entry of entries) {
        if (!entry.isDirectory()) continue;

        const pkgDir = path.join(searchPath, entry.name);
        const pkgJsonPath = path.join(pkgDir, 'package.json');

        if (!fs.existsSync(pkgJsonPath)) continue;

        try {
          const pkg = JSON.parse(
            fs.readFileSync(pkgJsonPath, 'utf-8')
          ) as { name?: string; main?: string };

          if (!pkg.name) continue;

          const srcDir = findSrcDir(pkgDir);

          const pkgInfo: PackageInfo = {
            name: pkg.name,
            directory: pkgDir,
            srcDir,
          };

          if (pkg.main) {
            pkgInfo.main = pkg.main;
          }

          packages.push(pkgInfo);
        } catch {
          // skip malformed package.json
        }
      }
    } catch {
      // skip unreadable directory
    }
  }

  return packages;
}

function findSrcDir(pkgDir: string): string {
  const candidates = ['src', 'lib', 'dist', '.'];
  for (const candidate of candidates) {
    const full = path.join(pkgDir, candidate);
    if (fs.existsSync(full)) return full;
  }
  return pkgDir;
}

/**
 * Build a map of package name → PackageInfo for fast lookup.
 */
export function buildPackageMap(
  config: MonorepoConfig
): Map<string, PackageInfo> {
  const map = new Map<string, PackageInfo>();
  for (const pkg of config.packages) {
    map.set(pkg.name, pkg);

    // Also map without scope: "@myapp/ui" → "ui"
    const withoutScope = pkg.name.replace(/^@[^/]+\//, '');
    if (withoutScope !== pkg.name) {
      map.set(withoutScope, pkg);
    }
  }
  return map;
}

/**
 * Resolve a cross-package import to an absolute file path.
 *
 * Example:
 *   import { Button } from '@myapp/ui'
 *   → /project/packages/ui/src/index.ts
 *
 *   import { auth } from '@myapp/auth/utils'
 *   → /project/packages/auth/src/utils.ts
 */
export function resolveMonorepoImport(
  importSource: string,
  packageMap: Map<string, PackageInfo>
): string | null {
  // Try exact package name match first
  const pkg = packageMap.get(importSource);
  if (pkg) {
    return resolvePackageEntry(pkg);
  }

  // Try matching package name prefix for sub-path imports
  // e.g. '@myapp/auth/utils' → package '@myapp/auth', subpath 'utils'
  for (const [pkgName, pkgInfo] of packageMap.entries()) {
    if (importSource.startsWith(pkgName + '/')) {
      const subPath = importSource.slice(pkgName.length + 1);
      return resolveSubPath(pkgInfo, subPath);
    }
  }

  return null;
}

function resolvePackageEntry(pkg: PackageInfo): string | null {
  // Try main field first
  if (pkg.main) {
    const mainPath = path.resolve(pkg.directory, pkg.main);
    if (fs.existsSync(mainPath)) return mainPath;

    // Try with .ts extension
    const tsPath = mainPath.replace(/\.js$/, '.ts');
    if (fs.existsSync(tsPath)) return tsPath;
  }

  // Try common entry points
  const candidates = [
    path.join(pkg.srcDir, 'index.ts'),
    path.join(pkg.srcDir, 'index.tsx'),
    path.join(pkg.srcDir, 'index.js'),
    path.join(pkg.directory, 'index.ts'),
    path.join(pkg.directory, 'index.js'),
  ];

  return candidates.find((c) => fs.existsSync(c)) ?? null;
}

function resolveSubPath(pkg: PackageInfo, subPath: string): string | null {
  const candidates = [
    path.join(pkg.srcDir, subPath + '.ts'),
    path.join(pkg.srcDir, subPath + '.tsx'),
    path.join(pkg.srcDir, subPath + '.js'),
    path.join(pkg.srcDir, subPath, 'index.ts'),
    path.join(pkg.srcDir, subPath, 'index.js'),
    path.join(pkg.directory, subPath + '.ts'),
    path.join(pkg.directory, subPath + '.js'),
  ];

  return candidates.find((c) => fs.existsSync(c)) ?? null;
}