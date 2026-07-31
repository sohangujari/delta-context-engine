/**
 * MCP Tool Handlers — implementation for all 14 tools.
 */

import path from 'path';
import { DeltaDb } from '../../persistence/delta-db.js';
import { createAllStores, type AllStores } from './prompts/index.js';
import { calculateBlastRadius } from '../../core/graph/blast-radius.js';
import { compareToSnapshot, takeSnapshot } from '../../core/graph/graph-diff.js';
import { classifyFiles } from '../../core/change-detector/state-classifier.js';
import { walkDirectory } from '../../core/change-detector/hash-tracker.js';
import { traverseFromChanged } from '../../core/graph/traverser.js';
import { queryByTask } from '../../core/embeddings/query.js';
import { scoreAllFiles, buildSemanticScoreMap } from '../../core/relevance/scorer.js';
import { rankForContext } from '../../core/relevance/ranker.js';
import { assembleContext } from '../../core/assembler/context-builder.js';
import { loadConfig } from '../../config/delta.config.js';
import { loadIgnorePatterns } from '../../config/deltaignore.js';
import { injectMemories } from '../../core/memory/injector.js';
import type { MemoryType } from '../../persistence/memory-store.js';
import type { SearchScope } from '../../core/search/fts-search.js';
import type { EntryPointType } from '../../core/graph/flow-tracer.js';

type ToolResponse = { content: Array<{ type: 'text'; text: string }>; isError?: boolean };

function textResponse(text: string): ToolResponse {
  return { content: [{ type: 'text' as const, text }] };
}

function errorResponse(msg: string): ToolResponse {
  return { content: [{ type: 'text' as const, text: `Error: ${msg}` }], isError: true };
}

function getStores(args: Record<string, unknown>, defaultRoot: string): { stores: AllStores; db: DeltaDb; root: string } {
  const projectRoot = typeof args['projectRoot'] === 'string'
    ? path.resolve(args['projectRoot'])
    : defaultRoot;
  const db = new DeltaDb(projectRoot);
  const stores = createAllStores(db.getDb(), projectRoot);
  return { stores, db, root: projectRoot };
}

// ── get_optimized_context ─────────────────────────────────────────────────────

export async function handleGetOptimizedContext(
  args: Record<string, unknown>,
  defaultRoot: string
): Promise<ToolResponse> {
  const task = String(args['task'] ?? '');
  const budget = typeof args['budget'] === 'number' ? args['budget'] : 4000;
  const root = typeof args['projectRoot'] === 'string' ? path.resolve(args['projectRoot']) : defaultRoot;

  try {
    const db = new DeltaDb(root);
    const rawDb = db.getDb();
    const config = loadConfig(root);
    const ignorePatterns = loadIgnorePatterns(root);

    const { GraphStore } = await import('../../persistence/graph-store.js');
    const { StateStore } = await import('../../persistence/state-store.js');
    const { SymbolStore } = await import('../../persistence/symbol-store.js');
    const { VectorStore } = await import('../../core/embeddings/vector-store.js');
    const { MemoryStore } = await import('../../persistence/memory-store.js');

    const graphStore = new GraphStore(rawDb);
    const stateStore = new StateStore(rawDb);
    const symbolStore = new SymbolStore(rawDb);
    const vectorStore = new VectorStore(rawDb);
    const memoryStore = new MemoryStore(rawDb);

    // Step 1: Detect changes
    const allFiles = walkDirectory(root, root, ignorePatterns);
    const classification = await classifyFiles(root, stateStore, allFiles);
    const changedPaths = classification.changed.map(f => f.path);

    // Step 2: Graph traversal
    const traversal = traverseFromChanged(changedPaths, graphStore, root, config.graph.maxDepth);

    // Step 3: Semantic scoring
    const queryResult = await queryByTask(
      { task, projectRoot: root, threshold: config.relevance.semanticThreshold },
      vectorStore,
      symbolStore
    );
    const semanticScoreMap = queryResult.embeddingsAvailable
      ? buildSemanticScoreMap(queryResult.scored)
      : new Map<string, number>();

    // Step 4: Hybrid ranking
    const scores = scoreAllFiles(traversal, semanticScoreMap, {
      semanticThreshold: config.relevance.semanticThreshold,
      maxDepth: config.graph.maxDepth,
    });
    const ranked = rankForContext(scores);

    // Step 4.5: Memory injection
    const changedRelPaths = classification.changed.map(f => f.relativePath);
    const injection = injectMemories(task, changedRelPaths, memoryStore, Math.floor(budget * 0.2));

    // Step 5: Assemble context
    const rankedTraversal = {
      ...traversal,
      touched: ranked.touched.map(s => ({
        path: s.filePath, relativePath: s.relativePath, state: 'TOUCHED' as const, depth: 1,
      })),
      ancestors: ranked.ancestors.map(s => ({
        path: s.filePath, relativePath: s.relativePath, state: 'ANCESTOR' as const, depth: 2,
      })),
    };

    const payload = await assembleContext({
      task,
      traversal: rankedTraversal,
      projectRoot: root,
      tokenBudget: budget,
      allProjectFiles: allFiles,
      ...(injection.memoryBlock ? { memoryBlock: injection.memoryBlock } : {}),
      ...(injection.tokenCount > 0 ? { memoryTokens: injection.tokenCount } : {}),
    });

    db.close();
    return textResponse(payload.formatted);
  } catch (err) {
    return errorResponse(err instanceof Error ? err.message : String(err));
  }
}

