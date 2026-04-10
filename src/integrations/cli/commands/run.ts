import chalk from 'chalk';
import ora from 'ora';
import path from 'path';
import { loadConfig } from '../../../config/delta.config.js';
import { loadIgnorePatterns } from '../../../config/deltaignore.js';
import { classifyFiles } from '../../../core/change-detector/state-classifier.js';
import { walkDirectory } from '../../../core/change-detector/hash-tracker.js';
import { traverseFromChanged } from '../../../core/graph/traverser.js';
import { assembleContext } from '../../../core/assembler/context-builder.js';
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
  console.log(chalk.dim('─'.repeat(50)));
  console.log(chalk.dim(`Task: "${task}"`));
  console.log('');

  const config = loadConfig(root);
  const tokenBudget = options.budget ?? config.budget.maxTokens;

  const db = new DeltaDb(root);
  const stateStore = new StateStore(db.getDb());
  const graphStore = new GraphStore(db.getDb());
  const ignorePatterns = loadIgnorePatterns(root);

  try {
    // ── Step 1: Detect changes ────────────────────────────────────
    const changeSpinner = ora('Detecting changes...').start();
    const allFiles = walkDirectory(root, root, ignorePatterns);
    const classification = await classifyFiles(root, stateStore, allFiles);

    if (classification.changedCount === 0) {
      changeSpinner.succeed(
        chalk.dim('No changes detected') +
        chalk.dim(` (${classification.strategy} · ${allFiles.length} files)`)
      );
      console.log('');
      console.log(chalk.dim('Nothing changed — context identical to last task.'));
      return;
    }

    changeSpinner.succeed(
      chalk.green(`${classification.changedCount} file(s) changed`) +
      chalk.dim(` (${classification.strategy})`)
    );
    for (const f of classification.changed) {
      console.log(`  ${chalk.yellow('●')} ${f.relativePath}`);
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
      chalk.green('Dependency graph traced') +
      chalk.dim(
        ` · depth=1: ${traversal.touched.length} files · depth=2: ${traversal.ancestors.length} files`
      )
    );
    console.log('');

    // ── Step 3: Assemble context ──────────────────────────────────
    const assembleSpinner = ora(`Assembling context (budget: ${tokenBudget} tokens)...`).start();
    const payload = await assembleContext({
      task,
      traversal,
      projectRoot: root,
      tokenBudget,
      allProjectFiles: allFiles,
    });
    assembleSpinner.succeed(chalk.green('Context assembled'));
    console.log('');

    // ── Results display ───────────────────────────────────────────
    console.log(chalk.dim('─'.repeat(50)));

    const beforeBar = tokenBar(payload.savings.rawTokens, payload.savings.rawTokens, 20);
    const afterBar = tokenBar(payload.savings.optimizedTokens, payload.savings.rawTokens, 20);

    console.log(
      `${chalk.bold('Before:')}  ${chalk.red(beforeBar)} ${payload.savings.rawTokens.toLocaleString()}`
    );
    console.log(
      `${chalk.bold('After: ')}  ${chalk.green(afterBar)} ${payload.savings.optimizedTokens.toLocaleString()}`
    );
    console.log(
      `${chalk.bold('Saved: ')}  ${chalk.cyan(payload.savings.savedTokens.toLocaleString() + ' tokens')}` +
      chalk.dim(
        `  (${payload.savings.reductionPercent}% reduction · ${payload.savings.reductionMultiple}× fewer)`
      )
    );

    console.log(chalk.dim('─'.repeat(50)));
    console.log('');

    // Manifest
    console.log(chalk.bold('Context Manifest:'));
    for (const f of payload.manifest.included) {
      const icon =
        f.compressionLevel === 'full'    ? chalk.green('✅') :
        f.compressionLevel === 'symbols' ? chalk.cyan('○ ') :
                                           chalk.dim('·  ');
      const level  = chalk.dim(`(${f.compressionLevel})`);
      const tokens = chalk.dim(`${f.tokenCount} tok`);
      console.log(`  ${icon} ${f.relativePath.padEnd(45)} ${level} ${tokens}`);
    }

    if (payload.manifest.excluded.length > 0 && options.verbose) {
      console.log('');
      console.log(chalk.dim('Excluded:'));
      for (const f of payload.manifest.excluded.slice(0, 5)) {
        console.log(`  ${chalk.dim('✗  ' + f.relativePath)}`);
      }
      if (payload.manifest.excluded.length > 5) {
        console.log(
          chalk.dim(`  ... and ${payload.manifest.excluded.length - 5} more`)
        );
      }
    }

    console.log('');
    console.log(chalk.dim('─'.repeat(50)));

    // Budget status line — honest about whether we're over
    const budgetUsed = payload.totalTokens;
    const budgetPct  = Math.round((budgetUsed / tokenBudget) * 100);

    if (budgetUsed > tokenBudget) {
      // Changed files exceeded budget — this is expected and correct
      // Changed files are always sent in full (PRD principle)
      console.log(
        chalk.bold(`Total: ${budgetUsed.toLocaleString()} tokens`) +
        chalk.dim(' (changed files exceed budget — increase with --budget)') +
        chalk.dim(`\n  Hint: try --budget ${Math.ceil(budgetUsed / 1000) * 1000}`)
      );
    } else {
      console.log(
        chalk.bold(`Total: ${budgetUsed.toLocaleString()} / ${tokenBudget} tokens`) +
        chalk.dim(` (${budgetPct}% of budget used)`)
      );
    }

    if (options.verbose) {
      console.log('');
      console.log(chalk.dim('─── Formatted Payload Preview ───'));
      // Show first 600 chars to keep output readable
      const preview = payload.formatted.slice(0, 600);
      console.log(chalk.dim(preview + '\n...'));
    }

  } finally {
    db.close();
  }
}

function tokenBar(value: number, max: number, width: number): string {
  const filled = Math.round((value / max) * width);
  return '█'.repeat(filled) + '░'.repeat(width - filled);
}