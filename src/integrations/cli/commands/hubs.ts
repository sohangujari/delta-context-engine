import chalk from 'chalk';
import path from 'path';
import { DeltaDb } from '../../../persistence/delta-db.js';
import { HubStore } from '../../../persistence/hub-store.js';

export async function hubsCommand(
  options: { root?: string; bridges?: boolean; surprise?: boolean; all?: boolean }
): Promise<void> {
  const root = path.resolve(options.root ?? '.');
  const db = new DeltaDb(root);
  const hubStore = new HubStore(db.getDb());

  try {
    console.log(chalk.bold('\n∆ Delta — Architectural Hubs'));
    console.log(chalk.dim('─'.repeat(60)));

    // Bridges view
    if (options.bridges) {
      const bridges = hubStore.getBridges();
      if (bridges.length === 0) {
        console.log(chalk.yellow('No bridge files detected.\n'));
        return;
      }

      console.log(chalk.bold('BRIDGES (removal disconnects communities):'));
      for (const b of bridges) {
        const relPath = b.filePath.replace(root + '/', '');
        const communities = b.bridgeCommunities.length > 0
          ? `connects: ${b.bridgeCommunities.join(', ')}`
          : '';
        console.log(`  ${relPath.padEnd(40)} ${chalk.dim(communities)}`);
      }
      console.log(chalk.dim('─'.repeat(60)));
      console.log(`${bridges.length} bridges\n`);
      return;
    }

    // Surprise view
    if (options.surprise) {
      const surprises = hubStore.getHighSurprise(0.4);
      if (surprises.length === 0) {
        console.log(chalk.yellow('No high-surprise connections detected.\n'));
        return;
      }

      console.log(chalk.bold('SURPRISE CONNECTIONS:'));
      for (const s of surprises) {
        const relPath = s.filePath.replace(root + '/', '');
        console.log(
          `  ${relPath.padEnd(40)} score=${s.surpriseScore.toFixed(2)}`
        );
      }
      console.log(chalk.dim('─'.repeat(60)));
      console.log(`${surprises.length} surprise connections\n`);
      return;
    }

    // Default: top hubs
    const hubs = hubStore.getHubs();
    const topN = options.all
      ? hubStore.getTopBetweenness(100)
      : hubStore.getTopBetweenness(10);

    if (topN.length === 0) {
      console.log(chalk.yellow('No hub metrics calculated. Run delta init first.\n'));
      return;
    }

    console.log(chalk.bold('TOP HUBS (by betweenness centrality):'));
    for (const m of topN) {
      const relPath = m.filePath.replace(root + '/', '');
      const labels: string[] = [];
      if (m.isHub) labels.push(chalk.cyan('[HUB]'));
      if (m.isBridge) labels.push(chalk.magenta('[BRIDGE]'));

      console.log(
        `  ${relPath.padEnd(35)} ${m.betweenness.toFixed(2)}  ` +
        chalk.dim(`← ${m.degreeIn} dependents`) +
        `  ${labels.join(' ')}`
      );
    }

    // Summary bridges
    const bridges = hubStore.getBridges();
    if (bridges.length > 0) {
      console.log('');
      console.log(chalk.bold('BRIDGES (removal disconnects communities):'));
      for (const b of bridges.slice(0, 5)) {
        const relPath = b.filePath.replace(root + '/', '');
        const communities = b.bridgeCommunities.length > 0
          ? `connects: ${b.bridgeCommunities.join(' ↔ ')}`
          : '';
        console.log(`  ${relPath.padEnd(35)} ${chalk.dim(communities)}`);
      }
      if (bridges.length > 5) {
        console.log(chalk.dim(`  ... and ${bridges.length - 5} more (use --bridges)`));
      }
    }

    // Summary surprises
    const surprises = hubStore.getHighSurprise(0.4);
    if (surprises.length > 0) {
      console.log('');
      console.log(chalk.bold('SURPRISE CONNECTIONS:'));
      for (const s of surprises.slice(0, 3)) {
        const relPath = s.filePath.replace(root + '/', '');
        console.log(
          `  ${relPath.padEnd(35)} score=${s.surpriseScore.toFixed(2)}`
        );
      }
      if (surprises.length > 3) {
        console.log(chalk.dim(`  ... and ${surprises.length - 3} more (use --surprise)`));
      }
    }

    console.log(chalk.dim('─'.repeat(60)));
    console.log(
      `${hubs.length} hubs · ${bridges.length} bridges · ` +
      `${surprises.length} surprise connections`
    );
    console.log('');
  } finally {
    db.close();
  }
}
