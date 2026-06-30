import chalk from 'chalk';
import path from 'path';
import { DeltaDb } from '../../../persistence/delta-db.js';
import { RiskStore } from '../../../persistence/risk-store.js';

export async function riskCommand(
  options: { root?: string; all?: boolean; file?: string; community?: string }
): Promise<void> {
  const root = path.resolve(options.root ?? '.');
  const db = new DeltaDb(root);
  const riskStore = new RiskStore(db.getDb());

  try {
    // Show specific file breakdown
    if (options.file) {
      const filePath = path.resolve(options.file);
      const score = riskStore.get(filePath);

      if (!score) {
        console.log(chalk.yellow(`\n⚠ No risk score for ${options.file}. Run delta init first.\n`));
        return;
      }

      const relPath = filePath.replace(root + '/', '');
      const riskColor =
        score.riskLevel === 'HIGH' ? chalk.red :
        score.riskLevel === 'MEDIUM' ? chalk.yellow :
        chalk.green;

      console.log(chalk.bold(`\n∆ Risk Score: ${relPath}`));
      console.log(chalk.dim('─'.repeat(60)));
      console.log(`Overall:  ${riskColor(score.riskLevel)} (${score.overallScore.toFixed(2)})`);
      console.log('');
      console.log(chalk.bold('Dimensions:'));
      console.log(`  Security:         ${formatBar(score.dimensions.security)}  ${score.dimensions.security.toFixed(2)}`);
      console.log(`  Test coverage:    ${formatBar(score.dimensions.testCoverage)}  ${score.dimensions.testCoverage.toFixed(2)}`);
      console.log(`  Cross-community:  ${formatBar(score.dimensions.crossCommunity)}  ${score.dimensions.crossCommunity.toFixed(2)}`);
      console.log(`  Flow participation: ${formatBar(score.dimensions.flowParticipation)}  ${score.dimensions.flowParticipation.toFixed(2)}`);
      console.log(`  Surprise coupling:  ${formatBar(score.dimensions.surpriseCoupling)}  ${score.dimensions.surpriseCoupling.toFixed(2)}`);
      console.log(chalk.dim('─'.repeat(60)));
      console.log('');
      return;
    }

    // Get scores
    const allScores = riskStore.getAll();

    if (allScores.length === 0) {
      console.log(chalk.yellow('\n⚠ No risk scores calculated. Run delta init first.\n'));
      return;
    }

    console.log(chalk.bold('\n∆ Delta — Risk Scores'));
    console.log(chalk.dim('─'.repeat(70)));

    const highRisk = allScores.filter((s) => s.riskLevel === 'HIGH');
    const medRisk = allScores.filter((s) => s.riskLevel === 'MEDIUM');
    const lowRisk = allScores.filter((s) => s.riskLevel === 'LOW');

    if (highRisk.length > 0) {
      console.log(chalk.red.bold('HIGH RISK FILES:'));
      for (const s of highRisk) {
        const relPath = s.filePath.replace(root + '/', '');
        console.log(
          `  ${relPath.padEnd(40)} ${s.overallScore.toFixed(2)}  ` +
          chalk.dim(
            `sec=${s.dimensions.security.toFixed(1)} test=${s.dimensions.testCoverage.toFixed(1)} ` +
            `cross=${s.dimensions.crossCommunity.toFixed(1)} flow=${s.dimensions.flowParticipation.toFixed(1)} ` +
            `surp=${s.dimensions.surpriseCoupling.toFixed(1)}`
          )
        );
      }
      console.log('');
    }

    if (medRisk.length > 0) {
      console.log(chalk.yellow.bold('MEDIUM RISK FILES:'));
      for (const s of medRisk.slice(0, options.all ? medRisk.length : 5)) {
        const relPath = s.filePath.replace(root + '/', '');
        console.log(`  ${relPath.padEnd(40)} ${s.overallScore.toFixed(2)}`);
      }
      if (!options.all && medRisk.length > 5) {
        console.log(chalk.dim(`  ... and ${medRisk.length - 5} more (use --all)`));
      }
      console.log('');
    }

    if (options.all && lowRisk.length > 0) {
      console.log(chalk.green.bold('LOW RISK FILES:'));
      for (const s of lowRisk) {
        const relPath = s.filePath.replace(root + '/', '');
        console.log(`  ${relPath.padEnd(40)} ${s.overallScore.toFixed(2)}`);
      }
      console.log('');
    } else if (lowRisk.length > 0) {
      console.log(
        chalk.dim(`LOW RISK FILES: ${lowRisk.length} files (hidden, use --all to show)`)
      );
      console.log('');
    }

    console.log(chalk.dim('─'.repeat(70)));
    console.log(
      `${chalk.red(String(highRisk.length))} HIGH · ` +
      `${chalk.yellow(String(medRisk.length))} MEDIUM · ` +
      `${chalk.green(String(lowRisk.length))} LOW`
    );
    console.log('');
  } finally {
    db.close();
  }
}

function formatBar(value: number): string {
  const filled = Math.round(value * 10);
  const empty = 10 - filled;
  const bar = '█'.repeat(filled) + '░'.repeat(empty);
  if (value >= 0.7) return chalk.red(bar);
  if (value >= 0.4) return chalk.yellow(bar);
  return chalk.green(bar);
}
