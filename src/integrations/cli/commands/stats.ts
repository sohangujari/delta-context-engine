import chalk from 'chalk';
import path from 'path';
import { DeltaDb } from '../../../persistence/delta-db.js';
import { StateStore } from '../../../persistence/state-store.js';
import { GraphStore } from '../../../persistence/graph-store.js';
import { VectorStore } from '../../../core/embeddings/vector-store.js';

export async function statsCommand(projectRoot: string): Promise<void> {
  const root = path.resolve(projectRoot);

  console.log(chalk.bold('\n∆ Delta — Index Stats'));
  console.log(chalk.dim('─'.repeat(45)));

  const db = new DeltaDb(root);
  const stateStore = new StateStore(db.getDb());
  const graphStore = new GraphStore(db.getDb());
  const vectorStore = new VectorStore(db.getDb());

  try {
    const files = stateStore.getAll();
    const edges = graphStore.getAllEdges();
    const embeddingCount = vectorStore.count();

    if (files.length === 0) {
      console.log(chalk.yellow('No index found. Run: delta init'));
      return;
    }

    const totalRawTokens    = files.reduce((s, f) => s + f.tokenCount, 0);
    const totalSymbolTokens = files.reduce((s, f) => s + f.symbolTokenCount, 0);
    const avgReduction =
      totalRawTokens > 0
        ? Math.round((1 - totalSymbolTokens / totalRawTokens) * 100)
        : 0;

    // Language breakdown
    const byExtension = new Map<string, number>();
    for (const f of files) {
      const ext = path.extname(f.path) || 'other';
      byExtension.set(ext, (byExtension.get(ext) ?? 0) + 1);
    }

    console.log(chalk.bold('Index'));
    console.log(`  Files indexed:     ${chalk.cyan(files.length.toString())}`);
    console.log(`  Dependency edges:  ${chalk.cyan(edges.length.toString())}`);
    console.log(`  Embeddings:        ${chalk.cyan(embeddingCount.toString())} ${embeddingCount === files.length ? chalk.green('✓') : chalk.yellow('(partial)')}`);
    console.log(`  Total raw tokens:  ${chalk.cyan(totalRawTokens.toLocaleString())}`);
    console.log(`  Symbol tokens:     ${chalk.cyan(totalSymbolTokens.toLocaleString())}`);
    console.log(`  Avg compression:   ${chalk.cyan(avgReduction + '%')}`);
    console.log('');

    console.log(chalk.bold('Languages'));
    const sorted = [...byExtension.entries()].sort((a, b) => b[1] - a[1]);
    for (const [ext, count] of sorted) {
      console.log(`  ${ext.padEnd(12)} ${count} file(s)`);
    }
    console.log('');

    // Most connected files
    const dependentCounts = new Map<string, number>();
    for (const edge of edges) {
      dependentCounts.set(edge.to, (dependentCounts.get(edge.to) ?? 0) + 1);
    }

    const topFiles = [...dependentCounts.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5);

    if (topFiles.length > 0) {
      console.log(chalk.bold('Most imported files'));
      for (const [filePath, count] of topFiles) {
        const rel = path.relative(root, filePath);
        console.log(`  ${rel.padEnd(45)} ${count} importer(s)`);
      }
      console.log('');
    }

    const lastIndexed = files.map((f) => f.lastIndexed).sort().pop();
    if (lastIndexed) {
      console.log(chalk.dim(`Last indexed: ${timeAgo(new Date(lastIndexed))}`));
    }

  } finally {
    db.close();
  }
}

function timeAgo(date: Date): string {
  const seconds = Math.floor((Date.now() - date.getTime()) / 1000);
  if (seconds < 60)    return `${seconds}s ago`;
  if (seconds < 3600)  return `${Math.floor(seconds / 60)}m ago`;
  if (seconds < 86400) return `${Math.floor(seconds / 3600)}h ago`;
  return `${Math.floor(seconds / 86400)}d ago`;
}