/**
 * Delta MCP Server — Streamable HTTP (primary) + stdio (fallback).
 *
 * 14 tools + 5 prompts covering all Phase 1-3 intelligence.
 *
 * HTTP: delta serve (default port 7734)
 * stdio: DELTA_MCP_TRANSPORT=stdio npx delta-ctx mcp
 */

import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
  ListPromptsRequestSchema,
  GetPromptRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';
import http from 'http';
import path from 'path';
import { initializeDatabase } from '../../persistence/database.js';
import { TOOL_DEFINITIONS } from './tool-definitions.js';
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
} from './tool-handlers.js';
import { DeltaDb } from '../../persistence/delta-db.js';
import { createAllStores } from './prompts/index.js';
import { buildBlastRadiusPrompt } from './prompts/blast-radius-prompt.js';
import { buildCodebaseCompassPrompt } from './prompts/codebase-compass-prompt.js';
import { buildFaultTracerPrompt } from './prompts/fault-tracer-prompt.js';
import { buildFirstDayPrompt } from './prompts/first-day-prompt.js';
import { buildMergeGuardianPrompt } from './prompts/merge-guardian-prompt.js';

const PROJECT_ROOT = process.cwd();

async function createMcpServer(): Promise<Server> {
  await initializeDatabase();

  const server = new Server(
    { name: 'delta-context-engine', version: '1.3.0' },
    { capabilities: { tools: {}, prompts: {} } }
  );

  // ── 14 Tools ────────────────────────────────────────────────────────────────

  server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: TOOL_DEFINITIONS,
  }));

  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const { name, arguments: args } = request.params;
    const safeArgs: Record<string, unknown> = args ?? {};

    switch (name) {
      case 'get_optimized_context': return await handleGetOptimizedContext(safeArgs, PROJECT_ROOT);
      case 'get_community_map': return await handleGetCommunityMap(safeArgs, PROJECT_ROOT);
      case 'get_execution_flows': return await handleGetExecutionFlows(safeArgs, PROJECT_ROOT);
      case 'get_blast_radius': return await handleGetBlastRadius(safeArgs, PROJECT_ROOT);
      case 'get_risk_scores': return await handleGetRiskScores(safeArgs, PROJECT_ROOT);
      case 'get_memory': return await handleGetMemory(safeArgs, PROJECT_ROOT);
      case 'save_memory': return await handleSaveMemory(safeArgs, PROJECT_ROOT);
      case 'search_codebase': return await handleSearchCodebase(safeArgs, PROJECT_ROOT);
      case 'get_graph_diff': return await handleGetGraphDiff(safeArgs, PROJECT_ROOT);
      case 'get_hub_files': return await handleGetHubFiles(safeArgs, PROJECT_ROOT);
      case 'get_bridge_files': return await handleGetBridgeFiles(safeArgs, PROJECT_ROOT);
      case 'get_snapshot': return await handleGetSnapshot(safeArgs, PROJECT_ROOT);
      case 'save_snapshot': return await handleSaveSnapshot(safeArgs, PROJECT_ROOT);
      case 'get_stats': return await handleGetStats(safeArgs, PROJECT_ROOT);
      default:
        return {
          content: [{ type: 'text' as const, text: `Unknown tool: ${name}` }],
          isError: true,
        };
    }
  });

  // ── 5 Prompts ───────────────────────────────────────────────────────────────

  server.setRequestHandler(ListPromptsRequestSchema, async () => ({
    prompts: [
      {
        name: 'blast_radius',
        description: 'What does this change break? Impact analysis for changed files.',
        arguments: [
          { name: 'filePaths', description: 'Comma-separated file paths (uses git diff if omitted)', required: false },
        ],
      },
      {
        name: 'codebase_compass',
        description: 'Show me how this codebase is structured. Architecture overview.',
        arguments: [
          { name: 'focusArea', description: 'Community name or area to focus on', required: false },
        ],
      },
      {
        name: 'fault_tracer',
        description: 'Trace this error to its root cause. Debug assistance.',
        arguments: [
          { name: 'errorMessage', description: 'Error message or stack trace', required: true },
          { name: 'symptom', description: 'What you observed going wrong', required: false },
        ],
      },
      {
        name: 'first_day',
        description: 'Get a new developer productive in minutes. Onboarding guide.',
        arguments: [
          { name: 'focusArea', description: 'Area to focus on (e.g. "payments")', required: false },
        ],
      },
      {
        name: 'merge_guardian',
        description: 'Is this PR safe to merge? Risk assessment and recommendation.',
        arguments: [
          { name: 'changedFiles', description: 'Comma-separated changed files (uses git diff if omitted)', required: false },
          { name: 'branchName', description: 'Branch or PR name for labeling', required: false },
        ],
      },
    ],
  }));

  server.setRequestHandler(GetPromptRequestSchema, async (request) => {
    const { name, arguments: promptArgs } = request.params;
    const safeArgs = promptArgs ?? {};

    const db = new DeltaDb(PROJECT_ROOT);
    const stores = createAllStores(db.getDb(), PROJECT_ROOT);

    try {
      let text: string;

      switch (name) {
        case 'blast_radius':
          text = await buildBlastRadiusPrompt({
            filePaths: typeof safeArgs['filePaths'] === 'string'
              ? safeArgs['filePaths'].split(',').map(f => f.trim()) : undefined,
            projectRoot: PROJECT_ROOT,
          }, stores);
          break;

        case 'codebase_compass':
          text = await buildCodebaseCompassPrompt({
            focusArea: typeof safeArgs['focusArea'] === 'string' ? safeArgs['focusArea'] : undefined,
            projectRoot: PROJECT_ROOT,
          }, stores);
          break;

        case 'fault_tracer':
          text = await buildFaultTracerPrompt({
            errorMessage: String(safeArgs['errorMessage'] ?? ''),
            symptom: typeof safeArgs['symptom'] === 'string' ? safeArgs['symptom'] : undefined,
            projectRoot: PROJECT_ROOT,
          }, stores);
          break;

        case 'first_day':
          text = await buildFirstDayPrompt({
            focusArea: typeof safeArgs['focusArea'] === 'string' ? safeArgs['focusArea'] : undefined,
            projectRoot: PROJECT_ROOT,
          }, stores);
          break;

        case 'merge_guardian':
          text = await buildMergeGuardianPrompt({
            changedFiles: typeof safeArgs['changedFiles'] === 'string'
              ? safeArgs['changedFiles'].split(',').map(f => f.trim()) : undefined,
            branchName: typeof safeArgs['branchName'] === 'string' ? safeArgs['branchName'] : undefined,
            projectRoot: PROJECT_ROOT,
          }, stores);
          break;

        default:
          throw new Error(`Unknown prompt: ${name}`);
      }

      db.close();
      return {
        messages: [{ role: 'user' as const, content: { type: 'text' as const, text } }],
      };
    } catch (err) {
      db.close();
      throw err;
    }
  });

  return server;
}

