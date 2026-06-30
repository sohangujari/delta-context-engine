/**
 * Community Detector — Leiden algorithm for codebase clustering.
 *
 * Pure TypeScript implementation. No external dependencies.
 * Clusters files into architectural communities based on the dependency graph.
 *
 * Phases: Local Moving → Refinement → Aggregation → Flatten
 */

import crypto from 'crypto';
import type { GraphStore } from '../../persistence/graph-store.js';
import type { SymbolStore } from '../../persistence/symbol-store.js';
import type { CommunityData } from '../../persistence/community-store.js';

// ── Types ─────────────────────────────────────────────────────────────────────

export interface CommunityDetectorOptions {
  resolution: number;
  seed: number;
  maxIterations: number;
  maxCommunityFraction: number;
  minCommunitySize: number;
}

export interface CommunityResult {
  communities: CommunityData[];
  communityEdges: Array<{ from: string; to: string; edgeCount: number }>;
  totalEdges: number;
  modularity: number;
  detectedAt: string;
  durationMs: number;
}

const DEFAULT_OPTIONS: CommunityDetectorOptions = {
  resolution: 1.0,
  seed: 42,
  maxIterations: 10,
  maxCommunityFraction: 0.25,
  minCommunitySize: 3,
};

// ── Internal graph representation ─────────────────────────────────────────────

interface Graph {
  nodes: string[];
  nodeIndex: Map<string, number>;
  adjacency: number[][];      // adjacency[i] = list of neighbor indices
  weights: Map<string, number>; // "i-j" → weight (default 1)
  totalWeight: number;
}

// ── Seeded PRNG (for determinism) ─────────────────────────────────────────────

function createRng(seed: number): () => number {
  let s = seed;
  return () => {
    s = (s * 1103515245 + 12345) & 0x7fffffff;
    return s / 0x7fffffff;
  };
}

function shuffleArray<T>(arr: T[], rng: () => number): T[] {
  const result = [...arr];
  for (let i = result.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    const tmp = result[i]!;
    result[i] = result[j]!;
    result[j] = tmp;
  }
  return result;
}

// ── Public API ────────────────────────────────────────────────────────────────

export async function detectCommunities(
  graphStore: GraphStore,
  symbolStore: SymbolStore,
  options?: Partial<CommunityDetectorOptions>
): Promise<CommunityResult> {
  const opts = { ...DEFAULT_OPTIONS, ...options };
  const startTime = Date.now();
  const detectedAt = new Date().toISOString();

  // Build in-memory graph from stored edges
  const edges = graphStore.getAllEdges();
  const graph = buildGraph(edges);

  if (graph.nodes.length === 0) {
    return {
      communities: [],
      communityEdges: [],
      totalEdges: 0,
      modularity: 0,
      detectedAt,
      durationMs: Date.now() - startTime,
    };
  }

  // Run Leiden
  const assignment = leidenAlgorithm(graph, opts);

  // Group nodes by community
  const groups = groupByCommunity(graph.nodes, assignment);

  // Post-process: split oversized, merge tiny
  const processed = postProcess(groups, graph, opts);

  // Build community data with metrics
  const communities = buildCommunityData(
    processed, graph, symbolStore, detectedAt, opts.resolution
  );

  // Calculate cross-community edges
  const communityEdges = calculateCommunityEdges(graph, assignment, communities);

  // Calculate modularity
  const modularity = calculateModularity(graph, assignment);

  return {
    communities,
    communityEdges,
    totalEdges: edges.length,
    modularity,
    detectedAt,
    durationMs: Date.now() - startTime,
  };
}

// ── Graph Construction ────────────────────────────────────────────────────────

function buildGraph(edges: Array<{ from: string; to: string }>): Graph {
  const nodeSet = new Set<string>();
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
  const weights = new Map<string, number>();
  let totalWeight = 0;

  for (const e of edges) {
    const i = nodeIndex.get(e.from);
    const j = nodeIndex.get(e.to);
    if (i === undefined || j === undefined) continue;

    // Treat as undirected for community detection
    const key1 = `${Math.min(i, j)}-${Math.max(i, j)}`;
    if (!weights.has(key1)) {
      adjacency[i]!.push(j);
      adjacency[j]!.push(i);
      weights.set(key1, 1);
      totalWeight += 1;
    }
  }

  return { nodes, nodeIndex, adjacency, weights, totalWeight };
}

