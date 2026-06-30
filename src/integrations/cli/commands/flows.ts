import chalk from 'chalk';
import path from 'path';
import { DeltaDb } from '../../../persistence/delta-db.js';
import { FlowStore } from '../../../persistence/flow-store.js';
import type { EntryPointType } from '../../../core/graph/flow-tracer.js';

export async function flowsCommand(
  options: { root?: string; type?: string; show?: string; file?: string }
): Promise<void> {
  const root = path.resolve(options.root ?? '.');
  const db = new DeltaDb(root);
  const flowStore = new FlowStore(db.getDb());

  try {
    // Show specific flow
    if (options.show) {
      const flow = flowStore.get(options.show);
      if (!flow) {
        console.log(chalk.red(`\n✗ Flow "${options.show}" not found.\n`));
        return;
      }

      console.log(chalk.bold(`\n∆ Flow: ${flow.name}`));
      console.log(chalk.dim('─'.repeat(60)));
      console.log(`Entry:  ${flow.entryFile} → ${flow.entrySymbol}`);
      console.log(`Type:   ${flow.entryType}`);
      console.log(
        `Depth:  ${flow.depth} steps · ${flow.fileCount} files · ` +
        `criticality: ${flow.criticality.toFixed(2)}`
      );
      console.log('');
      console.log(chalk.bold('Call Chain:'));

      for (const step of flow.steps) {
        const relPath = step.filePath.replace(root + '/', '');
        const indent = step.depth === 0 ? `  [${step.stepOrder}]` : '   ↓ ';
        const critColor = step.criticality > 0.7 ? chalk.yellow : chalk.dim;
        console.log(
          `${indent} ${relPath.padEnd(35)} ${step.symbol.padEnd(20)} ` +
          critColor(`crit=${step.criticality.toFixed(2)}`)
        );
      }

      console.log(chalk.dim('─'.repeat(60)));
      console.log('');
      return;
    }

    // Show flows for a specific file
    if (options.file) {
      const filePath = path.resolve(options.file);
      const flows = flowStore.getFlowsForFile(filePath);

      if (flows.length === 0) {
        console.log(chalk.yellow(`\n⚠ No flows touch ${options.file}\n`));
        return;
      }

      console.log(chalk.bold(`\n∆ Flows touching ${options.file}`));
      console.log(chalk.dim('─'.repeat(60)));

      for (const flow of flows) {
        const critLabel = flow.criticality >= 0.7 ? chalk.red(' ← HIGH') : '';
        console.log(
          `  ${flow.name.padEnd(28)} ${flow.entryType.padEnd(12)} ` +
          `depth=${flow.depth}  files=${flow.fileCount}  ` +
          `crit=${flow.criticality.toFixed(2)}${critLabel}`
        );
      }

      console.log(chalk.dim('─'.repeat(60)));
      console.log(`${flows.length} flows\n`);
      return;
    }

    // Filter by type
    let flows = options.type
      ? flowStore.getByEntryType(options.type as EntryPointType)
      : flowStore.getAll();

    if (flows.length === 0) {
      console.log(chalk.yellow('\n⚠ No execution flows detected. Run delta init first.\n'));
      return;
    }

    // List all flows
    console.log(chalk.bold('\n∆ Delta — Execution Flows'));
    console.log(chalk.dim('─'.repeat(70)));
    console.log(
      chalk.dim(
        'Name'.padEnd(28) +
        'Type'.padEnd(12) +
        'Depth'.padEnd(7) +
        'Files'.padEnd(7) +
        'Criticality'
      )
    );

    for (const flow of flows) {
      const critLabel = flow.criticality >= 0.7 ? chalk.red(' ← HIGH') : '';
      console.log(
        chalk.bold(flow.name.padEnd(28)) +
        flow.entryType.padEnd(12) +
        String(flow.depth).padEnd(7) +
        String(flow.fileCount).padEnd(7) +
        flow.criticality.toFixed(2) +
        critLabel
      );
    }

    console.log(chalk.dim('─'.repeat(70)));

    const avgDepth = flows.reduce((s, f) => s + f.depth, 0) / flows.length;
    const avgCrit = flows.reduce((s, f) => s + f.criticality, 0) / flows.length;
    console.log(
      `${flows.length} flows · avg depth: ${avgDepth.toFixed(1)} · ` +
      `avg criticality: ${avgCrit.toFixed(2)}`
    );
    console.log('');
  } finally {
    db.close();
  }
}
