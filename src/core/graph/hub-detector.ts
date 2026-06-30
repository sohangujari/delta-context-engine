/**
 * Hub & Bridge Detector — Architectural bottleneck analysis.
 *
 * Hubs:     Files with high betweenness centrality (many paths go through them)
 * Bridges:  Edges whose removal disconnects the graph (Tarjan's algorithm)
 * Surprise: Cross-community edges that shouldn't exist
 *
 * Algorithms:
 *   - Brandes betweenness centrality (O(VE), sampled for large graphs)
 *   - Tarjan's bridge finding (O(V+E))
 */

import type { GraphStore } from '../../persistence/graph-store.js';
import type { CommunityStore } from '../../persistence/community-store.js';

// ── Types ─────────────────────────────────────────────────────────────────────

export interface HubMetrics {
  filePath: string;
  betweenness: number;
  degreeIn: number;
  degreeOut: number;
  isHub: boolean;
  isBridge: boolean;
  bridgeCommunities: string[];
  surpriseScore: number;
  calculatedAt: string;
}

export interface HubDetectionResult {
  hubs: HubMetrics[];
  bridges: HubMetrics[];
  allMetrics: HubMetrics[];
  hubThreshold: number;
}

// ── Public API ────────────────────────────────────────────────────────────────

export async function detectHubsAndBridges(
  graphStore: GraphStore,
  communityStore: CommunityStore,
  allFiles: string[],
  options?: {
    hubThreshold?: number;
    surpriseThreshold?: number;
  }
): Promise<HubDetectionResult> {
  const hubThreshold = options?.hubThreshold ?? 0.7;
  const calculatedAt = new Date().toISOString();

  // Build adjacency from graph edges
  const edges = graphStore.getAllEdges();
  const { adjacency, nodes, nodeIndex } = buildAdjacency(edges, allFiles);
  const n = nodes.length;

  // Calculate betweenness centrality (Brandes)
  const betweenness = brandesBetweenness(adjacency, n);

  // Normalise betweenness to 0–1
  const maxBetweenness = Math.max(...betweenness, 1);
  const normBetweenness = betweenness.map((b) => b / maxBetweenness);

  // Find bridges (Tarjan)
  const bridgeEdges = findBridges(adjacency, n);
  const bridgeNodes = new Set<number>();
  for (const [u, v] of bridgeEdges) {
    bridgeNodes.add(u);
    bridgeNodes.add(v);
  }

  // Build metrics for each file
  const allMetrics: HubMetrics[] = [];

  for (let i = 0; i < n; i++) {
    const filePath = nodes[i]!;
    const bet = normBetweenness[i] ?? 0;
    const degreeOut = graphStore.getDependencies(filePath).length;
    const degreeIn = graphStore.getDependents(filePath).length;
    const isHub = bet >= hubThreshold;
    const isBridge = bridgeNodes.has(i);

    // Find which communities this bridge connects
    let bridgeCommunities: string[] = [];
    if (isBridge) {
      const thisCommunity = communityStore.getForFile(filePath);
      const neighbors = adjacency[i] ?? [];
      const neighborComms = new Set<string>();

      for (const j of neighbors) {
        const neighborFile = nodes[j];
        if (!neighborFile) continue;
        const neighborComm = communityStore.getForFile(neighborFile);
        if (neighborComm && neighborComm.name !== thisCommunity?.name) {
          neighborComms.add(neighborComm.name);
        }
      }
      bridgeCommunities = [...neighborComms];
    }

    // Surprise score
    const surpriseScore = calculateSurpriseScore(
      filePath, adjacency[i] ?? [], nodes, communityStore
    );

    allMetrics.push({
      filePath,
      betweenness: bet,
      degreeIn,
      degreeOut,
      isHub,
      isBridge,
      bridgeCommunities,
      surpriseScore,
      calculatedAt,
    });
  }

  allMetrics.sort((a, b) => b.betweenness - a.betweenness);

  return {
    hubs: allMetrics.filter((m) => m.isHub),
    bridges: allMetrics.filter((m) => m.isBridge),
    allMetrics,
    hubThreshold,
  };
}

// ── Adjacency Builder ─────────────────────────────────────────────────────────