// ── Leiden Algorithm ──────────────────────────────────────────────────────────

function leidenAlgorithm(
  graph: Graph,
  opts: CommunityDetectorOptions
): number[] {
  const n = graph.nodes.length;
  const rng = createRng(opts.seed);

  // Initialisation: each node in its own community
  let assignment = Array.from({ length: n }, (_, i) => i);

  for (let iter = 0; iter < opts.maxIterations; iter++) {
    const moved = localMovingPhase(graph, assignment, opts.resolution, rng);

    // Refinement phase (Leiden-specific)
    refinementPhase(graph, assignment, opts.resolution, rng);

    if (!moved) break;
  }

  // Renumber communities to be contiguous 0..k-1
  return renumberCommunities(assignment);
}

/**
 * STEP 2: Local Moving Phase
 * For each node, try moving it to each neighbour's community.
 * Accept move with highest positive modularity gain.
 */
function localMovingPhase(
  graph: Graph,
  assignment: number[],
  resolution: number,
  rng: () => number
): boolean {
  const n = graph.nodes.length;
  const m = graph.totalWeight;
  if (m === 0) return false;

  // Precompute community degrees
  const communityWeightSum = new Map<number, number>();
  for (let i = 0; i < n; i++) {
    const comm = assignment[i]!;
    const deg = graph.adjacency[i]!.length;
    communityWeightSum.set(comm, (communityWeightSum.get(comm) ?? 0) + deg);
  }

  let anyMoved = false;
  const order = shuffleArray(Array.from({ length: n }, (_, i) => i), rng);

  for (const i of order) {
    const currentComm = assignment[i]!;
    const neighbors = graph.adjacency[i]!;
    const nodeDeg = neighbors.length;

    // Count edges to each neighbouring community
    const edgesToComm = new Map<number, number>();
    for (const j of neighbors) {
      const neighborComm = assignment[j]!;
      edgesToComm.set(neighborComm, (edgesToComm.get(neighborComm) ?? 0) + 1);
    }

    // Remove node from its current community
    communityWeightSum.set(
      currentComm,
      (communityWeightSum.get(currentComm) ?? 0) - nodeDeg
    );

    let bestComm = currentComm;
    let bestGain = 0;

    for (const [comm, edgesIn] of edgesToComm) {
      const sumTot = communityWeightSum.get(comm) ?? 0;
      // ΔQ = edgesIn - resolution × nodeDeg × sumTot / (2m)
      const gain = edgesIn - resolution * nodeDeg * sumTot / (2 * m);

      if (gain > bestGain) {
        bestGain = gain;
        bestComm = comm;
      }
    }

    // Move node to best community
    assignment[i] = bestComm;
    communityWeightSum.set(
      bestComm,
      (communityWeightSum.get(bestComm) ?? 0) + nodeDeg
    );

    if (bestComm !== currentComm) {
      anyMoved = true;
    }
  }

  return anyMoved;
}

/**
 * STEP 3: Refinement Phase (Leiden-specific)
 * Within each community, check if sub-groups are well connected.
 * Split poorly-connected sub-groups.
 */