// ── get_community_map ─────────────────────────────────────────────────────────

export async function handleGetCommunityMap(
  args: Record<string, unknown>,
  defaultRoot: string
): Promise<ToolResponse> {
  const { stores, db } = getStores(args, defaultRoot);
  try {
    const communities = stores.communityStore.getAll();
    const name = typeof args['communityName'] === 'string' ? args['communityName'] : null;

    if (name) {
      const filtered = communities.filter(c => c.name.toLowerCase().includes(name.toLowerCase()));
      db.close();
      return textResponse(JSON.stringify(filtered, null, 2));
    }

    db.close();
    return textResponse(JSON.stringify(communities.map(c => ({
      name: c.name, fileCount: c.fileCount, cohesion: c.cohesionScore,
      coupling: c.couplingScore, riskLevel: c.riskLevel, description: c.description,
    })), null, 2));
  } catch (err) {
    db.close();
    return errorResponse(err instanceof Error ? err.message : String(err));
  }
}

// ── get_execution_flows ───────────────────────────────────────────────────────

export async function handleGetExecutionFlows(
  args: Record<string, unknown>,
  defaultRoot: string
): Promise<ToolResponse> {
  const { stores, db } = getStores(args, defaultRoot);
  try {
    let flows = stores.flowStore.getAll();

    if (typeof args['entryType'] === 'string') {
      flows = flows.filter(f => f.entryType === (args['entryType'] as EntryPointType));
    }
    if (typeof args['filePath'] === 'string') {
      flows = stores.flowStore.getFlowsForFile(args['filePath']);
    }

    db.close();
    return textResponse(JSON.stringify(flows.map(f => ({
      name: f.name, entryType: f.entryType, depth: f.depth,
      criticality: f.criticality, steps: f.steps.map(s => s.symbol).join(' → '),
    })), null, 2));
  } catch (err) {
    db.close();
    return errorResponse(err instanceof Error ? err.message : String(err));
  }
}

// ── get_blast_radius ──────────────────────────────────────────────────────────

export async function handleGetBlastRadius(
  args: Record<string, unknown>,
  defaultRoot: string
): Promise<ToolResponse> {
  const { stores, db } = getStores(args, defaultRoot);
  try {
    const filePaths = typeof args['filePaths'] === 'string'
      ? args['filePaths'].split(',').map(f => f.trim())
      : [];

    if (filePaths.length === 0) {
      db.close();
      return errorResponse('filePaths required');
    }

    const results = [];
    for (const fp of filePaths) {
      const result = await calculateBlastRadius(
        fp, stores.graphStore, stores.communityStore,
        stores.flowStore, stores.symbolStore,
        { projectRoot: stores.projectRoot, maxDepth: typeof args['maxDepth'] === 'number' ? args['maxDepth'] : 5 }
      );
      results.push(result);
    }

    db.close();
    return textResponse(JSON.stringify(results, null, 2));
  } catch (err) {
    db.close();
    return errorResponse(err instanceof Error ? err.message : String(err));
  }
}