function buildAdjacency(
  edges: Array<{ from: string; to: string }>,
  allFiles: string[]
): { adjacency: number[][]; nodes: string[]; nodeIndex: Map<string, number> } {
  const nodeSet = new Set(allFiles);
  for (const e of edges) {
    nodeSet.add(e.from);
    nodeSet.add(e.to);
  }

  const nodes = [...nodeSet];
  const nodeIndex = new Map<string, number>();
  for (let i = 0; i < nodes.length; i++) {
    nodeIndex.set(nodes[i]!, i);
  }

  const adjacency: number[][] = nodes.map(() => []);

  for (const e of edges) {
    const i = nodeIndex.get(e.from);
    const j = nodeIndex.get(e.to);
    if (i === undefined || j === undefined) continue;
    adjacency[i]!.push(j);
    adjacency[j]!.push(i); // undirected for centrality
  }

  return { adjacency, nodes, nodeIndex };
}

// ── Brandes Betweenness Centrality ────────────────────────────────────────────

function brandesBetweenness(adjacency: number[][], n: number): number[] {
  const cb = new Float64Array(n);

  // For large graphs, sample sources
  const sampleSize = n > 2000 ? Math.ceil(n * 0.1) : n;
  const sources: number[] = [];
  for (let i = 0; i < sampleSize; i++) {
    sources.push(n > 2000 ? Math.floor(Math.random() * n) : i);
  }
  const samplingFactor = n / sampleSize;

  for (const s of sources) {
    // BFS from source s
    const stack: number[] = [];
    const predecessors: number[][] = Array.from({ length: n }, () => []);
    const sigma = new Float64Array(n);    // number of shortest paths
    const dist = new Int32Array(n).fill(-1);
    const delta = new Float64Array(n);

    sigma[s] = 1;
    dist[s] = 0;
    const queue: number[] = [s];

    while (queue.length > 0) {
      const v = queue.shift()!;
      stack.push(v);

      for (const w of adjacency[v] ?? []) {
        // First visit → shortest path found
        if (dist[w] === -1) {
          dist[w] = dist[v]! + 1;
          queue.push(w);
        }
        // Shortest path via v?
        if (dist[w] === dist[v]! + 1) {
          sigma[w] = sigma[w]! + sigma[v]!;
          predecessors[w]!.push(v);
        }
      }
    }

    // Accumulate pair dependencies
    while (stack.length > 0) {
      const w = stack.pop()!;
      for (const v of predecessors[w]!) {
        delta[v] = delta[v]! + (sigma[v]! / sigma[w]!) * (1 + delta[w]!);
      }
      if (w !== s) {
        cb[w] = cb[w]! + delta[w]! * samplingFactor;
      }
    }
  }

  return Array.from(cb);
}

// ── Tarjan's Bridge Finding ───────────────────────────────────────────────────

function findBridges(adjacency: number[][], n: number): Array<[number, number]> {
  const disc = new Int32Array(n).fill(-1);
  const low = new Int32Array(n).fill(-1);
  const bridges: Array<[number, number]> = [];
  let timer = 0;

  function dfs(u: number, parent: number): void {
    disc[u] = low[u] = timer++;

    for (const v of adjacency[u] ?? []) {
      if (v === parent) continue;

      if (disc[v] === -1) {
        dfs(v, u);
        low[u] = Math.min(low[u]!, low[v]!);

        // Bridge condition: low[v] > disc[u]
        if (low[v]! > disc[u]!) {
          bridges.push([u, v]);
        }
      } else {
        low[u] = Math.min(low[u]!, disc[v]!);
      }
    }
  }

  // Run DFS from all unvisited nodes (handles disconnected graphs)
  for (let i = 0; i < n; i++) {
    if (disc[i] === -1) {
      dfs(i, -1);
    }
  }

  return bridges;
}

// ── Surprise Scorer ───────────────────────────────────────────────────────────

function calculateSurpriseScore(
  filePath: string,
  neighbors: number[],
  nodes: string[],
  communityStore: CommunityStore
): number {
  const thisCommunity = communityStore.getForFile(filePath);
  if (!thisCommunity) return 0;

  const communityEdges = communityStore.getCommunityEdges();
  let score = 0;

  for (const j of neighbors) {
    const neighborFile = nodes[j];
    if (!neighborFile) continue;

    const neighborComm = communityStore.getForFile(neighborFile);
    if (!neighborComm || neighborComm.name === thisCommunity.name) continue;

    // Find cross-community edge count
    const crossEdge = communityEdges.find(
      (e) =>
        (e.from === thisCommunity.name && e.to === neighborComm.name) ||
        (e.from === neighborComm.name && e.to === thisCommunity.name)
    );

    const edgeCount = crossEdge?.edgeCount ?? 0;
    score += edgeCount <= 1 ? 0.4 : 0.1;
  }

  return Math.min(1.0, score);
}
