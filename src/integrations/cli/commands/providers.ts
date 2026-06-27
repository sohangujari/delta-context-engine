import chalk from 'chalk';
import ora from 'ora';
import { checkAllProviders } from '../../../core/embeddings/provider.js';
import { getActiveProvider, checkProviderAvailable } from '../../../core/embeddings/embedder.js';

export async function providersCommand(): Promise<void> {
  console.log(chalk.bold('\n∆ Embedding Providers'));
  console.log(chalk.dim('─'.repeat(45)));
  console.log('');

  // Show active provider
  const spinner = ora('Checking providers...').start();
  const activeCheck = await checkProviderAvailable();
  spinner.stop();

  const active = getActiveProvider();
  console.log(
    chalk.bold('Active: ') +
    chalk.cyan(active.name) +
    chalk.dim(` (model: ${active.model})`) +
    (activeCheck.available
      ? chalk.green(' ✓ ready')
      : chalk.red(` ✗ ${activeCheck.reason ?? 'unavailable'}`))
  );
  console.log('');

  // Show all providers
  console.log(chalk.bold('All Providers:'));
  console.log('');

  const allProviders = await checkAllProviders();

  for (const p of allProviders) {
    const isActive = p.name === active.name;
    const statusIcon = p.available ? chalk.green('✓') : chalk.red('✗');
    const activeMarker = isActive ? chalk.cyan(' ← active') : '';

    console.log(
      `  ${statusIcon} ${chalk.bold(p.name.padEnd(10))} model: ${chalk.dim(p.model)}${activeMarker}`
    );

    if (!p.available && p.reason) {
      console.log(`    ${chalk.dim(p.reason)}`);
    }
  }

  console.log('');
  console.log(chalk.dim('─'.repeat(45)));
  console.log(chalk.dim('To switch provider, edit .delta/config.json → embeddings.provider'));
  console.log(chalk.dim('Options: ollama (default), openai, azure'));
  console.log('');
}
