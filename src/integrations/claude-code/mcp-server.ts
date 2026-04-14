import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';
import path from 'path';
import { loadConfig } from '../../config/delta.config.js';
import { loadIgnorePatterns } from '../../config/deltaignore.js';
import { classifyFiles } from '../../core/change-detector/state-classifier.js';
import { walkDirectory } from '../../core/change-detector/hash-tracker.js';
import { traverseFromChanged } from '../../core/graph/traverser.js';
import { queryByTask } from '../../core/embeddings/query.js';
import { scoreAllFiles, buildSemanticScoreMap } from '../../core/relevance/scorer.js';
import { rankForContext } from '../../core/relevance/ranker.js';
import { assembleContext } from '../../core/assembler/context-builder.js';
import { DeltaDb } from '../../persistence/delta-db.js';
import { GraphStore } from '../../persistence/graph-store.js';
import { StateStore } from '../../persistence/state-store.js';
import { SymbolStore } from '../../persistence/symbol-store.js';
import { VectorStore } from '../../core/embeddings/vector-store.js';

const PROJECT_ROOT = process.cwd();

/**
 * Delta MCP Server
 *
 * Exposes one tool: get_optimized_context
 * Claude Code calls this before every task.
 * Returns the optimized context payload as a string.
 *
 * Usage in .claude/settings.json:
 * {
 *   "mcpServers": {
 *     "delta": {
 *       "command": "npx",
 *       "args": ["delta-ctx", "mcp"]
 *     }
 *   }
 * }
 */
async function runMcpServer(): Promise<void> {
  const server = new Server(
    {
      name: 'delta-context-engine',
      version: '0.1.0',
    },
    {
      capabilities: {
        tools: {},
      },
    }
  );

  // ── Tool: get_optimized_context ─────────────────────────────────
  server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: [
      {
        name: 'get_optimized_context',
        description:
          'Returns token-optimized context for the current task. ' +
          'Detects changed files, traces dependencies, and assembles ' +
          'a minimal context payload. Use this before every coding task ' +
          'to reduce token usage by 75-90%.',
        inputSchema: {
          type: 'object' as const,
          properties: {
            task: {
              type: 'string',
              description: 'The task instruction or question',
            },
            budget: {
              type: 'number',
              description: 'Token budget (default: 2000)',
            },
            projectRoot: {
              type: 'string',
              description: 'Project root path (default: current directory)',
            },
          },
          required: ['task'],
        },
      },
      {
        name: 'get_delta_stats',
        description: 'Returns Delta index statistics for the current project.',
        inputSchema: {
          type: 'object' as const,
          properties: {
            projectRoot: {
              type: 'string',
              description: 'Project root path (default: current directory)',
            },
          },
        },
      },
    ],
  }));

  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const { name, arguments: args } = request.params;

    // args can be undefined if no arguments passed - default to empty object
    const safeArgs: Record<string, unknown> = args ?? {};

    if (name === 'get_optimized_context') {
      return await handleGetOptimizedContext(safeArgs);
    }

    if (name === 'get_delta_stats') {
      return await handleGetDeltaStats(safeArgs);
    }

    return {
      content: [{ type: 'text' as const, text: `Unknown tool: ${name}` }],
      isError: true,
    };
  });

  // ── Start server ─────────────────────────────────────────────────
  const transport = new StdioServerTransport();
  await server.connect(transport);

  // Server runs until process exits
}

// ── Tool handlers ─────────────────────────────────────────────────────────────

