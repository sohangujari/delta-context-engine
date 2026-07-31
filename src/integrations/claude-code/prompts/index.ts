/**
 * MCP Prompts barrel export + shared types.
 * All prompts assemble data from multiple stores into structured Markdown.
 */

import type { Database } from '../../../persistence/database.js';
import { GraphStore } from '../../../persistence/graph-store.js';
import { StateStore } from '../../../persistence/state-store.js';
import { SymbolStore } from '../../../persistence/symbol-store.js';
import { CommunityStore } from '../../../persistence/community-store.js';
import { FlowStore } from '../../../persistence/flow-store.js';
import { RiskStore } from '../../../persistence/risk-store.js';
import { HubStore } from '../../../persistence/hub-store.js';
import { MemoryStore } from '../../../persistence/memory-store.js';
import { SnapshotStore } from '../../../persistence/snapshot-store.js';
import { VectorStore } from '../../../core/embeddings/vector-store.js';
import { FtsSearch } from '../../../core/search/fts-search.js';
import { HybridSearch } from '../../../core/search/hybrid-search.js';

// ── AllStores ─────────────────────────────────────────────────────────────────

export interface AllStores {
  db: Database;
  graphStore: GraphStore;
  stateStore: StateStore;
  symbolStore: SymbolStore;
  communityStore: CommunityStore;
  flowStore: FlowStore;
  riskStore: RiskStore;
  hubStore: HubStore;
  memoryStore: MemoryStore;
  snapshotStore: SnapshotStore;
  vectorStore: VectorStore;
  ftsSearch: FtsSearch;
  hybridSearch: HybridSearch;
  projectRoot: string;
}

/**
 * Create AllStores from a Database instance and project root.
 */
export function createAllStores(db: Database, projectRoot: string): AllStores {
  const graphStore = new GraphStore(db);
  const stateStore = new StateStore(db);
  const symbolStore = new SymbolStore(db);
  const communityStore = new CommunityStore(db);
  const flowStore = new FlowStore(db);
  const riskStore = new RiskStore(db);
  const hubStore = new HubStore(db);
  const memoryStore = new MemoryStore(db);
  const snapshotStore = new SnapshotStore(db);
  const vectorStore = new VectorStore(db);
  const ftsSearch = new FtsSearch(db);
  const hybridSearch = new HybridSearch(ftsSearch, vectorStore, db);

  return {
    db, graphStore, stateStore, symbolStore, communityStore,
    flowStore, riskStore, hubStore, memoryStore, snapshotStore,
    vectorStore, ftsSearch, hybridSearch, projectRoot,
  };
}

// ── Re-exports ────────────────────────────────────────────────────────────────

export { buildBlastRadiusPrompt } from './blast-radius-prompt.js';
export { buildCodebaseCompassPrompt } from './codebase-compass-prompt.js';
export { buildFaultTracerPrompt } from './fault-tracer-prompt.js';
export { buildFirstDayPrompt } from './first-day-prompt.js';
export { buildMergeGuardianPrompt } from './merge-guardian-prompt.js';

// ── Utility ───────────────────────────────────────────────────────────────────

export function shortPath(fullPath: string, root: string): string {
  return fullPath.replace(root + '/', '').replace(/\\/g, '/');
}
