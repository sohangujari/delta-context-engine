/**
 * Graph Diff & Snapshots — Architectural change tracking.
 *
 * Take a snapshot of the current graph state, then compare it to a future
 * state to answer: "What changed architecturally this sprint?"
 */

import crypto from 'crypto';
import type { GraphStore } from '../../persistence/graph-store.js';
import type { StateStore } from '../../persistence/state-store.js';
import type { CommunityStore } from '../../persistence/community-store.js';
import type { RiskStore } from '../../persistence/risk-store.js';
import type { HubStore } from '../../persistence/hub-store.js';
import type { SnapshotStore } from '../../persistence/snapshot-store.js';

// ── Types ─────────────────────────────────────────────────────────────────────

export interface SnapshotData {
  id: string;
  label: string;
  createdAt: string;
  fileCount: number;
  edgeCount: number;
  communityCount: number;
  notes?: string;
}

export interface GraphDiffResult {
  snapshot: SnapshotData;
  current: {
    fileCount: number;
    edgeCount: number;
    communityCount: number;
  };

  filesAdded: string[];
  filesRemoved: string[];
  filesModified: string[];

  edgesAdded: Array<{ from: string; to: string }>;
  edgesRemoved: Array<{ from: string; to: string }>;

  communitiesAdded: string[];
  communitiesRemoved: string[];

  riskIncreased: Array<{ file: string; before: number; after: number }>;
  riskDecreased: Array<{ file: string; before: number; after: number }>;

  newHubs: string[];
  removedHubs: string[];
  newBridges: string[];
  removedBridges: string[];

  summary: string;
  riskDelta: number;
}

// ── Public API ────────────────────────────────────────────────────────────────

export async function takeSnapshot(
  label: string,
  stateStore: StateStore,
  graphStore: GraphStore,
  communityStore: CommunityStore,
  riskStore: RiskStore,
  hubStore: HubStore,
  snapshotStore: SnapshotStore,
  notes?: string
): Promise<SnapshotData> {
  const id = crypto.randomUUID();
  const createdAt = new Date().toISOString();

  // Gather current state
  const allFiles = stateStore.getAll();
  const allEdges = graphStore.getAllEdges();
  const communities = communityStore.getAll();

  const snapshotData: SnapshotData = {
    id,
    label,
    createdAt,
    fileCount: allFiles.length,
    edgeCount: allEdges.length,
    communityCount: communities.length,
    ...(notes ? { notes } : {}),
  };

  // Save snapshot metadata
  snapshotStore.saveSnapshot(snapshotData);

  // Save file states
  for (const file of allFiles) {
    const community = communityStore.getForFile(file.path);
    const riskScore = riskStore.get(file.path);
    const hubMetrics = hubStore.get(file.path);

    snapshotStore.saveSnapshotFile(id, {
      filePath: file.path,
      hash: file.hash,
      ...(community ? { communityId: community.id } : {}),
      ...(riskScore ? { riskScore: riskScore.overallScore } : {}),
      ...(hubMetrics ? { betweenness: hubMetrics.betweenness } : {}),
      isHub: hubMetrics?.isHub ?? false,
      isBridge: hubMetrics?.isBridge ?? false,
    });
  }

  // Save edge states
  for (const edge of allEdges) {
    snapshotStore.saveSnapshotEdge(id, edge.from, edge.to);
  }

  return snapshotData;
}

