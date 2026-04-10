import chalk from 'chalk';
import fs from 'fs';
import ora from 'ora';
import path from 'path';
import { loadConfig } from '../../../config/delta.config.js';
import { loadIgnorePatterns } from '../../../config/deltaignore.js';
import { classifyFiles } from '../../../core/change-detector/state-classifier.js';
import { walkDirectory } from '../../../core/change-detector/hash-tracker.js';
import { extractSymbols } from '../../../core/ast/symbol-extractor.js';
import { formatSymbolMap } from '../../../core/ast/symbol-map.js';
import { generateSummary } from '../../../core/ast/summary-generator.js';
import { traverseFromChanged, formatTraversalResult } from '../../../core/graph/traverser.js';
import { DeltaDb } from '../../../persistence/delta-db.js';
import { GraphStore } from '../../../persistence/graph-store.js';
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
  const graphStore = new GraphStore(db.getDb());
  const ignorePatterns = loadIgnorePatterns(root);

  try {
    // ── Step 1: Detect changed files ──────────────────────────────
    const changeSpinner = ora('Detecting changes...').start();
    const allFiles = walkDirectory(root, root, ignorePatterns);
    const classification = await classifyFiles(root, stateStore, allFiles);

    if (classification.changedCount === 0) {
      changeSpinner.succeed(
        chalk.dim('No changes detected') +
        chalk.dim(` (${classification.strategy} · ${allFiles.length} files scanned)`)
      );
      console.log('');
      console.log(chalk.dim('Nothing changed — context would be identical to last task.'));
      return;
    }

    changeSpinner.succeed(
      chalk.green(`${classification.changedCount} file(s) changed`) +
      chalk.dim(` (${classification.strategy})`)
    );
    for (const f of classification.changed) {
      console.log(`  ${chalk.yellow('CHANGED')}  ${f.relativePath}`);
    }
    console.log('');

    // ── Step 2: Graph traversal ───────────────────────────────────
    const graphSpinner = ora('Tracing dependency graph...').start();

    const changedPaths = classification.changed.map((f) => f.path);
    const traversal = traverseFromChanged(
      changedPaths,
      graphStore,
      root,
      config.graph.maxDepth
    );

    graphSpinner.succeed(
      chalk.green('Dependency graph traversed') +
      chalk.dim(
        ` · touched: ${traversal.touched.length} · ancestors: ${traversal.ancestors.length}`
      )
    );

    if (options.verbose) {
      console.log('');
      console.log(
        chalk.dim(formatTraversalResult(traversal, allFiles, root))
      );
    }

    console.log('');

    // ── Step 3: Extract symbols ───────────────────────────────────
    const astSpinner = ora('Extracting symbols...').start();

    let totalRawTokens = 0;
    let totalSymbolTokens = 0;
    let extractedCount = 0;

    // Extract from changed files (full content — counted for savings display)
    for (const f of traversal.changed) {
      if (!fs.existsSync(f.path)) continue;
      const sym = await extractSymbols(f.path);
      if (sym) {
        totalRawTokens += sym.rawTokenCount;
        totalSymbolTokens += sym.rawTokenCount; // changed = full content
        extractedCount++;

        if (options.verbose) {
          astSpinner.stop();
          console.log(chalk.dim('─'.repeat(45)));
          console.log(chalk.bold.yellow(`CHANGED  ${f.relativePath}`));
          console.log(formatSymbolMap(sym));
          console.log('');
          astSpinner.start('Extracting symbols...');
        }
      }
    }

    // Extract symbols from touched files (symbols only)
    for (const f of traversal.touched) {
      if (!fs.existsSync(f.path)) continue;
      const sym = await extractSymbols(f.path);
      if (sym) {
        totalRawTokens += sym.rawTokenCount;
        totalSymbolTokens += sym.tokenCount; // touched = symbols only
        extractedCount++;

        if (options.verbose) {
          astSpinner.stop();
          console.log(chalk.dim('─'.repeat(45)));
          console.log(chalk.cyan(`TOUCHED  ${f.relativePath}`));
          console.log(formatSymbolMap(sym));
          console.log('');
          astSpinner.start('Extracting symbols...');
        }
      }
    }

    // Summaries for ancestor files
    for (const f of traversal.ancestors) {
      if (!fs.existsSync(f.path)) continue;
      const sym = await extractSymbols(f.path);
      if (sym) {
        totalRawTokens += sym.rawTokenCount;
        totalSymbolTokens += 20; // ~1-line summary cost
        extractedCount++;

        if (options.verbose) {
          astSpinner.stop();
          console.log(chalk.dim('─'.repeat(45)));
          console.log(chalk.dim(`ANCESTOR ${f.relativePath}`));
          console.log(chalk.dim(`  ${generateSummary(sym)}`));
          console.log('');
          astSpinner.start('Extracting symbols...');
        }
      }
    }

    const savedTokens = totalRawTokens - totalSymbolTokens;
    const reductionPct =
      totalRawTokens > 0
        ? Math.round((savedTokens / totalRawTokens) * 100)
        : 0;
    const multiple =
      totalSymbolTokens > 0
        ? (totalRawTokens / totalSymbolTokens).toFixed(1)
        : '—';

    astSpinner.succeed(chalk.green('Symbols extracted'));
    console.log('');

    // ── Summary ───────────────────────────────────────────────────
    console.log(chalk.dim('─'.repeat(45)));
    console.log(
      `${chalk.bold('Before:')}  ${chalk.red(totalRawTokens.toLocaleString() + ' tokens')}  (full codebase)`
    );
    console.log(
      `${chalk.bold('After: ')}  ${chalk.green(totalSymbolTokens.toLocaleString() + ' tokens')}  (delta only)`
    );
    console.log(
      `${chalk.bold('Saved: ')}  ${chalk.cyan(savedTokens.toLocaleString() + ' tokens')}  ` +
      chalk.dim(`(${reductionPct}% reduction · ${multiple}× fewer)`)
    );
    console.log(chalk.dim('─'.repeat(45)));
    console.log('');
    console.log(chalk.dim('Next: Context assembly → M1.5'));

  } finally {
    db.close();
  }
}