async function handleGetOptimizedContext(
  args: Record<string, unknown>
): Promise<{ content: Array<{ type: 'text'; text: string }> }> {
  const task = String(args['task'] ?? '');
  const budget = typeof args['budget'] === 'number' ? args['budget'] : 2000;
  const projectRoot = typeof args['projectRoot'] === 'string'
    ? args['projectRoot']
    : PROJECT_ROOT;

  const root = path.resolve(projectRoot);

  let db: DeltaDb | null = null;

  try {
    db = new DeltaDb(root);
    const config = loadConfig(root);
    const tokenBudget = budget ?? config.budget.maxTokens;

    const stateStore = new StateStore(db.getDb());
    const graphStore = new GraphStore(db.getDb());
    const symbolStore = new SymbolStore(db.getDb());
    const vectorStore = new VectorStore(db.getDb());
    const ignorePatterns = loadIgnorePatterns(root);

    // ── 4-layer pipeline ────────────────────────────────────────
    const allFiles = walkDirectory(root, root, ignorePatterns);
    const classification = await classifyFiles(root, stateStore, allFiles);

    if (classification.changedCount === 0) {
      return {
        content: [{
          type: 'text',
          text: [
            '∆ DELTA: No changes detected.',
            'All files are identical to the last indexed state.',
            'Using graph-only context for this task.',
            '',
            `Task: ${task}`,
          ].join('\n'),
        }],
      };
    }

    const changedPaths = classification.changed.map((f) => f.path);
    const traversal = traverseFromChanged(
      changedPaths,
      graphStore,
      root,
      config.graph.maxDepth
    );

    const queryResult = await queryByTask(
      { task, projectRoot: root, threshold: config.relevance.semanticThreshold },
      vectorStore,
      symbolStore
    );

    const semanticScoreMap = queryResult.embeddingsAvailable
      ? buildSemanticScoreMap(queryResult.scored)
      : new Map<string, number>();

    const scores = scoreAllFiles(traversal, semanticScoreMap, {
      semanticThreshold: config.relevance.semanticThreshold,
      maxDepth: config.graph.maxDepth,
    });
    const ranked = rankForContext(scores);

    const rankedTraversal = {
      ...traversal,
      touched: ranked.touched.map((s) => ({
        path: s.filePath,
        relativePath: s.relativePath,
        state: 'TOUCHED' as const,
        depth: 1,
      })),
      ancestors: ranked.ancestors.map((s) => ({
        path: s.filePath,
        relativePath: s.relativePath,
        state: 'ANCESTOR' as const,
        depth: 2,
      })),
    };

    const payload = await assembleContext({
      task,
      traversal: rankedTraversal,
      projectRoot: root,
      tokenBudget,
      allProjectFiles: allFiles,
    });

    // Format response for Claude
    const response = [
      payload.formatted,
      '',
      '---',
      `∆ Delta: ${payload.savings.optimizedTokens} tokens sent`,
      `(saved ${payload.savings.savedTokens.toLocaleString()} · ${payload.savings.reductionPercent}% reduction · ${payload.savings.reductionMultiple}× fewer)`,
    ].join('\n');

    return {
      content: [{ type: 'text', text: response }],
    };

  } catch (err) {
    const error = err instanceof Error ? err.message : String(err);

    // Never crash Claude Code - return a safe fallback message
    return {
      content: [{
        type: 'text',
        text: [
          `∆ Delta error: ${error}`,
          'Falling back to unoptimized context.',
          'Run: delta init to rebuild the index.',
        ].join('\n'),
      }],
    };
  } finally {
    db?.close();
  }
}

async function handleGetDeltaStats(
  args: Record<string, unknown>
): Promise<{ content: Array<{ type: 'text'; text: string }> }> {
  const projectRoot = typeof args['projectRoot'] === 'string'
    ? args['projectRoot']
    : PROJECT_ROOT;

  const root = path.resolve(projectRoot);
  let db: DeltaDb | null = null;

  try {
    db = new DeltaDb(root);
    const stateStore = new StateStore(db.getDb());
    const graphStore = new GraphStore(db.getDb());
    const vectorStore = new VectorStore(db.getDb());

    const files = stateStore.getAll();
    const edges = graphStore.getAllEdges();
    const embeddingCount = vectorStore.count();

    const totalRawTokens = files.reduce((s, f) => s + f.tokenCount, 0);
    const totalSymbolTokens = files.reduce((s, f) => s + f.symbolTokenCount, 0);
    const avgReduction = totalRawTokens > 0
      ? Math.round((1 - totalSymbolTokens / totalRawTokens) * 100)
      : 0;

    const stats = [
      '∆ Delta Index Stats',
      `Files indexed:    ${files.length}`,
      `Dependency edges: ${edges.length}`,
      `Embeddings:       ${embeddingCount}`,
      `Total raw tokens: ${totalRawTokens.toLocaleString()}`,
      `Avg compression:  ${avgReduction}%`,
    ].join('\n');

    return {
      content: [{ type: 'text', text: stats }],
    };

  } catch (err) {
    const error = err instanceof Error ? err.message : String(err);
    return {
      content: [{ type: 'text', text: `∆ Delta stats error: ${error}` }],
    };
  } finally {
    db?.close();
  }
}

// Entry point
runMcpServer().catch((err) => {
  process.stderr.write(`Delta MCP Server error: ${err}\n`);
  process.exit(1);
});