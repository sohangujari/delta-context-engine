import chalk from 'chalk';
import path from 'path';
import { DeltaDb } from '../../../persistence/delta-db.js';
import { CommunityStore } from '../../../persistence/community-store.js';

export async function communitiesCommand(
  options: { root?: string; show?: string; verbose?: boolean }
): Promise<void> {
  const root = path.resolve(options.root ?? '.');
  const db = new DeltaDb(root);
  const communityStore = new CommunityStore(db.getDb());

  try {
    const communities = communityStore.getAll();

    if (communities.length === 0) {
      console.log(chalk.yellow('\n⚠ No communities detected. Run delta init first.\n'));
      return;
    }

    // Show specific community
    if (options.show) {
      const community = communityStore.getByName(options.show);
      if (!community) {
        console.log(chalk.red(`\n✗ Community "${options.show}" not found.\n`));
        console.log('Available communities:');
        for (const c of communities) {
          console.log(`  ${chalk.cyan(c.name)}`);
        }
        console.log('');
        return;
      }

      showCommunityDetail(community, communityStore, root);
      return;
    }

    // List all communities
    console.log(chalk.bold('\n∆ Delta — Communities'));
    console.log(chalk.dim('─'.repeat(60)));

    if (options.verbose) {
      // Verbose table with scores
      console.log(
        chalk.dim(
          'Name'.padEnd(16) +
          'Files'.padEnd(7) +
          'Cohesion'.padEnd(10) +
          'Coupling'.padEnd(10) +
          'Risk'.padEnd(8)
        )
      );

      for (const c of communities) {
        const riskColor =
          c.riskLevel === 'HIGH' ? chalk.red :
          c.riskLevel === 'MEDIUM' ? chalk.yellow :
          chalk.green;

        console.log(
          chalk.bold(c.name.padEnd(16)) +
          String(c.fileCount).padEnd(7) +
          c.cohesionScore.toFixed(2).padEnd(10) +
          c.couplingScore.toFixed(2).padEnd(10) +
          riskColor(c.riskLevel.padEnd(8))
        );
      }
    } else {
      // Compact list
      const summaries = communities.map(
        (c) => `${chalk.cyan(c.name)} (${c.fileCount} files)`
      );
      console.log(`  ${summaries.join('  ')}`);
    }

    console.log(chalk.dim('─'.repeat(60)));

    const avgCohesion = communities.reduce((s, c) => s + c.cohesionScore, 0) / communities.length;
    console.log(
      `${communities.length} communities · avg cohesion: ${avgCohesion.toFixed(2)}`
    );
    console.log('');
  } finally {
    db.close();
  }
}

function showCommunityDetail(
  community: ReturnType<CommunityStore['get']> & {},
  communityStore: CommunityStore,
  root: string
): void {
  console.log(chalk.bold(`\n∆ Community: ${community.name} (${community.fileCount} files)`));
  console.log(chalk.dim('─'.repeat(60)));

  // Scores
  const cohesionLabel =
    community.cohesionScore > 0.7 ? 'high — well-connected internally' :
    community.cohesionScore > 0.4 ? 'moderate' :
    'low — loosely connected';
  const couplingLabel =
    community.couplingScore < 0.3 ? 'low — few external dependencies' :
    community.couplingScore < 0.6 ? 'moderate' :
    'high — many external dependencies';

  console.log(`Cohesion:  ${community.cohesionScore.toFixed(2)}  (${cohesionLabel})`);
  console.log(`Coupling:  ${community.couplingScore.toFixed(2)}  (${couplingLabel})`);

  const riskColor =
    community.riskLevel === 'HIGH' ? chalk.red :
    community.riskLevel === 'MEDIUM' ? chalk.yellow :
    chalk.green;
  console.log(`Risk:      ${riskColor(community.riskLevel)}`);
  console.log('');

  // Files sorted by centrality
  console.log(chalk.bold('Files:'));
  const sortedFiles = [...community.files].sort((a, b) => {
    const ca = community.centralities.get(a) ?? 0;
    const cb = community.centralities.get(b) ?? 0;
    return cb - ca;
  });

  for (const filePath of sortedFiles) {
    const centrality = community.centralities.get(filePath) ?? 0;
    const relPath = filePath.replace(root + '/', '');
    const marker = centrality > 0.7 ? '●' : '○';
    const hubLabel = centrality > 0.7 ? chalk.dim('  (hub)') : '';
    console.log(
      `  ${marker} ${relPath.padEnd(40)} centrality: ${centrality.toFixed(2)}${hubLabel}`
    );
  }

  // External dependencies (cross-community edges)
  const edges = communityStore.getCommunityEdges();
  const relevantEdges = edges.filter(
    (e) => e.from === community.name || e.to === community.name
  );

  if (relevantEdges.length > 0) {
    console.log('');
    console.log(chalk.bold('External dependencies:'));
    for (const edge of relevantEdges) {
      const other = edge.from === community.name ? edge.to : edge.from;
      const direction = edge.from === community.name ? '→' : '←';
      console.log(
        `  ${community.name} ${direction} ${other} (${edge.edgeCount} edges)`
      );
    }
  }

  console.log(chalk.dim('─'.repeat(60)));
  console.log('');
}
