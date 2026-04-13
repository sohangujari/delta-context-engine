import fs from 'fs';
import path from 'path';
import { writeCursorContext, CONTEXT_FILE } from './rules-injector.js';

/**
 * After delta run assembles a payload, write it to the Cursor context file.
 * Cursor rules tell the AI to check this file before every task.
 */
export function updateCursorContext(
  projectRoot: string,
  formattedPayload: string
): { written: boolean; path: string } {
  try {
    writeCursorContext(projectRoot, formattedPayload);
    return {
      written: true,
      path: path.join(projectRoot, CONTEXT_FILE),
    };
  } catch (err) {
    console.warn(
      '⚠ Could not write Cursor context:',
      err instanceof Error ? err.message : err
    );
    return { written: false, path: '' };
  }
}

/**
 * Check if this project uses Cursor.
 */
export function isCursorProject(projectRoot: string): boolean {
  return (
    fs.existsSync(path.join(projectRoot, '.cursor')) ||
    fs.existsSync(path.join(projectRoot, '.cursorrules'))
  );
}