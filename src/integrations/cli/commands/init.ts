import chalk from 'chalk';
import fs from 'fs';
import ora from 'ora';
import path from 'path';
import { saveConfig } from '../../../config/delta.config.js';
import { DEFAULT_CONFIG } from '../../../config/defaults.js';
import { loadIgnorePatterns } from '../../../config/deltaignore.js';
import { walkDirectory } from '../../../core/change-detector/hash-tracker.js';
import { buildFullGraph } from '../../../core/graph/builder.js';
import { DeltaDb } from '../../../persistence/delta-db.js';
import { GraphStore } from '../../../persistence/graph-store.js';
import { StateStore } from '../../../persistence/state-store.js';
import { SymbolStore } from '../../../persistence/symbol-store.js';

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
  dbSpinner.succeed(chalk.green('Database initialized'));

  // Step 3: Write default config
  const configSpinner = ora('Writing configuration...').start();
  saveConfig(root, DEFAULT_CONFIG);
  configSpinner.succeed(chalk.green('.delta/config.json written'));

  // Step 4: Write .deltaignore
  writeDeltaIgnore(root);

  // Step 5: Index + build graph
  const ignorePatterns = loadIgnorePatterns(root);
  const allFiles = walkDirectory(root, root, ignorePatterns);

  console.log('');

  const indexSpinner = ora(
    `Indexing ${allFiles.length} files...`
  ).start();

  const graphStore = new GraphStore(db.getDb());
  const stateStore = new StateStore(db.getDb());
  const symbolStore = new SymbolStore(db.getDb());

  let lastPercent = 0;

  const result = await buildFullGraph({
    projectRoot: root,
    allFiles,
    graphStore,
    stateStore,
    symbolStore,
    onProgress: (done, total) => {
      const percent = Math.floor((done / total) * 100);
      if (percent >= lastPercent + 10) {
        lastPercent = percent;
        indexSpinner.text = `Indexing files... ${percent}%`;
      }
    },
  });

  if (result.errors.length > 0) {
    indexSpinner.warn(
      chalk.yellow(
        `Indexed ${result.filesProcessed} files · ${result.edgesCreated} edges · ${result.errors.length} warning(s)`
      )
    );
  } else {
    indexSpinner.succeed(
      chalk.green(
        `Indexed ${result.filesProcessed} files · ${result.edgesCreated} dependency edges`
      )
    );
  }

  db.close();

  printGitignoreNote(root);

  console.log(chalk.dim('─'.repeat(45)));
  console.log(chalk.bold.green('✓ Delta initialized successfully'));
  console.log('');
  console.log('Next steps:');
  console.log(`  ${chalk.cyan('delta run "your task here"')}   Assemble optimized context`);
  console.log(`  ${chalk.cyan('delta stats')}                  Show index statistics`);
  console.log('');
}

function writeDeltaIgnore(projectRoot: string): void {
  const deltaignorePath = path.join(projectRoot, '.deltaignore');
  if (fs.existsSync(deltaignorePath)) return;

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
  if (!fs.existsSync(gitignorePath)) return;

  const content = fs.readFileSync(gitignorePath, 'utf-8');
  if (!content.includes('.delta/')) {
    console.log(chalk.yellow('\n⚠ Add .delta/ to your .gitignore:'));
    console.log(chalk.dim('  echo ".delta/" >> .gitignore'));
    console.log('');
  }
}