/**
 * Start MCP server over stdio transport (for Claude Code).
 */
async function runMcpServer(): Promise<void> {
  const server = await createMcpServer();
  const transport = new StdioServerTransport();
  await server.connect(transport);
}

/**
 * Start MCP server over HTTP transport (for universal tool access).
 */
async function runMcpHttpServer(
  options: { port?: number; host?: string } = {}
): Promise<void> {
  const server = await createMcpServer();
  const port = options.port ?? 7734;
  const host = options.host ?? '127.0.0.1';

  // Register tools/prompts are already set on the server from createMcpServer.
  // Build HTTP server that dispatches JSON-RPC to the MCP server.
  const httpServer = http.createServer(async (req, res) => {
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
        status: 'ok', server: 'delta-context-engine', version: '1.3.0',
        tools: TOOL_DEFINITIONS.length, prompts: 5, transport: 'http',
      }));
      return;
    }

    if (req.method !== 'POST' || !req.url?.startsWith('/mcp')) {
      res.writeHead(404, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'POST /mcp for MCP requests, GET /health for status.' }));
      return;
    }

    let body = '';
    for await (const chunk of req) { body += chunk; }

    try {
      const jsonRpc = JSON.parse(body);
      const method = jsonRpc.method;
      const params = jsonRpc.params ?? {};
      const id = jsonRpc.id;
      let result: unknown;

      if (method === 'tools/list') {
        result = { tools: TOOL_DEFINITIONS };
      } else if (method === 'tools/call') {
        const toolName = params.name;
        const toolArgs: Record<string, unknown> = params.arguments ?? {};
        switch (toolName) {
          case 'get_optimized_context': result = await handleGetOptimizedContext(toolArgs, PROJECT_ROOT); break;
          case 'get_community_map': result = await handleGetCommunityMap(toolArgs, PROJECT_ROOT); break;
          case 'get_execution_flows': result = await handleGetExecutionFlows(toolArgs, PROJECT_ROOT); break;
          case 'get_blast_radius': result = await handleGetBlastRadius(toolArgs, PROJECT_ROOT); break;
          case 'get_risk_scores': result = await handleGetRiskScores(toolArgs, PROJECT_ROOT); break;
          case 'get_memory': result = await handleGetMemory(toolArgs, PROJECT_ROOT); break;
          case 'save_memory': result = await handleSaveMemory(toolArgs, PROJECT_ROOT); break;
          case 'search_codebase': result = await handleSearchCodebase(toolArgs, PROJECT_ROOT); break;
          case 'get_graph_diff': result = await handleGetGraphDiff(toolArgs, PROJECT_ROOT); break;
          case 'get_hub_files': result = await handleGetHubFiles(toolArgs, PROJECT_ROOT); break;
          case 'get_bridge_files': result = await handleGetBridgeFiles(toolArgs, PROJECT_ROOT); break;
          case 'get_snapshot': result = await handleGetSnapshot(toolArgs, PROJECT_ROOT); break;
          case 'save_snapshot': result = await handleSaveSnapshot(toolArgs, PROJECT_ROOT); break;
          case 'get_stats': result = await handleGetStats(toolArgs, PROJECT_ROOT); break;
          default: result = { content: [{ type: 'text', text: `Unknown tool: ${toolName}` }], isError: true };
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
    console.error(`Delta MCP server (HTTP) running on http://${host}:${port}`);
    console.error(`  POST http://${host}:${port}/mcp  — MCP requests`);
    console.error(`  GET  http://${host}:${port}/health — Health check`);
  });

  process.on('SIGINT', () => {
    httpServer.close();
    process.exit(0);
  });
}

export { runMcpServer, runMcpHttpServer };