function refinementPhase(
  graph: Graph,
  assignment: number[],
  resolution: number,
  rng: () => number
): void {
  const n = graph.nodes.length;
  const communities = new Map<number, number[]>();

  for (let i = 0; i < n; i++) {
    const comm = assignment[i]!;
    if (!communities.has(comm)) {
      communities.set(comm, []);
    }
    communities.get(comm)!.push(i);
  }

  // For each community, check internal connectivity
  for (const [_, members] of communities) {
    if (members.length <= 2) continue;

    // Build sub-adjacency for this community
    const memberSet = new Set(members);
    const subAdj = new Map<number, number[]>();

    for (const i of members) {
      const internalNeighbors = graph.adjacency[i]!.filter((j) => memberSet.has(j));
      subAdj.set(i, internalNeighbors);
    }

    // Check if community is connected via BFS from first member
    const start = members[0]!;
    const visited = new Set<number>();
    const queue = [start];
    visited.add(start);

    while (queue.length > 0) {
      const node = queue.shift()!;
      for (const neighbor of subAdj.get(node) ?? []) {
        if (!visited.has(neighbor)) {
          visited.add(neighbor);
          queue.push(neighbor);
        }
      }
    }

    // If not all members were visited, the community is disconnected
    if (visited.size < members.length) {
      // Find connected components and split
      const unvisited = members.filter((m) => !visited.has(m));

      // Assign unvisited nodes to their own new community
      // Use the maximum assignment value + 1
      let nextComm = Math.max(...assignment) + 1;

      // BFS to find each disconnected component
      const remaining = new Set(unvisited);
      while (remaining.size > 0) {
        const componentStart = remaining.values().next().value as number;
        const component = new Set<number>();
        const bfsQueue = [componentStart];
        component.add(componentStart);
        remaining.delete(componentStart);

        while (bfsQueue.length > 0) {
          const node = bfsQueue.shift()!;
          for (const neighbor of subAdj.get(node) ?? []) {
            if (remaining.has(neighbor)) {
              component.add(neighbor);
              remaining.delete(neighbor);
              bfsQueue.push(neighbor);
            }
          }
        }

        // Assign this component a new community
        for (const node of component) {
          assignment[node] = nextComm;
        }
        nextComm++;
      }
    }
  }
}

function renumberCommunities(assignment: number[]): number[] {
  const mapping = new Map<number, number>();
  let next = 0;

  return assignment.map((comm) => {
    if (!mapping.has(comm)) {
      mapping.set(comm, next++);
    }
    return mapping.get(comm)!;
  });
}

// ── Post-processing ───────────────────────────────────────────────────────────

function groupByCommunity(nodes: string[], assignment: number[]): Map<number, string[]> {
  const groups = new Map<number, string[]>();
  for (let i = 0; i < nodes.length; i++) {
    const comm = assignment[i]!;
    if (!groups.has(comm)) {
      groups.set(comm, []);
    }
    groups.get(comm)!.push(nodes[i]!);
  }
  return groups;
}

function postProcess(
  groups: Map<number, string[]>,
  graph: Graph,
  opts: CommunityDetectorOptions
): Map<number, string[]> {
  const totalNodes = graph.nodes.length;
  const maxSize = Math.max(opts.minCommunitySize, Math.floor(totalNodes * opts.maxCommunityFraction));
  let result = new Map(groups);

  // Split oversized communities
  let nextId = Math.max(...result.keys()) + 1;
  for (const [id, files] of [...result.entries()]) {
    if (files.length > maxSize) {
      // Simple split: divide into chunks of maxSize
      const chunks = chunkArray(files, maxSize);
      result.delete(id);
      for (const chunk of chunks) {
        result.set(nextId++, chunk);
      }
    }
  }

  // Merge tiny communities into nearest neighbor
  const tinyIds: number[] = [];
  for (const [id, files] of result) {
    if (files.length < opts.minCommunitySize) {
      tinyIds.push(id);
    }
  }

  for (const tinyId of tinyIds) {
    const tinyFiles = result.get(tinyId);
    if (!tinyFiles) continue;

    // Find nearest community (most shared edges)
    let bestTarget = -1;
    let bestEdges = 0;

    for (const [otherId, otherFiles] of result) {
      if (otherId === tinyId) continue;
      if (otherFiles.length < opts.minCommunitySize) continue;

      let sharedEdges = 0;
      const otherSet = new Set(otherFiles);
      for (const file of tinyFiles) {
        const idx = graph.nodeIndex.get(file);
        if (idx === undefined) continue;
        for (const neighborIdx of graph.adjacency[idx]!) {
          const neighborFile = graph.nodes[neighborIdx];
          if (neighborFile && otherSet.has(neighborFile)) {
            sharedEdges++;
          }
        }
      }

      if (sharedEdges > bestEdges) {
        bestEdges = sharedEdges;
        bestTarget = otherId;
      }
    }

    if (bestTarget !== -1) {
      const targetFiles = result.get(bestTarget)!;
      targetFiles.push(...tinyFiles);
      result.delete(tinyId);
    }
  }

  return result;
}

