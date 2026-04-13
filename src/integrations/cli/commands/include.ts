import chalk from 'chalk';
import fs from 'fs';
import path from 'path';

const OVERRIDE_FILE = '.delta/overrides.json';

export interface Overrides {
  include: string[];   // force-add these files to next context
  exclude: string[];   // force-remove these files from next context
}

export function loadOverrides(projectRoot: string): Overrides {
  const overridePath = path.join(projectRoot, OVERRIDE_FILE);
  if (!fs.existsSync(overridePath)) {
    return { include: [], exclude: [] };
  }
  try {
    return JSON.parse(fs.readFileSync(overridePath, 'utf-8')) as Overrides;
  } catch {
    return { include: [], exclude: [] };
  }
}

export function saveOverrides(projectRoot: string, overrides: Overrides): void {
  const overridePath = path.join(projectRoot, OVERRIDE_FILE);
  fs.writeFileSync(overridePath, JSON.stringify(overrides, null, 2), 'utf-8');
}

export function clearOverrides(projectRoot: string): void {
  const overridePath = path.join(projectRoot, OVERRIDE_FILE);
  if (fs.existsSync(overridePath)) {
    fs.unlinkSync(overridePath);
  }
}

export async function includeCommand(
  filePath: string,
  projectRoot: string
): Promise<void> {
  const root = path.resolve(projectRoot);
  const absPath = path.resolve(root, filePath);
  const relPath = path.relative(root, absPath);

  // Validate file exists
  if (!fs.existsSync(absPath)) {
    console.log(chalk.red(`✗ File not found: ${relPath}`));
    return;
  }

  const overrides = loadOverrides(root);

  // Remove from exclude list if it was there
  overrides.exclude = overrides.exclude.filter((p) => p !== relPath);

  // Add to include list if not already there
  if (!overrides.include.includes(relPath)) {
    overrides.include.push(relPath);
  }

  saveOverrides(root, overrides);

  console.log(chalk.green(`✓ Force-include added: ${relPath}`));
  console.log(chalk.dim('  Applied to next delta run only'));
  console.log('');
  console.log(chalk.dim('Current overrides:'));
  console.log(chalk.dim(`  include: ${overrides.include.join(', ') || 'none'}`));
  console.log(chalk.dim(`  exclude: ${overrides.exclude.join(', ') || 'none'}`));
}