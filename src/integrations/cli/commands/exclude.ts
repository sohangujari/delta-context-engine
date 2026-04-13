import chalk from 'chalk';
import path from 'path';
import {
  loadOverrides,
  saveOverrides,
} from './include.js';

export async function excludeCommand(
  filePath: string,
  projectRoot: string
): Promise<void> {
  const root = path.resolve(projectRoot);
  const absPath = path.resolve(root, filePath);
  const relPath = path.relative(root, absPath);

  const overrides = loadOverrides(root);

  // Remove from include list if it was there
  overrides.include = overrides.include.filter((p) => p !== relPath);

  // Add to exclude list if not already there
  if (!overrides.exclude.includes(relPath)) {
    overrides.exclude.push(relPath);
  }

  saveOverrides(root, overrides);

  console.log(chalk.green(`✓ Force-exclude added: ${relPath}`));
  console.log(chalk.dim('  Applied to next delta run only'));
  console.log('');
  console.log(chalk.dim('Current overrides:'));
  console.log(chalk.dim(`  include: ${overrides.include.join(', ') || 'none'}`));
  console.log(chalk.dim(`  exclude: ${overrides.exclude.join(', ') || 'none'}`));
}