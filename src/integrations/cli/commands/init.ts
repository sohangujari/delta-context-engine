import chalk from 'chalk';
import fs from 'fs';
import ora from 'ora';
import path from 'path';
import { saveConfig } from '../../../config/delta.config.js';
import { DEFAULT_CONFIG, DELTA_DIR } from '../../../config/defaults.js';
import { DeltaDb } from '../../../persistence/delta-db.js';

export async function initCommand(projectRoot: string): Promise<void> {
  const root = path.resolve(projectRoot);

  console.log(chalk.bold('\n∆ Delta Context Engine'));
  console.log(chalk.dim('─'.repeat(45)));

  // Step 1: Create .delta/ directory
  const dirSpinner = ora('Creating .delta/ directory...').start();
  DeltaDb.ensureDirectory(root);
  dirSpinner.succeed(chalk.green('.delta/ directory ready'));

  // Step 2: Initialize database
  const dbSpinner = ora('Initializing database...').start();
  const db = new DeltaDb(root);
  db.close();
  dbSpinner.succeed(chalk.green('Database initialized'));

  // Step 3: Write default config
  const configSpinner = ora('Writing configuration...').start();
  saveConfig(root, DEFAULT_CONFIG);
  configSpinner.succeed(chalk.green('.delta/config.json written'));

  // Step 4: Write .deltaignore
  writeDeltaIgnore(root);

  // Step 5: .gitignore guidance
  printGitignoreNote(root);

  console.log(chalk.dim('─'.repeat(45)));
  console.log(chalk.bold.green('✓ Delta initialized successfully'));
  console.log('');
  console.log('Next steps:');
  console.log(
    `  ${chalk.cyan('delta run "your task here"')}   Assemble optimized context`
  );
  console.log('');
}

function writeDeltaIgnore(projectRoot: string): void {
  const deltaignorePath = path.join(projectRoot, '.deltaignore');

  if (fs.existsSync(deltaignorePath)) {
    return;
  }

  const contents = [
    '# Delta ignore patterns',
    '# These extend .gitignore for Delta-specific exclusions',
    '',
    '# Dependencies',
    'node_modules/**',
    '',
    '# Build outputs',
    'dist/**',
    'build/**',
    '.next/**',
    'out/**',
    '',
    '# Generated files',
    '*.generated.ts',
    '*.generated.js',
    '',
    '# Test coverage',
    'coverage/**',
    '',
    '# Delta internal',
    '.delta/**',
  ].join('\n');

  fs.writeFileSync(deltaignorePath, contents, 'utf-8');
}

function printGitignoreNote(projectRoot: string): void {
  const gitignorePath = path.join(projectRoot, '.gitignore');

  if (!fs.existsSync(gitignorePath)) {
    return;
  }

  const content = fs.readFileSync(gitignorePath, 'utf-8');
  if (!content.includes('.delta/')) {
    console.log(chalk.yellow('\n⚠ Add .delta/ to your .gitignore:'));
    console.log(chalk.dim('  echo ".delta/" >> .gitignore'));
    console.log('');
  }
}