// ── get_risk_scores ───────────────────────────────────────────────────────────

export async function handleGetRiskScores(
  args: Record<string, unknown>,
  defaultRoot: string
): Promise<ToolResponse> {
  const { stores, db } = getStores(args, defaultRoot);
  try {
    let scores = stores.riskStore.getAll();

    if (typeof args['filePath'] === 'string') {
      scores = scores.filter(s => s.filePath === args['filePath']);
    }
    if (typeof args['riskLevel'] === 'string') {
      scores = scores.filter(s => s.riskLevel === args['riskLevel']);
    }

    db.close();
    return textResponse(JSON.stringify(scores, null, 2));
  } catch (err) {
    db.close();
    return errorResponse(err instanceof Error ? err.message : String(err));
  }
}

// ── get_memory ────────────────────────────────────────────────────────────────

export async function handleGetMemory(
  args: Record<string, unknown>,
  defaultRoot: string
): Promise<ToolResponse> {
  const { stores, db } = getStores(args, defaultRoot);
  try {
    let items = stores.memoryStore.getAll();

    if (typeof args['topic'] === 'string') {
      items = items.filter(m => m.topic.includes(args['topic'] as string));
    }
    if (typeof args['filePath'] === 'string') {
      items = items.filter(m => m.filePaths.includes(args['filePath'] as string));
    }
    if (typeof args['query'] === 'string') {
      const ftsResults = stores.ftsSearch.searchMemory(args['query'] as string, 10);
      const matchIds = new Set(ftsResults.map(r => r.memoryId));
      items = items.filter(m => matchIds.has(m.id));
    }

    db.close();
    return textResponse(JSON.stringify(items, null, 2));
  } catch (err) {
    db.close();
    return errorResponse(err instanceof Error ? err.message : String(err));
  }
}

// ── save_memory ───────────────────────────────────────────────────────────────

export async function handleSaveMemory(
  args: Record<string, unknown>,
  defaultRoot: string
): Promise<ToolResponse> {
  const { stores, db } = getStores(args, defaultRoot);
  try {
    const { MemoryStore } = await import('../../persistence/memory-store.js');
    const item = {
      id: MemoryStore.generateId(),
      title: String(args['title'] ?? ''),
      content: String(args['content'] ?? ''),
      type: (args['type'] ?? 'ARCHITECTURAL') as MemoryType,
      topic: String(args['topic'] ?? 'general'),
      confidence: 'MEDIUM' as const,
      source: 'auto' as const,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      lastAccessed: new Date().toISOString(),
      filePaths: typeof args['filePaths'] === 'string'
        ? args['filePaths'].split(',').map(f => f.trim())
        : [],
      tags: [],
    };

    stores.memoryStore.save(item);
    db.close();
    return textResponse(`Memory saved: "${item.title}" (${item.id})`);
  } catch (err) {
    db.close();
    return errorResponse(err instanceof Error ? err.message : String(err));
  }
}

// ── search_codebase ───────────────────────────────────────────────────────────

export async function handleSearchCodebase(
  args: Record<string, unknown>,
  defaultRoot: string
): Promise<ToolResponse> {
  const { stores, db } = getStores(args, defaultRoot);
  try {
    const query = String(args['query'] ?? '');
    const scope = (args['scope'] ?? 'all') as SearchScope;
    const limit = typeof args['limit'] === 'number' ? args['limit'] : 20;

    const results = await stores.hybridSearch.search({
      query,
      projectRoot: stores.projectRoot,
      scope,
      limit,
    });

    db.close();
    return textResponse(JSON.stringify(results, null, 2));
  } catch (err) {
    db.close();
    return errorResponse(err instanceof Error ? err.message : String(err));
  }
}

// ── get_graph_diff ────────────────────────────────────────────────────────────

