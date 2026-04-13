#!/usr/bin/env node

import { Command } from 'commander';
import { initCommand } from './commands/init.js';
import { runCommand } from './commands/run.js';
import { statsCommand } from './commands/stats.js';
import { watchCommand } from './commands/watch.js';
import { cursorInitCommand } from './commands/cursor-init.js';
import { reportCommand } from './commands/report.js';

const program = new Command();

program
  .name('delta')
  .description('∆ Delta Context Engine — Only send what changed.')
  .version('0.1.0');

program
  .command('init')
  .description('Index your codebase and initialize Delta')
  .option('--root <path>', 'Project root directory', process.cwd())
  .action(async (options: { root: string }) => {
    await initCommand(options.root);
  });

program
  .command('run <task>')
  .description('Assemble optimized context for a task')
  .option('--root <path>', 'Project root directory', process.cwd())
  .option('--budget <tokens>', 'Token budget override', '2000')
  .option('--verbose', 'Show manifest and payload preview')
  .action(
    async (
      task: string,
      options: { root: string; budget: string; verbose: boolean }
    ) => {
      await runCommand(task, {
        root: options.root,
        budget: parseInt(options.budget, 10),
        verbose: options.verbose ?? false,
      });
    }
  );

program
  .command('stats')
  .description('Show index statistics')
  .option('--root <path>', 'Project root directory', process.cwd())
  .action(async (options: { root: string }) => {
    await statsCommand(options.root);
  });

program
  .command('watch')
  .description('Watch for file changes and update index automatically')
  .option('--root <path>', 'Project root directory', process.cwd())
  .action(async (options: { root: string }) => {
    await watchCommand(options.root);
  });

program
  .command('cursor-init')
  .description('Set up Delta integration for Cursor editor')
  .option('--root <path>', 'Project root directory', process.cwd())
  .action(async (options: { root: string }) => {
    await cursorInitCommand(options.root);
  });

program
  .command('mcp')
  .description('Start Delta MCP server for Claude Code integration')
  .action(async () => {
    await import('../../integrations/claude-code/mcp-server.js');
  });

program
  .command('report')
  .description('Show session report and token savings')
  .option('--root <path>', 'Project root directory', process.cwd())
  .option('--markdown', 'Export report as Markdown to .delta/reports/')
  .option('--weekly', 'Show weekly summary only')
  .action(
    async (options: { root: string; markdown?: boolean; weekly?: boolean }) => {
      await reportCommand(options.root, {
        ...(options.markdown !== undefined && { markdown: options.markdown }),
        ...(options.weekly !== undefined && { weekly: options.weekly }),
      });
    }
  );

program.parse();