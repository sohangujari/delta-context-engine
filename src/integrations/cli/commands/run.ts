import chalk from 'chalk';
import ora from 'ora';
import path from 'path';
import { loadConfig } from '../../../config/delta.config.js';
import { loadIgnorePatterns } from '../../../config/deltaignore.js';
import { classifyFiles } from '../../../core/change-detector/state-classifier.js';
import { walkDirectory } from '../../../core/change-detector/hash-tracker.js';
import { extractSymbols } from '../../../core/ast/symbol-extractor.js';
import { formatSymbolMap } from '../../../core/ast/symbol-map.js';
import { generateSummary } from '../../../core/ast/summary-generator.js';
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

    // Step 2: Extract symbols from changed files
    if (classification.changedCount > 0) {
      const astSpinner = ora('Extracting symbols...').start();

      let successCount = 0;
      let totalRawTokens = 0;
      let totalSymbolTokens = 0;

      for (const changedFile of classification.changed) {
        const symbolMap = await extractSymbols(changedFile.path);

        if (symbolMap) {
          successCount++;
          totalRawTokens += symbolMap.rawTokenCount;
          totalSymbolTokens += symbolMap.tokenCount;

          if (options.verbose) {
            astSpinner.stop();
            console.log(chalk.dim('─'.repeat(45)));
            console.log(chalk.cyan(changedFile.relativePath));
            console.log(formatSymbolMap(symbolMap));
            console.log(chalk.dim(`Summary: ${generateSummary(symbolMap)}`));
            console.log(
              chalk.dim(
                `Tokens: ${symbolMap.rawTokenCount} raw → ${symbolMap.tokenCount} symbols (${Math.round((1 - symbolMap.tokenCount / symbolMap.rawTokenCount) * 100)}% reduction)`
              )
            );
            console.log('');
            astSpinner.start();
          }
        }
      }

      if (successCount > 0) {
        const reduction =
          totalRawTokens > 0
            ? Math.round((1 - totalSymbolTokens / totalRawTokens) * 100)
            : 0;

        astSpinner.succeed(
          chalk.green(`Symbols extracted (${successCount} file(s))`) +
          chalk.dim(
            ` · ${totalRawTokens} → ${totalSymbolTokens} tokens (${reduction}% compression)`
          )
        );
      } else {
        astSpinner.warn(chalk.yellow('No symbols extracted (unsupported file types?)'));
      }

      console.log('');
    }

    // Remaining pipeline steps
    console.log(chalk.dim('Next: Graph traversal → Context assembly'));

  } finally {
    db.close();
  }
}