function chunkArray<T>(arr: T[], chunkSize: number): T[][] {
  const chunks: T[][] = [];
  for (let i = 0; i < arr.length; i += chunkSize) {
    chunks.push(arr.slice(i, i + chunkSize));
  }
  return chunks;
}

// ── Community Data Builder ────────────────────────────────────────────────────

function buildCommunityData(
  groups: Map<number, string[]>,
  graph: Graph,
  symbolStore: SymbolStore,
  detectedAt: string,
  resolution: number
): CommunityData[] {
  const communities: CommunityData[] = [];

  // Build file→community lookup
  const fileToCommunity = new Map<string, number>();
  for (const [commId, files] of groups) {
    for (const file of files) {
      fileToCommunity.set(file, commId);
    }
  }

  for (const [_, files] of groups) {
    const id = crypto.randomUUID();

    // Calculate centrality (degree within community / total degree)
    const centralities = new Map<string, number>();
    const fileSet = new Set(files);

    let internalEdges = 0;
    let externalEdges = 0;

    for (const file of files) {
      const idx = graph.nodeIndex.get(file);
      if (idx === undefined) {
        centralities.set(file, 0);
        continue;
      }

      const neighbors = graph.adjacency[idx]!;
      let internalDeg = 0;
      let totalDeg = neighbors.length;

      for (const nIdx of neighbors) {
        const neighborFile = graph.nodes[nIdx];
        if (neighborFile && fileSet.has(neighborFile)) {
          internalDeg++;
          internalEdges++;
        } else {
          externalEdges++;
        }
      }

      centralities.set(file, totalDeg > 0 ? internalDeg / totalDeg : 0);
    }

    // Each internal edge counted twice (undirected)
    internalEdges = Math.floor(internalEdges / 2);

    // Cohesion: internal edge density
    const possibleInternal = files.length > 1
      ? (files.length * (files.length - 1)) / 2
      : 1;
    const cohesionScore = Math.min(1, internalEdges / possibleInternal);

    // Coupling: external / total edges
    const totalEdgesForComm = internalEdges + externalEdges;
    const couplingScore = totalEdgesForComm > 0
      ? externalEdges / totalEdgesForComm
      : 0;

    // Risk level from coupling
    const riskLevel: 'LOW' | 'MEDIUM' | 'HIGH' =
      couplingScore > 0.6 ? 'HIGH' :
      couplingScore > 0.4 ? 'MEDIUM' :
      'LOW';

    // Auto-name community
    const name = nameCommunity(files, symbolStore);

    communities.push({
      id,
      name,
      description: `${files.length} files · cohesion: ${cohesionScore.toFixed(2)} · coupling: ${couplingScore.toFixed(2)}`,
      files,
      fileCount: files.length,
      cohesionScore,
      couplingScore,
      riskLevel,
      detectedAt,
      algorithm: 'leiden',
      resolution,
      centralities,
    });
  }

  // Deduplicate community names
  deduplicateNames(communities);

  return communities;
}

// ── Community Naming ──────────────────────────────────────────────────────────

function nameCommunity(files: string[], symbolStore: SymbolStore): string {
  // Strategy 1: Common path prefix
  const pathName = getCommonPathSegment(files);
  if (pathName && pathName !== 'src') {
    return pathName;
  }

  // Strategy 2: Dominant directory name
  const dirCounts = new Map<string, number>();
  for (const file of files) {
    const parts = file.split('/');
    // Pick the most specific directory (2nd from last)
    const dir = parts.length >= 2 ? parts[parts.length - 2] : null;
    if (dir && dir !== 'src') {
      dirCounts.set(dir, (dirCounts.get(dir) ?? 0) + 1);
    }
  }

  if (dirCounts.size > 0) {
    const sorted = [...dirCounts.entries()].sort((a, b) => b[1] - a[1]);
    const top = sorted[0];
    if (top && top[1] >= Math.ceil(files.length / 2)) {
      return top[0];
    }
  }

  // Strategy 3: Dominant export keyword
  const keywords = new Map<string, number>();
  for (const file of files) {
    const symbolMap = symbolStore.get(file);
    if (!symbolMap) continue;

    for (const exp of symbolMap.exports) {
      // Extract keyword from CamelCase or snake_case
      const words = exp.name
        .replace(/([a-z])([A-Z])/g, '$1 $2')
        .replace(/_/g, ' ')
        .toLowerCase()
        .split(/\s+/);
      for (const word of words) {
        if (word.length > 2) {
          keywords.set(word, (keywords.get(word) ?? 0) + 1);
        }
      }
    }
  }

  if (keywords.size > 0) {
    const sorted = [...keywords.entries()].sort((a, b) => b[1] - a[1]);
    const top = sorted[0];
    if (top && top[1] >= 3) {
      return top[0];
    }
  }

  // Fallback
  return `community-${crypto.randomUUID().slice(0, 4)}`;
}

