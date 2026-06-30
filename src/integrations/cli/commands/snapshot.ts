import chalk from 'chalk';
import path from 'path';
import { DeltaDb } from '../../../persistence/delta-db.js';
import { GraphStore } from '../../../persistence/graph-store.js';
import { StateStore } from '../../../persistence/state-store.js';
import { CommunityStore } from '../../../persistence/community-store.js';
import { RiskStore } from '../../../persistence/risk-store.js';
import { HubStore } from '../../../persistence/hub-store.js';
import { SnapshotStore } from '../../../persistence/snapshot-store.js';
import { takeSnapshot, compareToSnapshot } from '../../../core/graph/graph-diff.js';

export async function snapshotCommand(
  subcommand: string,
  args: string[],
  options: { root?: string; notes?: string }
): Promise<void> {
  const root = path.resolve(options.root ?? '.');
  const db = new DeltaDb(root);

  try {
    const graphStore = new GraphStore(db.getDb());
    const stateStore = new StateStore(db.getDb());
    const communityStore = new CommunityStore(db.getDb());
    const riskStore = new RiskStore(db.getDb());
    const hubStore = new HubStore(db.getDb());
    const snapshotStore = new SnapshotStore(db.getDb());

    switch (subcommand) {
      case 'save': {
        const label = args[0];
        if (!label) {
          console.log(chalk.red('\n✗ Usage: delta snapshot save <label>\n'));
          return;
        }

        const snapshot = await takeSnapshot(
          label, stateStore, graphStore, communityStore,
          riskStore, hubStore, snapshotStore, options.notes
        );

        console.log(chalk.bold.green(`\n✓ Snapshot saved: "${label}"`));
        console.log(chalk.dim(
          `  ${snapshot.fileCount} files · ${snapshot.edgeCount} edges · ` +
          `${snapshot.communityCount} communities`
        ));
        console.log(chalk.dim(`  ID: ${snapshot.id}`));
        console.log('');
        break;
      }

      case 'list': {
        const snapshots = snapshotStore.getAll();
        if (snapshots.length === 0) {
          console.log(chalk.yellow('\n⚠ No snapshots saved yet. Use: delta snapshot save <label>\n'));
          return;
        }

        console.log(chalk.bold('\n∆ Delta — Graph Snapshots'));
        console.log(chalk.dim('─'.repeat(60)));

        for (const s of snapshots) {
          console.log(
            `  ${chalk.cyan(s.label.padEnd(25))} ` +
            chalk.dim(
              `${s.fileCount} files · ${s.edgeCount} edges · ` +
              `${s.communityCount} communities · ${s.createdAt.slice(0, 10)}`
            )
          );
          if (s.notes) {
            console.log(chalk.dim(`    ${s.notes}`));
          }
        }

        console.log(chalk.dim('─'.repeat(60)));
        console.log(`${snapshots.length} snapshots\n`);
        break;
      }

      case 'diff': {
        const label = args[0];
        if (!label) {
          console.log(chalk.red('\n✗ Usage: delta snapshot diff <label>\n'));
          return;
        }

        const snapshot = snapshotStore.getByLabel(label);
        if (!snapshot) {
          console.log(chalk.red(`\n✗ Snapshot "${label}" not found.\n`));
          return;
        }

        const diff = await compareToSnapshot(
          snapshot.id, stateStore, graphStore, communityStore,
          riskStore, hubStore, snapshotStore
        );

        console.log(chalk.bold(`\n∆ Graph Diff: "${label}" → current`));
        console.log(chalk.dim('─'.repeat(60)));
        console.log(
          `Snapshot: ${diff.snapshot.fileCount} files · ${diff.snapshot.edgeCount} edges\n` +
          `Current:  ${diff.current.fileCount} files · ${diff.current.edgeCount} edges`
        );
        console.log('');

        // Files
        if (diff.filesAdded.length > 0) {
          console.log(chalk.green(`Files added (${diff.filesAdded.length}):`));
          for (const f of diff.filesAdded.slice(0, 10)) {
            console.log(chalk.green(`  + ${f.replace(root + '/', '')}`));
          }
          if (diff.filesAdded.length > 10) {
            console.log(chalk.dim(`  ... and ${diff.filesAdded.length - 10} more`));
          }
          console.log('');
        }

        if (diff.filesRemoved.length > 0) {
          console.log(chalk.red(`Files removed (${diff.filesRemoved.length}):`));
          for (const f of diff.filesRemoved.slice(0, 10)) {
            console.log(chalk.red(`  - ${f.replace(root + '/', '')}`));
          }
          console.log('');
        }

        if (diff.filesModified.length > 0) {
          console.log(chalk.yellow(`Files modified (${diff.filesModified.length}):`));
          for (const f of diff.filesModified.slice(0, 10)) {
            console.log(chalk.yellow(`  ~ ${f.replace(root + '/', '')}`));
          }
          if (diff.filesModified.length > 10) {
            console.log(chalk.dim(`  ... and ${diff.filesModified.length - 10} more`));
          }
          console.log('');
        }

        // Edges
        if (diff.edgesAdded.length > 0 || diff.edgesRemoved.length > 0) {
          console.log(
            `Edges: ${chalk.green(`+${diff.edgesAdded.length}`)} added · ` +
            `${chalk.red(`-${diff.edgesRemoved.length}`)} removed`
          );
          console.log('');
        }

        // Hubs
        if (diff.newHubs.length > 0) {
          console.log(chalk.cyan('New hubs:'));
          for (const h of diff.newHubs) {
            console.log(`  ${h.replace(root + '/', '')}`);
          }
          console.log('');
        }

        if (diff.newBridges.length > 0) {
          console.log(chalk.magenta('New bridges:'));
          for (const b of diff.newBridges) {
            console.log(`  ${b.replace(root + '/', '')}`);
          }
          console.log('');
        }

        // Risk delta
        const riskColor = diff.riskDelta > 0 ? chalk.red : chalk.green;
        const riskSign = diff.riskDelta > 0 ? '+' : '';
        console.log(
          `Risk delta: ${riskColor(riskSign + diff.riskDelta.toFixed(3))}`
        );

        console.log(chalk.dim('─'.repeat(60)));
        console.log(chalk.bold(diff.summary));
        console.log('');
        break;
      }

      case 'delete': {
        const label = args[0];
        if (!label) {
          console.log(chalk.red('\n✗ Usage: delta snapshot delete <label>\n'));
          return;
        }

        const snapshot = snapshotStore.getByLabel(label);
        if (!snapshot) {
          console.log(chalk.red(`\n✗ Snapshot "${label}" not found.\n`));
          return;
        }

        snapshotStore.deleteSnapshot(snapshot.id);
        console.log(chalk.green(`\n✓ Snapshot "${label}" deleted.\n`));
        break;
      }

      default:
        console.log(chalk.yellow(`\n⚠ Unknown subcommand: ${subcommand}`));
        console.log('Usage:');
        console.log('  delta snapshot save <label>     Save current graph state');
        console.log('  delta snapshot list              List all snapshots');
        console.log('  delta snapshot diff <label>      Diff current vs snapshot');
        console.log('  delta snapshot delete <label>    Remove a snapshot');
        console.log('');
        break;
    }
  } finally {
    db.close();
  }
}
