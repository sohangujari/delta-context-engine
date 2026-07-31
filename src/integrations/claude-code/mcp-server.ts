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
const TRANSPORT = process.env['DELTA_MCP_TRANSPORT'] ?? 'stdio';

async function runMcpServer(): Promise<void> {
  await initializeDatabase();

  const server = new Server(
    { name: 'delta-context-engine', version: '2.0.0' },
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

  // ── Start server ────────────────────────────────────────────────────────────

  const transport = new StdioServerTransport();
  await server.connect(transport);
}

// Export for use by `delta serve` and `delta mcp`
export { runMcpServer };

// Direct execution
runMcpServer().catch(console.error);