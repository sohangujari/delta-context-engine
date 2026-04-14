import chalk from 'chalk';
import path from 'path';
import { DeltaDb } from '../../../persistence/delta-db.js';
import { GraphStore } from '../../../persistence/graph-store.js';
import { StateStore } from '../../../persistence/state-store.js';
import { SymbolStore } from '../../../persistence/symbol-store.js';
import { VectorStore } from '../../../core/embeddings/vector-store.js';
import { startWatcher } from '../../../core/indexer/file-watcher.js';
import type { WatchEvent } from '../../../core/indexer/file-watcher.js';

export async function watchCommand(projectRoot: string): Promise<void> {
  const root = path.resolve(projectRoot);

  console.log(chalk.bold('\n∆ Delta - Watch Mode'));
  console.log(chalk.dim('─'.repeat(45)));
  console.log(chalk.dim(`Watching: ${root}`));
  console.log(chalk.dim('Press Ctrl+C to stop'));
  console.log('');

  const db = new DeltaDb(root);
  const graphStore = new GraphStore(db.getDb());
  const stateStore = new StateStore(db.getDb());
  const symbolStore = new SymbolStore(db.getDb());
  const vectorStore = new VectorStore(db.getDb());

  let updatesCount = 0;

  const stop = startWatcher({
    projectRoot: root,
    graphStore,
    stateStore,
    symbolStore,
    vectorStore,
    onUpdate: (event: WatchEvent) => {
      updatesCount++;
      const time = new Date().toLocaleTimeString();
      const duration = chalk.dim(`${event.durationMs}ms`);
      const embed = event.embeddingUpdated
        ? chalk.dim(' +embed')
        : '';

      switch (event.type) {
        case 'updated':
          console.log(
            `  ${chalk.dim(time)}  ${chalk.cyan('~')} ${event.relativePath} ${duration}${embed}`
          );
          break;
        case 'added':
          console.log(
            `  ${chalk.dim(time)}  ${chalk.green('+')} ${event.relativePath} ${duration}${embed}`
          );
          break;
        case 'removed':
          console.log(
            `  ${chalk.dim(time)}  ${chalk.red('-')} ${event.relativePath} ${duration}`
          );
          break;
        case 'error':
          console.log(
            `  ${chalk.dim(time)}  ${chalk.red('!')} ${event.relativePath} - ${event.error}`
          );
          break;
      }
    },
  });

  console.log(chalk.green('✔ Watching for changes...'));
  console.log('');

  // Handle Ctrl+C gracefully
  process.on('SIGINT', async () => {
    console.log('');
    console.log(chalk.dim(`\nStopping watcher (${updatesCount} updates processed)...`));
    await stop();
    db.close();
    process.exit(0);
  });

  // Keep process alive
  await new Promise<void>(() => {
    // Intentionally never resolves - process stays alive until SIGINT
  });
}