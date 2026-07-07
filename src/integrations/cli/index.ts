#!/usr/bin/env node

import { Command } from 'commander';
import { initCommand } from './commands/init.js';
import { runCommand } from './commands/run.js';
import { statsCommand } from './commands/stats.js';
import { watchCommand } from './commands/watch.js';
import { cursorInitCommand } from './commands/cursor-init.js';
import { reportCommand } from './commands/report.js';
import { includeCommand } from './commands/include.js';
import { excludeCommand } from './commands/exclude.js';
import { repairCommand } from './commands/repair.js';
import { graphCommand } from './commands/graph.js';
import { memoryCommand } from './commands/memory.js';
import { providersCommand } from './commands/providers.js';
import { communitiesCommand } from './commands/communities.js';
import { flowsCommand } from './commands/flows.js';
import { blastCommand } from './commands/blast.js';
import { riskCommand } from './commands/risk.js';
import { hubsCommand } from './commands/hubs.js';
import { snapshotCommand } from './commands/snapshot.js';
import { initializeDatabase } from '../../persistence/database.js';

const program = new Command();

program
  .name('delta')
  .description('∆ Delta Context Engine - Only send what changed.')
  .version('1.0.0');

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

program
  .command('include <file>')
  .description('Force-add a file to the next context payload')
  .option('--root <path>', 'Project root directory', process.cwd())
  .action(async (file: string, options: { root: string }) => {
    await includeCommand(file, options.root);
  });

program
  .command('exclude <file>')
  .description('Force-remove a file from the next context payload')
  .option('--root <path>', 'Project root directory', process.cwd())
  .action(async (file: string, options: { root: string }) => {
    await excludeCommand(file, options.root);
  });

program
  .command('repair')
  .description('Repair corrupt or stale index entries')
  .option('--root <path>', 'Project root directory', process.cwd())
  .action(async (options: { root: string }) => {
    await repairCommand(options.root);
  });

program
  .command('graph <file>')
  .description('Show dependency graph for a file')
  .option('--root <path>', 'Project root directory', process.cwd())
  .option('--depth <n>', 'Max traversal depth', '2')
  .option('--open', 'Open SVG graph in browser')
  .action(
    async (
      file: string,
      options: { root: string; depth: string; open: boolean }
    ) => {
      await graphCommand(file, {
        root: options.root,
        depth: parseInt(options.depth, 10),
        open: options.open ?? false,
      });
    }
  );

program
  .command('memory <subcommand> [args...]')
  .description('Manage persistent memory (list, show, add, forget, search, export, import, stats, confirm)')
  .option('--root <path>', 'Project root directory', process.cwd())
  .option('--type <type>', 'Filter by memory type')
  .option('--confidence <level>', 'Filter by confidence level')
  .allowUnknownOption(true)
  .action(
    async (
      subcommand: string,
      args: string[],
      options: { root: string; type?: string; confidence?: string }
    ) => {
      // Merge --type and --confidence flags into args for the sub-command handler
      const mergedArgs = [...args];
      if (options.type) {
        mergedArgs.push('--type', options.type);
      }
      if (options.confidence) {
        mergedArgs.push('--confidence', options.confidence);
      }
      await memoryCommand(subcommand, mergedArgs, { root: options.root });
    }
  );

program
  .command('providers')
  .description('Show embedding provider status (ollama, openai, azure)')
  .action(async () => {
    await providersCommand();
  });

program
  .command('communities')
  .description('List detected architectural communities')
  .option('-r, --root <path>', 'Project root directory', '.')
  .option('-s, --show <name>', 'Show files in a specific community')
  .option('-v, --verbose', 'Show cohesion and coupling scores')
  .action(async (options: { root?: string; show?: string; verbose?: boolean }) => {
    await communitiesCommand(options);
  });

program
  .command('flows')
  .description('List detected execution flows')
  .option('-r, --root <path>', 'Project root directory', '.')
  .option('-t, --type <type>', 'Filter by entry type (HTTP_ROUTE, CLI_CMD, EVENT, EXPORT, TEST)')
  .option('-s, --show <id>', 'Show full call chain for a flow')
  .option('-f, --file <path>', 'Show flows touching a specific file')
  .action(async (options: { root?: string; type?: string; show?: string; file?: string }) => {
    await flowsCommand(options);
  });

program
  .command('blast <file>')
  .description('Calculate blast radius for a file')
  .option('-r, --root <path>', 'Project root directory', '.')
  .option('-s, --symbol <name>', 'Scope to a specific function')
  .option('-d, --depth <n>', 'Max traversal depth', '5')
  .action(async (file: string, options: { root?: string; symbol?: string; depth?: string }) => {
    await blastCommand(file, options);
  });

program
  .command('risk')
  .description('Show file risk scores (5 dimensions)')
  .option('-r, --root <path>', 'Project root directory', '.')
  .option('-a, --all', 'Show all files including LOW risk')
  .option('-f, --file <path>', 'Show dimension breakdown for one file')
  .action(async (options: { root?: string; all?: boolean; file?: string }) => {
    await riskCommand(options);
  });

program
  .command('hubs')
  .description('Show architectural hubs, bridges, and surprise connections')
  .option('-r, --root <path>', 'Project root directory', '.')
  .option('-b, --bridges', 'Show bridge files (architectural chokepoints)')
  .option('-s, --surprise', 'Show high surprise-coupling files')
  .option('-a, --all', 'Show all metrics')
  .action(async (options: { root?: string; bridges?: boolean; surprise?: boolean; all?: boolean }) => {
    await hubsCommand(options);
  });

program
  .command('snapshot <subcommand> [args...]')
  .description('Manage graph snapshots (save, list, diff, delete)')
  .option('-r, --root <path>', 'Project root directory', '.')
  .option('-n, --notes <text>', 'Notes for the snapshot')
  .action(async (subcommand: string, args: string[], options: { root?: string; notes?: string }) => {
    await snapshotCommand(subcommand, args, options);
  });

// Initialize sql.js WASM engine, then parse CLI commands
(async () => {
  await initializeDatabase();
  program.parse();
})();