import chalk from 'chalk';
import ora from 'ora';
import path from 'path';
import { loadConfig } from '../../../config/delta.config.js';
import { loadIgnorePatterns } from '../../../config/deltaignore.js';
import { classifyFiles } from '../../../core/change-detector/state-classifier.js';
import { walkDirectory } from '../../../core/change-detector/hash-tracker.js';
import { traverseFromChanged } from '../../../core/graph/traverser.js';
import { queryByTask } from '../../../core/embeddings/query.js';
import { scoreAllFiles, buildSemanticScoreMap } from '../../../core/relevance/scorer.js';
import { rankForContext, formatRelevanceScores } from '../../../core/relevance/ranker.js';
import { assembleContext } from '../../../core/assembler/context-builder.js';
import { DeltaDb } from '../../../persistence/delta-db.js';
import { GraphStore } from '../../../persistence/graph-store.js';
import { StateStore } from '../../../persistence/state-store.js';
import { SymbolStore } from '../../../persistence/symbol-store.js';
import { VectorStore } from '../../../core/embeddings/vector-store.js';

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
  const symbolStore = new SymbolStore(db.getDb());
  const vectorStore = new VectorStore(db.getDb());
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
        ` · depth=1: ${traversal.touched.length} · depth=2: ${traversal.ancestors.length}`
      )
    );
    console.log('');

    // ── Step 3: Semantic scoring ──────────────────────────────────
    const semanticSpinner = ora('Scoring semantic relevance...').start();

    const queryResult = await queryByTask(
      {
        task,
        projectRoot: root,
        threshold: config.relevance.semanticThreshold,
      },
      vectorStore,
      symbolStore
    );

    let semanticScoreMap = new Map<string, number>();
    let semanticNote = '';

    if (queryResult.embeddingsAvailable) {
      semanticScoreMap = buildSemanticScoreMap(queryResult.scored);
      semanticSpinner.succeed(
        chalk.green('Semantic scoring complete') +
        chalk.dim(
          ` · ${queryResult.scored.length} files above threshold (${config.relevance.semanticThreshold})`
        )
      );
    } else {
      semanticNote = queryResult.skippedReason ?? 'unavailable';
      semanticSpinner.warn(
        chalk.yellow('Semantic scoring skipped') +
        chalk.dim(` · ${semanticNote}`)
      );
      semanticNote = ' (graph-only mode)';
    }

    console.log('');

    // ── Step 4: Hybrid relevance ranking ─────────────────────────
    const scores = scoreAllFiles(traversal, semanticScoreMap, {
      semanticThreshold: config.relevance.semanticThreshold,
      maxDepth: config.graph.maxDepth,
    });
    const ranked = rankForContext(scores);

    if (options.verbose) {
      console.log(chalk.dim(formatRelevanceScores(ranked, true)));
      console.log('');
    }

    // ── Step 5: Assemble context ──────────────────────────────────
    const assembleSpinner = ora(
      `Assembling context (budget: ${tokenBudget} tokens)...`
    ).start();

    // Build a traversal-like object from ranked results
    // so the assembler uses hybrid-scored files
    const rankedTraversal = {
      ...traversal,
      touched: ranked.touched.map((s) => ({
        path: s.filePath,
        relativePath: s.relativePath,
        state: 'TOUCHED' as const,
        depth: 1,
      })),
      ancestors: ranked.ancestors.map((s) => ({
        path: s.filePath,
        relativePath: s.relativePath,
        state: 'ANCESTOR' as const,
        depth: 2,
      })),
    };

    const payload = await assembleContext({
      task,
      traversal: rankedTraversal,
      projectRoot: root,
      tokenBudget,
      allProjectFiles: allFiles,
    });

    assembleSpinner.succeed(chalk.green('Context assembled'));
    console.log('');

    // ── Results display ───────────────────────────────────────────
    console.log(chalk.dim('─'.repeat(50)));

    const beforeBar = tokenBar(payload.savings.rawTokens, payload.savings.rawTokens, 20);
    const afterBar  = tokenBar(payload.savings.optimizedTokens, payload.savings.rawTokens, 20);

    console.log(
      `${chalk.bold('Before:')}  ${chalk.red(beforeBar)} ${payload.savings.rawTokens.toLocaleString()}`
    );
    console.log(
      `${chalk.bold('After: ')}  ${chalk.green(afterBar)} ${payload.savings.optimizedTokens.toLocaleString()}`
    );
    console.log(
      `${chalk.bold('Saved: ')}  ${chalk.cyan(payload.savings.savedTokens.toLocaleString() + ' tokens')}` +
      chalk.dim(
        `  (${payload.savings.reductionPercent}% reduction · ${payload.savings.reductionMultiple}× fewer)` +
        semanticNote
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

      // Show semantic score if available
      const semScore = semanticScoreMap.get(
        allFiles.find((p) => p.endsWith(f.relativePath)) ?? ''
      );
      const scoreStr = semScore !== undefined
        ? chalk.dim(` sem=${semScore.toFixed(2)}`)
        : '';

      console.log(
        `  ${icon} ${f.relativePath.padEnd(45)} ${level} ${tokens}${scoreStr}`
      );
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

    const budgetUsed = payload.totalTokens;
    const budgetPct  = Math.round((budgetUsed / tokenBudget) * 100);

    if (budgetUsed > tokenBudget) {
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
      console.log(chalk.dim('─── Payload Preview ───'));
      console.log(chalk.dim(payload.formatted.slice(0, 600) + '\n...'));
    }

  } finally {
    db.close();
  }
}

function tokenBar(value: number, max: number, width: number): string {
  const filled = Math.round((value / max) * width);
  return '█'.repeat(filled) + '░'.repeat(width - filled);
}