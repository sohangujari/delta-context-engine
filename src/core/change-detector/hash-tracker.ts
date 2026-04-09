import fs from 'fs';
import crypto from 'crypto';
import path from 'path';
import { shouldIgnore, loadIgnorePatterns } from '../../config/deltaignore.js';

export interface FileHash {
  path: string;       // absolute path
  hash: string;       // SHA-256 of file content
  sizeBytes: number;
  modifiedAt: string; // ISO timestamp
}

export function hashFile(filePath: string): string {
  const content = fs.readFileSync(filePath);
  return crypto.createHash('sha256').update(content).digest('hex');
}

export function hashFileIfExists(filePath: string): string | null {
  if (!fs.existsSync(filePath)) return null;
  return hashFile(filePath);
}

export function getFileHash(filePath: string): FileHash {
  const stat = fs.statSync(filePath);
  return {
    path: filePath,
    hash: hashFile(filePath),
    sizeBytes: stat.size,
    modifiedAt: stat.mtime.toISOString(),
  };
}

export function walkDirectory(
  dir: string,
  projectRoot: string,
  ignorePatterns: string[],
  extensions: string[] = ['.ts', '.tsx', '.js', '.jsx', '.py', '.go', '.rs', '.java']
): string[] {
  const results: string[] = [];

  function walk(current: string): void {
    if (shouldIgnore(current, ignorePatterns, projectRoot)) {
      return;
    }

    const entries = fs.readdirSync(current, { withFileTypes: true });

    for (const entry of entries) {
      const fullPath = path.join(current, entry.name);

      if (shouldIgnore(fullPath, ignorePatterns, projectRoot)) {
        continue;
      }

      if (entry.isDirectory()) {
        walk(fullPath);
      } else if (entry.isFile()) {
        const ext = path.extname(entry.name).toLowerCase();
        if (extensions.includes(ext)) {
          results.push(fullPath);
        }
      }
    }
  }

  walk(dir);
  return results;
}

export function detectChangedByHash(
  allFiles: string[],
  getStoredHash: (filePath: string) => string | null
): string[] {
  const changed: string[] = [];

  for (const filePath of allFiles) {
    if (!fs.existsSync(filePath)) continue;

    const storedHash = getStoredHash(filePath);
    if (storedHash === null) {
      // New file — never seen before
      changed.push(filePath);
      continue;
    }

    const currentHash = hashFile(filePath);
    if (currentHash !== storedHash) {
      changed.push(filePath);
    }
  }

  return changed;
}