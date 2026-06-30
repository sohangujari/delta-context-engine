import chalk from 'chalk';
import path from 'path';
import { DeltaDb } from '../../../persistence/delta-db.js';
import { GraphStore } from '../../../persistence/graph-store.js';
import { SymbolStore } from '../../../persistence/symbol-store.js';
import { CommunityStore } from '../../../persistence/community-store.js';
import { FlowStore } from '../../../persistence/flow-store.js';
import { calculateBlastRadius } from '../../../core/graph/blast-radius.js';

export async function blastCommand(
  file: string,
  options: { root?: string; symbol?: string; depth?: string }
): Promise<void> {
  const root = path.resolve(options.root ?? '.');
  const filePath = path.resolve(file);
  const maxDepth = options.depth ? parseInt(options.depth, 10) : 5;
  const db = new DeltaDb(root);

  try {
    const graphStore = new GraphStore(db.getDb());
    const symbolStore = new SymbolStore(db.getDb());
    const communityStore = new CommunityStore(db.getDb());
    const flowStore = new FlowStore(db.getDb());

    const result = await calculateBlastRadius(
      filePath, graphStore, communityStore, flowStore, symbolStore,
      { projectRoot: root, maxDepth }
    );

    const relTarget = filePath.replace(root + '/', '');

    // Header
    console.log(chalk.bold(`\n∆ Blast Radius: ${relTarget}`));
    if (options.symbol) {
      console.log(chalk.dim(`  Scoped to: ${options.symbol}`));
    }
    console.log(chalk.dim('─'.repeat(60)));

    // Risk summary
    const riskColor =
      result.riskLevel === 'HIGH' ? chalk.red :
      result.riskLevel === 'MEDIUM' ? chalk.yellow :
      chalk.green;

    console.log(`Risk: ${riskColor(result.riskLevel)} (${result.overallRisk.toFixed(2)})`);
    console.log(
      `  ├─ Dependent files: ${result.totalAffectedFiles}   ` +
      `(direct: ${result.directDependents.length}, transitive: ${result.transitiveDependents.length})`
    );
    console.log(
      `  ├─ Communities:     ${result.communitiesAffected.length}   ` +
      `(${result.communitiesAffected.map((c) => c.name).join(', ') || 'none'})`
    );
    console.log(
      `  ├─ Flows affected:  ${result.flowsAffected.length}   ` +
      (result.flowsAffected.length > 0
        ? `(avg criticality: ${(result.flowsAffected.reduce((s, f) => s + f.criticality, 0) / result.flowsAffected.length).toFixed(2)})`
        : '')
    );
    console.log(
      `  └─ Test gaps:       ${result.testGaps.length}   ` +
      (result.totalAffectedFiles > 0
        ? `(${Math.round((result.testGaps.length / result.totalAffectedFiles) * 100)}% of affected files)`
        : '')
    );

    // Direct dependents
    if (result.directDependents.length > 0) {
      console.log('');
      console.log(chalk.bold('Direct dependents (depth=1):'));
      for (const dep of result.directDependents) {
        const relDep = dep.replace(root + '/', '');
        const comm = result.communitiesAffected.find((c) => c.name);
        const surprise = result.surpriseConnections.find((s) => s.file === dep);
        const surpriseLabel = surprise ? chalk.red('  ← SURPRISE') : '';
        console.log(`  ${relDep}${surpriseLabel}`);
      }
    }

    // Flows affected
    if (result.flowsAffected.length > 0) {
      console.log('');
      console.log(chalk.bold('Flows affected:'));
      for (const flow of result.flowsAffected) {
        const critLabel = flow.criticality >= 0.7 ? chalk.red(' ← HIGH') : '';
        console.log(
          `  ${flow.name.padEnd(25)} crit=${flow.criticality.toFixed(2)}  ` +
          `${flow.stepsAffected} steps affected${critLabel}`
        );
      }
    }

    // Test gaps
    if (result.testGaps.length > 0) {
      console.log('');
      console.log(chalk.bold('Test gaps (no coverage):'));
      for (const gap of result.testGaps.slice(0, 10)) {
        console.log(`  ${gap.replace(root + '/', '')}`);
      }
      if (result.testGaps.length > 10) {
        console.log(chalk.dim(`  ... and ${result.testGaps.length - 10} more`));
      }
    }

    // Surprise connections
    if (result.surpriseConnections.length > 0) {
      console.log('');
      console.log(chalk.bold('Surprise connections:'));
      for (const s of result.surpriseConnections) {
        console.log(
          `  ${s.file.replace(root + '/', '')}  score=${s.score.toFixed(2)}  ${s.reason}`
        );
      }
    }

    console.log(chalk.dim('─'.repeat(60)));

    // Recommendation
    if (result.riskLevel === 'HIGH') {
      console.log(chalk.red.bold('Recommendation: REVIEW before committing'));
      if (result.testGaps.length > 0) {
        console.log(
          chalk.dim(`  ${result.testGaps.length} test gaps detected.`)
        );
      }
    } else if (result.riskLevel === 'MEDIUM') {
      console.log(chalk.yellow('Recommendation: Standard review'));
    } else {
      console.log(chalk.green('Recommendation: Low risk, proceed'));
    }
    console.log('');
  } finally {
    db.close();
  }
}