function getCommonPathSegment(files: string[]): string | null {
  if (files.length === 0) return null;

  const parts = files.map((f) => f.split('/'));
  const minLength = Math.min(...parts.map((p) => p.length));

  let commonDepth = 0;
  for (let i = 0; i < minLength; i++) {
    const segment = parts[0]![i];
    if (parts.every((p) => p[i] === segment)) {
      commonDepth = i + 1;
    } else {
      break;
    }
  }

  // Return the deepest common segment that's not just 'src'
  if (commonDepth > 0) {
    const prefix = parts[0]!.slice(0, commonDepth);
    // Pick the last meaningful segment
    const meaningful = prefix.filter((p) => p !== 'src' && p !== '.' && p !== '..');
    if (meaningful.length > 0) {
      return meaningful[meaningful.length - 1]!;
    }
  }

  return null;
}

function deduplicateNames(communities: CommunityData[]): void {
  const nameCounts = new Map<string, number>();
  for (const c of communities) {
    nameCounts.set(c.name, (nameCounts.get(c.name) ?? 0) + 1);
  }

  const seen = new Map<string, number>();
  for (const c of communities) {
    if ((nameCounts.get(c.name) ?? 0) > 1) {
      const idx = (seen.get(c.name) ?? 0) + 1;
      seen.set(c.name, idx);
      if (idx > 1) {
        c.name = `${c.name}-${idx}`;
      }
    }
  }
}

// ── Cross-Community Edges ─────────────────────────────────────────────────────

function calculateCommunityEdges(
  graph: Graph,
  assignment: number[],
  communities: CommunityData[]
): Array<{ from: string; to: string; edgeCount: number }> {
  // Build node → community name lookup
  const fileToCommunityName = new Map<string, string>();
  for (const comm of communities) {
    for (const file of comm.files) {
      fileToCommunityName.set(file, comm.name);
    }
  }

  const edgeCounts = new Map<string, number>();

  for (let i = 0; i < graph.nodes.length; i++) {
    const fileA = graph.nodes[i]!;
    const commA = fileToCommunityName.get(fileA);
    if (!commA) continue;

    for (const j of graph.adjacency[i]!) {
      if (j <= i) continue; // avoid double-counting
      const fileB = graph.nodes[j]!;
      const commB = fileToCommunityName.get(fileB);
      if (!commB || commA === commB) continue;

      const key = [commA, commB].sort().join('→');
      edgeCounts.set(key, (edgeCounts.get(key) ?? 0) + 1);
    }
  }

  const result: Array<{ from: string; to: string; edgeCount: number }> = [];
  for (const [key, count] of edgeCounts) {
    const [from, to] = key.split('→') as [string, string];
    result.push({ from, to, edgeCount: count });
  }

  return result;
}

// ── Modularity Calculation ────────────────────────────────────────────────────

function calculateModularity(graph: Graph, assignment: number[]): number {
  const n = graph.nodes.length;
  const m = graph.totalWeight;
  if (m === 0) return 0;

  let q = 0;

  for (let i = 0; i < n; i++) {
    const ki = graph.adjacency[i]!.length;
    for (const j of graph.adjacency[i]!) {
      if (assignment[i] !== assignment[j]) continue;

      const kj = graph.adjacency[j]!.length;
      // Q += A_ij - (k_i × k_j / 2m)
      q += 1 - (ki * kj) / (2 * m);
    }
  }

  return q / (2 * m);
}
