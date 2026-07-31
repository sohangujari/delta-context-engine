/**
 * MCP Tool Definitions — 14 tools covering all Phase 1-3 intelligence.
 */

export const TOOL_DEFINITIONS = [
  // ── CONTEXT (V1 enhanced) ──────────────────────────────────
  {
    name: 'get_optimized_context',
    description:
      'Returns token-optimized context for the current task. ' +
      'Detects changed files, traces dependencies, and assembles ' +
      'a minimal context payload with memory injection and graph intelligence.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        task: { type: 'string', description: 'The task instruction or question' },
        budget: { type: 'number', description: 'Token budget (default: 4000)' },
        projectRoot: { type: 'string', description: 'Project root path' },
      },
      required: ['task'],
    },
  },

  // ── GRAPH INTELLIGENCE ─────────────────────────────────────
  {
    name: 'get_community_map',
    description:
      'Returns the architectural community map. ' +
      'Shows which files form logical clusters (auth, payments, etc.).',
    inputSchema: {
      type: 'object' as const,
      properties: {
        projectRoot: { type: 'string', description: 'Project root path' },
        communityName: { type: 'string', description: 'Filter to one community' },
      },
    },
  },
  {
    name: 'get_execution_flows',
    description: 'Returns traced execution flows from entry points through the codebase.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        projectRoot: { type: 'string', description: 'Project root path' },
        entryType: {
          type: 'string',
          enum: ['HTTP_ROUTE', 'CLI_CMD', 'EVENT', 'EXPORT', 'TEST'],
          description: 'Filter by entry type',
        },
        filePath: { type: 'string', description: 'Filter flows touching this file' },
      },
    },
  },
  {
    name: 'get_blast_radius',
    description:
      'Returns blast radius for changed or specified files. ' +
      'Shows what else might break if these files change.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        filePaths: { type: 'string', description: 'Comma-separated file paths' },
        projectRoot: { type: 'string', description: 'Project root path' },
        maxDepth: { type: 'number', description: 'Max traversal depth (default: 5)' },
      },
    },
  },
  {
    name: 'get_risk_scores',
    description:
      'Returns risk scores for files. ' +
      'Scores security sensitivity, test coverage, coupling, and flow participation.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        projectRoot: { type: 'string', description: 'Project root path' },
        filePath: { type: 'string', description: 'Get score for one file' },
        riskLevel: {
          type: 'string',
          enum: ['HIGH', 'MEDIUM', 'LOW'],
          description: 'Filter by risk level',
        },
      },
    },
  },

  // ── MEMORY ─────────────────────────────────────────────────
  {
    name: 'get_memory',
    description:
      'Returns persistent memory about the codebase. ' +
      'Contains architectural knowledge, past bugs, decisions, and conventions.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        projectRoot: { type: 'string', description: 'Project root path' },
        topic: { type: 'string', description: 'Memory topic to retrieve' },
        filePath: { type: 'string', description: 'Get memories about this file' },
        query: { type: 'string', description: 'Search memories by text' },
      },
    },
  },
  {
    name: 'save_memory',
    description:
      'Saves a new memory item about the codebase. ' +
      'Use when AI learns something important about architecture or conventions.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        projectRoot: { type: 'string', description: 'Project root path' },
        title: { type: 'string' },
        content: { type: 'string' },
        type: {
          type: 'string',
          enum: ['ARCHITECTURAL', 'DECISION', 'BUG', 'FLOW', 'EDGE_CASE', 'COMMUNITY'],
        },
        topic: { type: 'string' },
        filePaths: { type: 'string', description: 'Comma-separated related file paths' },
      },
      required: ['title', 'content', 'type', 'topic'],
    },
  },

  // ── SEARCH ─────────────────────────────────────────────────
  {
    name: 'search_codebase',
    description:
      'Hybrid search across symbols, files, memory, flows, and communities. ' +
      'Uses FTS5 + semantic embeddings for best results.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        query: { type: 'string' },
        projectRoot: { type: 'string', description: 'Project root path' },
        scope: {
          type: 'string',
          enum: ['all', 'symbols', 'files', 'memory', 'flows', 'communities'],
        },
        limit: { type: 'number', description: 'Max results (default: 20)' },
      },
      required: ['query'],
    },
  },

  // ── ARCHITECTURE ───────────────────────────────────────────
  {
    name: 'get_graph_diff',
    description: 'Returns architectural diff between a saved snapshot and current state.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        snapshotId: { type: 'string' },
        projectRoot: { type: 'string', description: 'Project root path' },
      },
      required: ['snapshotId'],
    },
  },
  {
    name: 'get_hub_files',
    description:
      'Returns the most architecturally central files. ' +
      'These are hubs: files that most of the codebase depends on.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        projectRoot: { type: 'string', description: 'Project root path' },
        topN: { type: 'number', description: 'How many to return (default: 10)' },
      },
    },
  },
  {
    name: 'get_bridge_files',
    description:
      'Returns bridge files: architecturally critical connectors between communities.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        projectRoot: { type: 'string', description: 'Project root path' },
      },
    },
  },
  {
    name: 'get_snapshot',
    description: 'Get or create a graph snapshot for tracking architectural changes.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        projectRoot: { type: 'string', description: 'Project root path' },
        snapshotId: { type: 'string', description: 'Get existing snapshot by ID' },
        label: { type: 'string', description: 'Create new snapshot with this label' },
      },
    },
  },
  {
    name: 'save_snapshot',
    description: 'Save a new graph snapshot with the current state.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        projectRoot: { type: 'string', description: 'Project root path' },
        label: { type: 'string', description: 'Snapshot label' },
        notes: { type: 'string', description: 'Optional notes' },
      },
      required: ['label'],
    },
  },
  {
    name: 'get_stats',
    description: 'Returns Delta index statistics for the current project.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        projectRoot: { type: 'string', description: 'Project root path' },
      },
    },
  },
];
