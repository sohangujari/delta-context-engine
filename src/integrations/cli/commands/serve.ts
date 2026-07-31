/**
 * `delta serve` — Start the MCP server as an HTTP service.
 *
 * Starts a Streamable HTTP MCP server for universal tool access.
 * Any MCP-compatible client can connect at http://host:port/mcp
 */

import chalk from 'chalk';
import path from 'path';
import http from 'http';
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
  ListPromptsRequestSchema,
  GetPromptRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';
import { initializeDatabase } from '../../../persistence/database.js';
import { TOOL_DEFINITIONS } from '../../claude-code/tool-definitions.js';
import {
  handleGetOptimizedContext,
  handleGetCommunityMap,
  handleGetExecutionFlows,
  handleGetBlastRadius,
  handleGetRiskScores,
  handleGetMemory,
  handleSaveMemory,
  handleSearchCodebase,
  handleGetGraphDiff,
  handleGetHubFiles,
  handleGetBridgeFiles,
  handleGetSnapshot,
  handleSaveSnapshot,
  handleGetStats,
} from '../../claude-code/tool-handlers.js';
import { DeltaDb } from '../../../persistence/delta-db.js';
import { createAllStores } from '../../claude-code/prompts/index.js';
import { buildBlastRadiusPrompt } from '../../claude-code/prompts/blast-radius-prompt.js';
import { buildCodebaseCompassPrompt } from '../../claude-code/prompts/codebase-compass-prompt.js';
import { buildFaultTracerPrompt } from '../../claude-code/prompts/fault-tracer-prompt.js';
import { buildFirstDayPrompt } from '../../claude-code/prompts/first-day-prompt.js';
import { buildMergeGuardianPrompt } from '../../claude-code/prompts/merge-guardian-prompt.js';

export interface ServeOptions {
  root: string;
  port?: string | undefined;
  host?: string | undefined;
}

