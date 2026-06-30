/**
 * Blast Radius Calculator — Impact analysis for changed files.
 *
 * Given a changed file, calculates:
 * 1. Direct + transitive dependents (reverse graph BFS)
 * 2. Community spread (how many communities affected)
 * 3. Flow impact (which execution flows are disrupted)
 * 4. Test coverage gaps (affected files without tests)
 * 5. Surprise connections (unexpected cross-community edges)
 * 6. Overall risk score (weighted 4-dimension formula)
 */

import type { GraphStore } from '../../persistence/graph-store.js';
import type { CommunityStore } from '../../persistence/community-store.js';
import type { FlowStore } from '../../persistence/flow-store.js';
import type { SymbolStore } from '../../persistence/symbol-store.js';

// ── Types ─────────────────────────────────────────────────────────────────────

export interface BlastRadiusOptions {
  projectRoot: string;
  maxDepth: number;
  includeTests: boolean;
  includeCommunities: boolean;
  includeFlows: boolean;
}

export interface BlastRadiusResult {
  targetFile: string;
  targetSymbol?: string;

  directDependents: string[];
  transitiveDependents: string[];
  totalAffectedFiles: number;

  communitiesAffected: Array<{
    name: string;
    filesAffected: number;
    riskLevel: string;
  }>;

  flowsAffected: Array<{
    name: string;
    entryType: string;
    criticality: number;
    stepsAffected: number;
  }>;

  testsRequired: string[];
  testGaps: string[];

  surpriseConnections: Array<{
    file: string;
    reason: string;
    score: number;
  }>;

  overallRisk: number;
  riskLevel: 'LOW' | 'MEDIUM' | 'HIGH';
  riskBreakdown: {
    dependentCount: number;
    communitySpread: number;
    flowCriticality: number;
    testCoverage: number;
  };
}

const DEFAULT_OPTIONS: BlastRadiusOptions = {
  projectRoot: '.',
  maxDepth: 5,
  includeTests: true,
  includeCommunities: true,
  includeFlows: true,
};

// ── Public API ────────────────────────────────────────────────────────────────

export async function calculateBlastRadius(
  filePath: string,
  graphStore: GraphStore,
  communityStore: CommunityStore,
  flowStore: FlowStore,
  symbolStore: SymbolStore,
  options?: Partial<BlastRadiusOptions>
): Promise<BlastRadiusResult> {
  const opts = { ...DEFAULT_OPTIONS, ...options };

  // Step 1: Find all dependents (reverse graph BFS)
  const { direct, transitive } = findAllDependents(
    filePath, graphStore, opts.maxDepth
  );

  const allAffected = new Set([filePath, ...direct, ...transitive]);

  // Step 2: Community spread
  const communitiesAffected = opts.includeCommunities
    ? calculateCommunitySpread(allAffected, communityStore)
    : [];

  // Step 3: Flow impact
  const flowsAffected = opts.includeFlows
    ? calculateFlowImpact(allAffected, flowStore)
    : [];

  // Step 4: Test coverage
  const { testsRequired, testGaps } = opts.includeTests
    ? findTestCoverage(allAffected, graphStore)
    : { testsRequired: [], testGaps: [] };

  // Step 5: Surprise connections
  const surpriseConnections = opts.includeCommunities
    ? findSurpriseConnections(filePath, direct, communityStore)
    : [];

  // Step 6: Overall risk score
  const riskBreakdown = calculateRiskBreakdown(
    allAffected.size,
    communitiesAffected,
    flowsAffected,
    testGaps,
    allAffected.size
  );

  const overallRisk =
    0.25 * riskBreakdown.dependentCount +
    0.25 * riskBreakdown.communitySpread +
    0.30 * riskBreakdown.flowCriticality +
    0.20 * riskBreakdown.testCoverage;

  const riskLevel: 'LOW' | 'MEDIUM' | 'HIGH' =
    overallRisk >= 0.7 ? 'HIGH' :
    overallRisk >= 0.4 ? 'MEDIUM' :
    'LOW';

  return {
    targetFile: filePath,
    directDependents: direct,
    transitiveDependents: transitive,
    totalAffectedFiles: allAffected.size,
    communitiesAffected,
    flowsAffected,
    testsRequired,
    testGaps,
    surpriseConnections,
    overallRisk,
    riskLevel,
    riskBreakdown,
  };
}

// ── Step 1: Reverse BFS for dependents ────────────────────────────────────────

function findAllDependents(
  filePath: string,
  graphStore: GraphStore,
  maxDepth: number
): { direct: string[]; transitive: string[] } {
  const direct: string[] = [];
  const transitive: string[] = [];
  const visited = new Set<string>([filePath]);
  const queue: Array<{ file: string; depth: number }> = [
    { file: filePath, depth: 0 },
  ];

  while (queue.length > 0) {
    const current = queue.shift()!;
    if (current.depth >= maxDepth) continue;

    const dependents = graphStore.getDependents(current.file);
    for (const dep of dependents) {
      if (visited.has(dep)) continue;
      visited.add(dep);

      if (current.depth === 0) {
        direct.push(dep);
      } else {
        transitive.push(dep);
      }

      queue.push({ file: dep, depth: current.depth + 1 });
    }
  }

  return { direct, transitive };
}

// ── Step 2: Community spread ──────────────────────────────────────────────────

