import fs from 'fs';
import path from 'path';
import { DEFAULT_CONFIG } from './defaults.js';

const DELTAIGNORE_FILE = '.deltaignore';

export function loadIgnorePatterns(projectRoot: string): string[] {
  // Spread into a plain string[] — breaks the readonly const tuple type
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
  const normalized = pattern.endsWith('/')
    ? pattern.slice(0, -1) + '/**'
    : pattern;

  const escaped = normalized
    .replace(/[.+^${}()|[\]\\]/g, '\\$&')
    .replace(/\*\*/g, '{{DOUBLE_STAR}}')
    .replace(/\*/g, '[^/]*')
    .replace(/{{DOUBLE_STAR}}/g, '.*');

  const regex = new RegExp(`^${escaped}$`);
  return regex.test(filePath);
}