export async function serveCommand(options: ServeOptions): Promise<void> {
  const root = path.resolve(options.root);
  const port = parseInt(options.port ?? '7734', 10);
  const host = options.host ?? '127.0.0.1';

  await initializeDatabase();

  console.log(chalk.bold('\n∆ Delta MCP Server'));
  console.log(chalk.dim('─'.repeat(45)));

  const server = new Server(
    { name: 'delta-context-engine', version: '2.0.0' },
    { capabilities: { tools: {}, prompts: {} } }
  );

  // ── Register 14 tools ───────────────────────────────────────────────────

  server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: TOOL_DEFINITIONS,
  }));

  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const { name, arguments: args } = request.params;
    const safeArgs: Record<string, unknown> = args ?? {};

    switch (name) {
      case 'get_optimized_context': return await handleGetOptimizedContext(safeArgs, root);
      case 'get_community_map': return await handleGetCommunityMap(safeArgs, root);
      case 'get_execution_flows': return await handleGetExecutionFlows(safeArgs, root);
      case 'get_blast_radius': return await handleGetBlastRadius(safeArgs, root);
      case 'get_risk_scores': return await handleGetRiskScores(safeArgs, root);
      case 'get_memory': return await handleGetMemory(safeArgs, root);
      case 'save_memory': return await handleSaveMemory(safeArgs, root);
      case 'search_codebase': return await handleSearchCodebase(safeArgs, root);
      case 'get_graph_diff': return await handleGetGraphDiff(safeArgs, root);
      case 'get_hub_files': return await handleGetHubFiles(safeArgs, root);
      case 'get_bridge_files': return await handleGetBridgeFiles(safeArgs, root);
      case 'get_snapshot': return await handleGetSnapshot(safeArgs, root);
      case 'save_snapshot': return await handleSaveSnapshot(safeArgs, root);
      case 'get_stats': return await handleGetStats(safeArgs, root);
      default:
        return {
          content: [{ type: 'text' as const, text: `Unknown tool: ${name}` }],
          isError: true,
        };
    }
  });

  // ── Register 5 prompts ──────────────────────────────────────────────────

  server.setRequestHandler(ListPromptsRequestSchema, async () => ({
    prompts: [
      {
        name: 'blast_radius',
        description: 'What does this change break? Impact analysis.',
        arguments: [{ name: 'filePaths', description: 'Comma-separated file paths', required: false }],
      },
      {
        name: 'codebase_compass',
        description: 'Architecture overview of the codebase.',
        arguments: [{ name: 'focusArea', description: 'Area to focus on', required: false }],
      },
      {
        name: 'fault_tracer',
        description: 'Trace error to root cause.',
        arguments: [
          { name: 'errorMessage', description: 'Error or stack trace', required: true },
          { name: 'symptom', description: 'Observed symptom', required: false },
        ],
      },
      {
        name: 'first_day',
        description: 'Onboarding guide for new developers.',
        arguments: [{ name: 'focusArea', description: 'Focus area', required: false }],
      },
      {
        name: 'merge_guardian',
        description: 'PR risk assessment: APPROVE/REVIEW/BLOCK.',
        arguments: [
          { name: 'changedFiles', description: 'Comma-separated changed files', required: false },
          { name: 'branchName', description: 'Branch name', required: false },
        ],
      },
    ],
  }));

  server.setRequestHandler(GetPromptRequestSchema, async (request) => {
    const { name, arguments: promptArgs } = request.params;
    const safeArgs = promptArgs ?? {};
    const db = new DeltaDb(root);
    const stores = createAllStores(db.getDb(), root);

    try {
      let text: string;
      switch (name) {
        case 'blast_radius':
          text = await buildBlastRadiusPrompt({
            filePaths: typeof safeArgs['filePaths'] === 'string'
              ? safeArgs['filePaths'].split(',').map(f => f.trim()) : undefined,
            projectRoot: root,
          }, stores);
          break;
        case 'codebase_compass':
          text = await buildCodebaseCompassPrompt({
            focusArea: typeof safeArgs['focusArea'] === 'string' ? safeArgs['focusArea'] : undefined,
            projectRoot: root,
          }, stores);
          break;
        case 'fault_tracer':
          text = await buildFaultTracerPrompt({
            errorMessage: String(safeArgs['errorMessage'] ?? ''),
            symptom: typeof safeArgs['symptom'] === 'string' ? safeArgs['symptom'] : undefined,
            projectRoot: root,
          }, stores);
          break;
        case 'first_day':
          text = await buildFirstDayPrompt({
            focusArea: typeof safeArgs['focusArea'] === 'string' ? safeArgs['focusArea'] : undefined,
            projectRoot: root,
          }, stores);
          break;
        case 'merge_guardian':
          text = await buildMergeGuardianPrompt({
            changedFiles: typeof safeArgs['changedFiles'] === 'string'
              ? safeArgs['changedFiles'].split(',').map(f => f.trim()) : undefined,
            branchName: typeof safeArgs['branchName'] === 'string' ? safeArgs['branchName'] : undefined,
            projectRoot: root,
          }, stores);
          break;
        default:
          throw new Error(`Unknown prompt: ${name}`);
      }
      db.close();
      return { messages: [{ role: 'user' as const, content: { type: 'text' as const, text } }] };
    } catch (err) {
      db.close();
      throw err;
    }
  });

  // ── HTTP Transport ──────────────────────────────────────────────────────
  // Simple JSON-RPC over HTTP: POST /mcp with JSON body

  const httpServer = http.createServer(async (req, res) => {
    // CORS headers for browser-based MCP clients
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

    if (req.method === 'OPTIONS') {
      res.writeHead(204);
      res.end();
      return;
    }

    if (req.method === 'GET' && req.url === '/health') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({
        status: 'ok',
        server: 'delta-context-engine',
        version: '2.0.0',
        tools: TOOL_DEFINITIONS.length,
        prompts: 5,
      }));
      return;
    }

    if (req.method !== 'POST' || !req.url?.startsWith('/mcp')) {
      res.writeHead(404, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Not found. POST /mcp for MCP requests, GET /health for status.' }));
      return;
    }

    // Read body
    let body = '';
    for await (const chunk of req) {
      body += chunk;
    }

    try {
      const jsonRpcRequest = JSON.parse(body);
      const method = jsonRpcRequest.method;
      const params = jsonRpcRequest.params ?? {};
      const id = jsonRpcRequest.id;

      let result: unknown;

      if (method === 'tools/list') {
        result = { tools: TOOL_DEFINITIONS };
      } else if (method === 'tools/call') {
        const toolName = params.name;
        const toolArgs: Record<string, unknown> = params.arguments ?? {};

        switch (toolName) {
          case 'get_optimized_context': result = await handleGetOptimizedContext(toolArgs, root); break;
          case 'get_community_map': result = await handleGetCommunityMap(toolArgs, root); break;
          case 'get_execution_flows': result = await handleGetExecutionFlows(toolArgs, root); break;
          case 'get_blast_radius': result = await handleGetBlastRadius(toolArgs, root); break;
          case 'get_risk_scores': result = await handleGetRiskScores(toolArgs, root); break;
          case 'get_memory': result = await handleGetMemory(toolArgs, root); break;
          case 'save_memory': result = await handleSaveMemory(toolArgs, root); break;
          case 'search_codebase': result = await handleSearchCodebase(toolArgs, root); break;
          case 'get_graph_diff': result = await handleGetGraphDiff(toolArgs, root); break;
          case 'get_hub_files': result = await handleGetHubFiles(toolArgs, root); break;
          case 'get_bridge_files': result = await handleGetBridgeFiles(toolArgs, root); break;
          case 'get_snapshot': result = await handleGetSnapshot(toolArgs, root); break;
          case 'save_snapshot': result = await handleSaveSnapshot(toolArgs, root); break;
          case 'get_stats': result = await handleGetStats(toolArgs, root); break;
          default:
            result = { content: [{ type: 'text', text: `Unknown tool: ${toolName}` }], isError: true };
        }
      } else {
        result = { error: `Unknown method: ${method}` };
      }

      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ jsonrpc: '2.0', id, result }));
    } catch (err) {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({
        jsonrpc: '2.0',
        error: { code: -32603, message: err instanceof Error ? err.message : String(err) },
      }));
    }
  });

  httpServer.listen(port, host, () => {
    console.log(chalk.green(`\n✓ MCP server running on http://${host}:${port}`));
    console.log(chalk.dim(`  MCP endpoint:  POST http://${host}:${port}/mcp`));
    console.log(chalk.dim(`  Health check:  GET  http://${host}:${port}/health`));
    console.log(chalk.dim(`  Tools: ${TOOL_DEFINITIONS.length} · Prompts: 5`));
    console.log(chalk.dim(`  Project root: ${root}`));
    console.log(chalk.dim('\nPress Ctrl+C to stop.\n'));
  });

  // Keep process alive
  process.on('SIGINT', () => {
    console.log(chalk.dim('\nShutting down...'));
    httpServer.close();
    process.exit(0);
  });
}