export async function handleGetGraphDiff(
  args: Record<string, unknown>,
  defaultRoot: string
): Promise<ToolResponse> {
  const { stores, db } = getStores(args, defaultRoot);
  try {
    const snapshotId = String(args['snapshotId'] ?? '');
    const diff = await compareToSnapshot(
      snapshotId, stores.stateStore, stores.graphStore,
      stores.communityStore, stores.riskStore, stores.hubStore,
      stores.snapshotStore
    );

    db.close();
    return textResponse(JSON.stringify(diff, null, 2));
  } catch (err) {
    db.close();
    return errorResponse(err instanceof Error ? err.message : String(err));
  }
}

// ── get_hub_files ─────────────────────────────────────────────────────────────

export async function handleGetHubFiles(
  args: Record<string, unknown>,
  defaultRoot: string
): Promise<ToolResponse> {
  const { stores, db } = getStores(args, defaultRoot);
  try {
    const topN = typeof args['topN'] === 'number' ? args['topN'] : 10;
    const hubs = stores.hubStore.getHubs().slice(0, topN);

    db.close();
    return textResponse(JSON.stringify(hubs, null, 2));
  } catch (err) {
    db.close();
    return errorResponse(err instanceof Error ? err.message : String(err));
  }
}

// ── get_bridge_files ──────────────────────────────────────────────────────────

export async function handleGetBridgeFiles(
  args: Record<string, unknown>,
  defaultRoot: string
): Promise<ToolResponse> {
  const { stores, db } = getStores(args, defaultRoot);
  try {
    const bridges = stores.hubStore.getBridges();
    db.close();
    return textResponse(JSON.stringify(bridges, null, 2));
  } catch (err) {
    db.close();
    return errorResponse(err instanceof Error ? err.message : String(err));
  }
}

// ── get_snapshot / save_snapshot ───────────────────────────────────────────────

export async function handleGetSnapshot(
  args: Record<string, unknown>,
  defaultRoot: string
): Promise<ToolResponse> {
  const { stores, db } = getStores(args, defaultRoot);
  try {
    if (typeof args['snapshotId'] === 'string') {
      const snapshot = stores.snapshotStore.get(args['snapshotId']);
      db.close();
      return textResponse(JSON.stringify(snapshot, null, 2));
    }

    const all = stores.snapshotStore.getAll();
    db.close();
    return textResponse(JSON.stringify(all, null, 2));
  } catch (err) {
    db.close();
    return errorResponse(err instanceof Error ? err.message : String(err));
  }
}

export async function handleSaveSnapshot(
  args: Record<string, unknown>,
  defaultRoot: string
): Promise<ToolResponse> {
  const { stores, db } = getStores(args, defaultRoot);
  try {
    const label = String(args['label'] ?? 'snapshot');
    const notes = typeof args['notes'] === 'string' ? args['notes'] : undefined;

    const snapshot = await takeSnapshot(
      label, stores.stateStore, stores.graphStore,
      stores.communityStore, stores.riskStore, stores.hubStore,
      stores.snapshotStore, notes
    );

    db.close();
    return textResponse(`Snapshot created: ${snapshot.id} (${label})`);
  } catch (err) {
    db.close();
    return errorResponse(err instanceof Error ? err.message : String(err));
  }
}

// ── get_stats ─────────────────────────────────────────────────────────────────

export async function handleGetStats(
  args: Record<string, unknown>,
  defaultRoot: string
): Promise<ToolResponse> {
  const { stores, db } = getStores(args, defaultRoot);
  try {
    const files = stores.stateStore.getAll();
    const communities = stores.communityStore.getAll();
    const flows = stores.flowStore.getAll();
    const hubs = stores.hubStore.getHubs();
    const bridges = stores.hubStore.getBridges();
    const risks = stores.riskStore.getAll();
    const memories = stores.memoryStore.getAll();
    const vectors = stores.vectorStore.count();

    const stats = {
      files: files.length,
      communities: communities.length,
      flows: flows.length,
      hubs: hubs.length,
      bridges: bridges.length,
      highRiskFiles: risks.filter(r => r.riskLevel === 'HIGH').length,
      memories: memories.length,
      embeddings: vectors,
    };

    db.close();
    return textResponse(JSON.stringify(stats, null, 2));
  } catch (err) {
    db.close();
    return errorResponse(err instanceof Error ? err.message : String(err));
  }
}