function calculateCommunitySpread(
  affectedFiles: Set<string>,
  communityStore: CommunityStore
): Array<{ name: string; filesAffected: number; riskLevel: string }> {
  const communityImpact = new Map<string, { count: number; riskLevel: string }>();

  for (const file of affectedFiles) {
    const community = communityStore.getForFile(file);
    if (!community) continue;

    const existing = communityImpact.get(community.name);
    if (existing) {
      existing.count++;
    } else {
      communityImpact.set(community.name, {
        count: 1,
        riskLevel: community.riskLevel,
      });
    }
  }

  return [...communityImpact.entries()].map(([name, data]) => ({
    name,
    filesAffected: data.count,
    riskLevel: data.riskLevel,
  }));
}

// ── Step 3: Flow impact ───────────────────────────────────────────────────────

function calculateFlowImpact(
  affectedFiles: Set<string>,
  flowStore: FlowStore
): Array<{ name: string; entryType: string; criticality: number; stepsAffected: number }> {
  const flowImpact = new Map<string, {
    name: string;
    entryType: string;
    criticality: number;
    stepsAffected: number;
  }>();

  for (const file of affectedFiles) {
    const flows = flowStore.getFlowsForFile(file);
    for (const flow of flows) {
      if (flowImpact.has(flow.id)) {
        flowImpact.get(flow.id)!.stepsAffected++;
      } else {
        flowImpact.set(flow.id, {
          name: flow.name,
          entryType: flow.entryType,
          criticality: flow.criticality,
          stepsAffected: 1,
        });
      }
    }
  }

  return [...flowImpact.values()].sort((a, b) => b.criticality - a.criticality);
}

// ── Step 4: Test coverage ─────────────────────────────────────────────────────

function findTestCoverage(
  affectedFiles: Set<string>,
  graphStore: GraphStore
): { testsRequired: string[]; testGaps: string[] } {
  const testsRequired: string[] = [];
  const testGaps: string[] = [];

  for (const file of affectedFiles) {
    const isTest = /\.(test|spec)\.(ts|js|tsx|jsx)$/.test(file)
                || /\/__tests__\//.test(file);

    if (isTest) {
      testsRequired.push(file);
      continue;
    }

    // Check if any test file depends on (imports) this file
    const dependents = graphStore.getDependents(file);
    const hasTest = dependents.some(
      (dep) =>
        /\.(test|spec)\.(ts|js|tsx|jsx)$/.test(dep) ||
        /\/__tests__\//.test(dep)
    );

    if (hasTest) {
      // Find the test files
      const testFiles = dependents.filter(
        (dep) =>
          /\.(test|spec)\.(ts|js|tsx|jsx)$/.test(dep) ||
          /\/__tests__\//.test(dep)
      );
      testsRequired.push(...testFiles);
    } else {
      testGaps.push(file);
    }
  }

  // Deduplicate
  return {
    testsRequired: [...new Set(testsRequired)],
    testGaps: [...new Set(testGaps)],
  };
}

// ── Step 5: Surprise connections ──────────────────────────────────────────────

function findSurpriseConnections(
  targetFile: string,
  directDependents: string[],
  communityStore: CommunityStore
): Array<{ file: string; reason: string; score: number }> {
  const targetCommunity = communityStore.getForFile(targetFile);
  if (!targetCommunity) return [];

  const surprises: Array<{ file: string; reason: string; score: number }> = [];

  for (const dep of directDependents) {
    const depCommunity = communityStore.getForFile(dep);
    if (!depCommunity) continue;

    if (depCommunity.name !== targetCommunity.name) {
      // Cross-community direct dependency = potential surprise
      const edges = communityStore.getCommunityEdges();
      const crossEdge = edges.find(
        (e) =>
          (e.from === targetCommunity.name && e.to === depCommunity.name) ||
          (e.from === depCommunity.name && e.to === targetCommunity.name)
      );

      // Fewer shared edges = higher surprise
      const edgeCount = crossEdge?.edgeCount ?? 0;
      const score = edgeCount <= 1 ? 0.8 : edgeCount <= 3 ? 0.5 : 0.2;

      if (score >= 0.4) {
        surprises.push({
          file: dep,
          reason: `${targetCommunity.name}→${depCommunity.name} unexpected coupling`,
          score,
        });
      }
    }
  }

  return surprises.sort((a, b) => b.score - a.score);
}

// ── Step 6: Risk breakdown ────────────────────────────────────────────────────

function calculateRiskBreakdown(
  totalAffected: number,
  communitiesAffected: Array<{ name: string; filesAffected: number; riskLevel: string }>,
  flowsAffected: Array<{ name: string; criticality: number; stepsAffected: number }>,
  testGaps: string[],
  totalFiles: number
): {
  dependentCount: number;
  communitySpread: number;
  flowCriticality: number;
  testCoverage: number;
} {
  const dependentCount = Math.min(1.0, totalAffected / 20);
  const communitySpread = Math.min(1.0, communitiesAffected.length / 5);

  const flowCriticality = flowsAffected.length > 0
    ? flowsAffected.reduce((sum, f) => sum + f.criticality, 0) / flowsAffected.length
    : 0;

  const testCoverage = totalFiles > 0
    ? testGaps.length / totalFiles
    : 0;

  return { dependentCount, communitySpread, flowCriticality, testCoverage };
}