export async function compareToSnapshot(
  snapshotId: string,
  stateStore: StateStore,
  graphStore: GraphStore,
  communityStore: CommunityStore,
  riskStore: RiskStore,
  hubStore: HubStore,
  snapshotStore: SnapshotStore
): Promise<GraphDiffResult> {
  const snapshot = snapshotStore.get(snapshotId);
  if (!snapshot) {
    throw new Error(`Snapshot "${snapshotId}" not found`);
  }

  // Current state
  const currentFiles = stateStore.getAll();
  const currentEdges = graphStore.getAllEdges();
  const currentCommunities = communityStore.getAll();

  // Snapshot state
  const snapshotFiles = snapshotStore.getSnapshotFiles(snapshotId);
  const snapshotEdges = snapshotStore.getSnapshotEdges(snapshotId);

  // File diff
  const currentFileSet = new Set(currentFiles.map((f) => f.path));
  const snapshotFileSet = new Set(snapshotFiles.map((f) => f.filePath));
  const snapshotHashMap = new Map(snapshotFiles.map((f) => [f.filePath, f.hash]));

  const filesAdded = currentFiles
    .filter((f) => !snapshotFileSet.has(f.path))
    .map((f) => f.path);
  const filesRemoved = snapshotFiles
    .filter((f) => !currentFileSet.has(f.filePath))
    .map((f) => f.filePath);
  const filesModified = currentFiles
    .filter((f) => {
      const oldHash = snapshotHashMap.get(f.path);
      return oldHash !== undefined && oldHash !== f.hash;
    })
    .map((f) => f.path);

  // Edge diff
  const currentEdgeSet = new Set(currentEdges.map((e) => `${e.from}→${e.to}`));
  const snapshotEdgeSet = new Set(snapshotEdges.map((e) => `${e.from}→${e.to}`));

  const edgesAdded = currentEdges.filter(
    (e) => !snapshotEdgeSet.has(`${e.from}→${e.to}`)
  );
  const edgesRemoved = snapshotEdges.filter(
    (e) => !currentEdgeSet.has(`${e.from}→${e.to}`)
  );

  // Community diff
  const currentCommNames = new Set(currentCommunities.map((c) => c.name));
  const snapshotCommIds = new Set(snapshotFiles.map((f) => f.communityId).filter(Boolean));
  const snapshotCommNames = new Set<string>();
  for (const f of snapshotFiles) {
    if (f.communityId) {
      // Use community ID from snapshot — we don't have names in snapshot_files
      snapshotCommNames.add(f.communityId);
    }
  }

  const communitiesAdded = [...currentCommNames].filter(
    (n) => !snapshotCommNames.has(n)
  );
  const communitiesRemoved = [...snapshotCommNames].filter(
    (n) => !currentCommNames.has(n)
  );

  // Risk diff
  const riskIncreased: Array<{ file: string; before: number; after: number }> = [];
  const riskDecreased: Array<{ file: string; before: number; after: number }> = [];

  for (const sf of snapshotFiles) {
    if (!currentFileSet.has(sf.filePath)) continue;
    const currentRisk = riskStore.get(sf.filePath);
    if (!currentRisk || sf.riskScore === undefined) continue;

    const delta = currentRisk.overallScore - sf.riskScore;
    if (delta > 0.1) {
      riskIncreased.push({
        file: sf.filePath,
        before: sf.riskScore,
        after: currentRisk.overallScore,
      });
    } else if (delta < -0.1) {
      riskDecreased.push({
        file: sf.filePath,
        before: sf.riskScore,
        after: currentRisk.overallScore,
      });
    }
  }

  // Hub diff
  const snapshotHubs = new Set(
    snapshotFiles.filter((f) => f.isHub).map((f) => f.filePath)
  );
  const snapshotBridges = new Set(
    snapshotFiles.filter((f) => f.isBridge).map((f) => f.filePath)
  );

  const currentHubs = new Set<string>();
  const currentBridges = new Set<string>();
  for (const f of currentFiles) {
    const hm = hubStore.get(f.path);
    if (hm?.isHub) currentHubs.add(f.path);
    if (hm?.isBridge) currentBridges.add(f.path);
  }

  const newHubs = [...currentHubs].filter((f) => !snapshotHubs.has(f));
  const removedHubs = [...snapshotHubs].filter((f) => !currentHubs.has(f));
  const newBridges = [...currentBridges].filter((f) => !snapshotBridges.has(f));
  const removedBridges = [...snapshotBridges].filter((f) => !currentBridges.has(f));

  // Overall risk delta
  const avgCurrentRisk = currentFiles.length > 0
    ? currentFiles.reduce((sum, f) => {
        const r = riskStore.get(f.path);
        return sum + (r?.overallScore ?? 0);
      }, 0) / currentFiles.length
    : 0;

  const avgSnapshotRisk = snapshotFiles.length > 0
    ? snapshotFiles.reduce((sum, f) => sum + (f.riskScore ?? 0), 0) / snapshotFiles.length
    : 0;

  const riskDelta = avgCurrentRisk - avgSnapshotRisk;

  // Summary
  const parts: string[] = [];
  if (filesAdded.length > 0) parts.push(`+${filesAdded.length} files`);
  if (filesRemoved.length > 0) parts.push(`-${filesRemoved.length} files`);
  if (filesModified.length > 0) parts.push(`~${filesModified.length} modified`);
  if (edgesAdded.length > 0) parts.push(`+${edgesAdded.length} edges`);
  if (edgesRemoved.length > 0) parts.push(`-${edgesRemoved.length} edges`);
  if (newHubs.length > 0) parts.push(`+${newHubs.length} new hubs`);
  if (removedHubs.length > 0) parts.push(`-${removedHubs.length} hubs`);

  const summary = parts.length > 0
    ? parts.join(' · ')
    : 'No significant changes';

  return {
    snapshot,
    current: {
      fileCount: currentFiles.length,
      edgeCount: currentEdges.length,
      communityCount: currentCommunities.length,
    },
    filesAdded,
    filesRemoved,
    filesModified,
    edgesAdded,
    edgesRemoved,
    communitiesAdded,
    communitiesRemoved,
    riskIncreased,
    riskDecreased,
    newHubs,
    removedHubs,
    newBridges,
    removedBridges,
    summary,
    riskDelta,
  };
}
