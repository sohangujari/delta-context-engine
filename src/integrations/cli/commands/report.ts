import chalk from 'chalk';
import fs from 'fs';
import path from 'path';
import { DeltaDb } from '../../../persistence/delta-db.js';
import { SessionManager } from '../../../core/session/session-manager.js';

export async function reportCommand(
  projectRoot: string,
  options: { markdown?: boolean; weekly?: boolean }
): Promise<void> {
  const root = path.resolve(projectRoot);

  console.log(chalk.bold('\n∆ Delta - Session Report'));
  console.log(chalk.dim('─'.repeat(45)));

  const db = new DeltaDb(root);
  const session = new SessionManager(db.getDb());

  try {
    const weekly = session.getWeeklySummary();
    const allTime = session.getAllTimeSummary();
    const recent = session.getRecentTasks(5);

    // ── Terminal output ─────────────────────────────────────────

    console.log(chalk.bold('This Week'));
    console.log(
      `  Tasks completed:   ${chalk.cyan(weekly.taskCount.toString())}`
    );
    console.log(
      `  Tokens used:       ${chalk.cyan(weekly.totalOptimizedTokens.toLocaleString())}`
    );
    console.log(
      `  Tokens saved:      ${chalk.cyan(weekly.totalSavedTokens.toLocaleString())}`
    );
    console.log(
      `  Avg reduction:     ${chalk.cyan(weekly.avgReductionPercent + '%')}`
    );

    // Weekly budget bar
    const budgetUsedPct = Math.min(
      100,
      Math.round((weekly.totalOptimizedTokens / weekly.weeklyBudget) * 100)
    );
    const barWidth = 30;
    const filled = Math.round((budgetUsedPct / 100) * barWidth);
    const bar =
      chalk.cyan('█'.repeat(filled)) +
      chalk.dim('░'.repeat(barWidth - filled));

    console.log('');
    console.log(`  Weekly budget:     ${bar} ${budgetUsedPct}%`);
    console.log(
      `  Est. tasks left:   ${chalk.cyan(weekly.estimatedTasksRemaining.toString())} at current rate`
    );

    console.log('');
    console.log(chalk.bold('All Time'));
    console.log(
      `  Total tasks:       ${chalk.cyan(allTime.totalTasks.toString())}`
    );
    console.log(
      `  Total saved:       ${chalk.cyan(allTime.totalSavedTokens.toLocaleString())} tokens`
    );
    console.log(
      `  Avg reduction:     ${chalk.cyan(allTime.avgReductionPercent + '%')}`
    );

    if (recent.length > 0) {
      console.log('');
      console.log(chalk.bold('Recent Tasks'));
      for (const task of recent) {
        const time = new Date(task.completedAt).toLocaleTimeString();
        const instruction =
          task.instruction.length > 35
            ? task.instruction.slice(0, 35) + '...'
            : task.instruction;
        console.log(
          `  ${chalk.dim(time)}  ${instruction.padEnd(38)} ` +
          chalk.dim(`${task.reductionPercent}% · ${task.optimizedTokens.toLocaleString()} tok`)
        );
      }
    }

    console.log(chalk.dim('─'.repeat(45)));

    // ── Markdown export ─────────────────────────────────────────
    if (options.markdown) {
      const md = generateMarkdownReport(weekly, allTime, recent);
      const reportsDir = path.join(root, '.delta', 'reports');
      fs.mkdirSync(reportsDir, { recursive: true });

      const filename = `report-${new Date().toISOString().split('T')[0]}.md`;
      const reportPath = path.join(reportsDir, filename);
      fs.writeFileSync(reportPath, md, 'utf-8');

      console.log(
        chalk.green(`\n✓ Report saved: .delta/reports/${filename}`)
      );
    }
  } finally {
    db.close();
  }
}

function generateMarkdownReport(
  weekly: ReturnType<SessionManager['getWeeklySummary']>,
  allTime: ReturnType<SessionManager['getAllTimeSummary']>,
  recent: ReturnType<SessionManager['getRecentTasks']>
): string {
  const date = new Date().toLocaleDateString('en-US', {
    weekday: 'long',
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  });

  const lines = [
    '# ∆ Delta Context Engine - Report',
    '',
    `**Generated:** ${date}`,
    '',
    '## This Week',
    '',
    `| Metric | Value |`,
    `|--------|-------|`,
    `| Tasks completed | ${weekly.taskCount} |`,
    `| Tokens used | ${weekly.totalOptimizedTokens.toLocaleString()} |`,
    `| Tokens saved | ${weekly.totalSavedTokens.toLocaleString()} |`,
    `| Avg reduction | ${weekly.avgReductionPercent}% |`,
    `| Weekly budget used | ${Math.round((weekly.totalOptimizedTokens / weekly.weeklyBudget) * 100)}% |`,
    `| Est. tasks remaining | ~${weekly.estimatedTasksRemaining} |`,
    '',
    '## All Time',
    '',
    `| Metric | Value |`,
    `|--------|-------|`,
    `| Total tasks | ${allTime.totalTasks} |`,
    `| Total tokens saved | ${allTime.totalSavedTokens.toLocaleString()} |`,
    `| Avg reduction | ${allTime.avgReductionPercent}% |`,
    '',
  ];

  if (recent.length > 0) {
    lines.push('## Recent Tasks');
    lines.push('');
    lines.push('| Time | Task | Reduction | Tokens |');
    lines.push('|------|------|-----------|--------|');
    for (const task of recent) {
      const time = new Date(task.completedAt).toLocaleTimeString();
      const instruction =
        task.instruction.length > 40
          ? task.instruction.slice(0, 40) + '...'
          : task.instruction;
      lines.push(
        `| ${time} | ${instruction} | ${task.reductionPercent}% | ${task.optimizedTokens.toLocaleString()} |`
      );
    }
    lines.push('');
  }

  lines.push('---');
  lines.push('*Generated by [∆ Delta Context Engine](https://github.com/sohangujari/delta-context-engine)*');

  return lines.join('\n');
}