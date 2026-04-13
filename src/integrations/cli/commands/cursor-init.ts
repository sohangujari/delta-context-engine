import chalk from 'chalk';
import fs from 'fs';
import path from 'path';
import { setupCursorIntegration } from '../../cursor/rules-injector.js';

export async function cursorInitCommand(projectRoot: string): Promise<void> {
  const root = path.resolve(projectRoot);

  console.log(chalk.bold('\n∆ Delta — Cursor Integration'));
  console.log(chalk.dim('─'.repeat(45)));

  // Check Delta is initialized
  const deltaConfigPath = path.join(root, '.delta', 'config.json');
  if (!fs.existsSync(deltaConfigPath)) {
    console.log(chalk.red('✗ Delta not initialized. Run: delta init'));
    return;
  }

  // Set up Cursor integration
  const result = setupCursorIntegration(root);

  if (result.cursorDetected) {
    console.log(chalk.green('✓ Cursor project detected (.cursor/ exists)'));
  } else {
    console.log(chalk.yellow('⚠ No .cursor/ directory found — created it'));
    console.log(chalk.dim('  Install Cursor from: https://cursor.sh'));
  }

  console.log(chalk.green(`✓ Rules written to ${result.rulesPath}`));

  console.log('');
  console.log(chalk.bold('How to use Delta with Cursor:'));
  console.log('');
  console.log(
    `  ${chalk.cyan('1.')} Run ${chalk.cyan('delta run "your task"')} in terminal before asking Cursor`
  );
  console.log(
    `  ${chalk.cyan('2.')} Delta writes optimized context to ${chalk.cyan('.delta/cursor-context.md')}`
  );
  console.log(
    `  ${chalk.cyan('3.')} Cursor reads the rules and uses the context file automatically`
  );
  console.log('');
  console.log(chalk.dim('─'.repeat(45)));
  console.log(chalk.bold.green('✓ Cursor integration ready'));
  console.log('');
}