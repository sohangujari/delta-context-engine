import chalk from 'chalk';
import ora from 'ora';
import path from 'path';
import { loadConfig } from '../../../config/delta.config.js';
import { loadIgnorePatterns } from '../../../config/deltaignore.js';
import { classifyFiles, summarizeClassification } from '../../../core/change-detector/state-classifier.js';
import { walkDirectory } from '../../../core/change-detector/hash-tracker.js';
import { DeltaDb } from '../../../persistence/delta-db.js';
import { StateStore } from '../../../persistence/state-store.js';

export interface RunOptions {
  root: string;
  budget: number;
  verbose: boolean;
}

export async function runCommand(
  task: string,
  options: RunOptions
): Promise<void> {
  const root = path.resolve(options.root);

  console.log(chalk.bold('\n∆ Delta Context Engine'));
  console.log(chalk.dim('─'.repeat(45)));
  console.log(chalk.dim(`Task: "${task}"`));
  console.log('');

  // Load config + open DB
  const config = loadConfig(root);
  const db = new DeltaDb(root);
  const stateStore = new StateStore(db.getDb());
  const ignorePatterns = loadIgnorePatterns(root);

  try {
    // Step 1: Detect changes
    const changeSpinner = ora('Detecting changes...').start();

    const allFiles = walkDirectory(root, root, ignorePatterns);
    const classification = await classifyFiles(root, stateStore, allFiles);

    if (classification.changedCount === 0) {
      changeSpinner.succeed(
        chalk.dim('No changes detected') +
        chalk.dim(` (${classification.strategy} · ${allFiles.length} files scanned)`)
      );
    } else {
      changeSpinner.succeed(
        chalk.green(`${classification.changedCount} file(s) changed`) +
        chalk.dim(` (${classification.strategy})`)
      );

      for (const f of classification.changed) {
        console.log(`  ${chalk.yellow('CHANGED')}  ${f.relativePath}`);
      }
    }

    console.log('');

    if (options.verbose) {
      console.log(chalk.dim(summarizeClassification(classification)));
      console.log('');
    }

    // Remaining pipeline steps (M1.3 → M1.5) coming next
    console.log(
      chalk.dim('Pipeline steps remaining: AST → Graph → Assemble')
    );
    console.log(
      chalk.dim('Run `delta init` first if you see 0 files scanned.')
    );

  } finally {
    db.close();
  }
}