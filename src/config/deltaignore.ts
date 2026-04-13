import fs from 'fs';
import path from 'path';
import { DEFAULT_CONFIG } from './defaults.js';

const DELTAIGNORE_FILE = '.deltaignore';

export function loadIgnorePatterns(projectRoot: string): string[] {
  const patterns: string[] = [...DEFAULT_CONFIG.ignore];

  // Inherit .gitignore patterns
  const gitignorePath = path.join(projectRoot, '.gitignore');
  if (fs.existsSync(gitignorePath)) {
    const lines = fs.readFileSync(gitignorePath, 'utf-8').split('\n');
    for (const line of lines) {
      const trimmed = line.trim();
      if (trimmed && !trimmed.startsWith('#')) {
        patterns.push(trimmed);
      }
    }
  }

  // .deltaignore extends/overrides
  const deltaignorePath = path.join(projectRoot, DELTAIGNORE_FILE);
  if (fs.existsSync(deltaignorePath)) {
    const lines = fs.readFileSync(deltaignorePath, 'utf-8').split('\n');
    for (const line of lines) {
      const trimmed = line.trim();
      if (trimmed && !trimmed.startsWith('#')) {
        patterns.push(trimmed);
      }
    }
  }

  return [...new Set(patterns)];
}

export function shouldIgnore(
  filePath: string,
  patterns: string[],
  projectRoot: string
): boolean {
  const relative = path.relative(projectRoot, filePath);

  for (const pattern of patterns) {
    if (matchesPattern(relative, pattern)) {
      return true;
    }
  }
  return false;
}

function matchesPattern(filePath: string, pattern: string): boolean {
  // Normalize separators
  const normalizedPath = filePath.replace(/\\/g, '/');
  const normalizedPattern = pattern.replace(/\\/g, '/');

  // Handle **/prefix — matches anywhere in the path
  if (normalizedPattern.startsWith('**/')) {
    const suffix = normalizedPattern.slice(3);
    const suffixRegex = globToRegex(suffix);
    // Match against full path OR any path segment
    if (suffixRegex.test(normalizedPath)) return true;
    // Also check each path segment
    const parts = normalizedPath.split('/');
    for (let i = 0; i < parts.length; i++) {
      const subPath = parts.slice(i).join('/');
      if (suffixRegex.test(subPath)) return true;
    }
    return false;
  }

  // Handle pattern without leading **/ — also try matching as suffix
  const regex = globToRegex(normalizedPattern);
  if (regex.test(normalizedPath)) return true;

  // Also check if any directory segment matches (e.g. "packages/**" matches "packages/foo/bar")
  const parts = normalizedPath.split('/');
  for (let i = 0; i < parts.length; i++) {
    const subPath = parts.slice(i).join('/');
    if (regex.test(subPath)) return true;
  }

  return false;
}

function globToRegex(pattern: string): RegExp {
  const normalized = pattern.endsWith('/')
    ? pattern.slice(0, -1) + '/**'
    : pattern;

  const escaped = normalized
    .replace(/[.+^${}()|[\]\\]/g, '\\$&')
    .replace(/\*\*/g, '{{DOUBLE_STAR}}')
    .replace(/\*/g, '[^/]*')
    .replace(/{{DOUBLE_STAR}}/g, '.*');

  return new RegExp(`^${escaped}$`);
}