/**
 * Risk Scorer — 5-dimension risk scoring for every file.
 *
 * Dimensions:
 *   1. Security sensitivity (keywords in path, exports, source)
 *   2. Test coverage gap (no tests = high risk)
 *   3. Cross-community callers (multi-community dependents)
 *   4. Flow participation (how many critical flows touch this file)
 *   5. Surprise coupling (unexpected cross-community edges)
 */

import fs from 'fs';
import type { GraphStore } from '../../persistence/graph-store.js';
import type { SymbolStore } from '../../persistence/symbol-store.js';
import type { CommunityStore } from '../../persistence/community-store.js';
import type { FlowStore } from '../../persistence/flow-store.js';

// ── Types ─────────────────────────────────────────────────────────────────────

export interface RiskScoreOptions {
  projectRoot: string;
  securityWeight: number;
  testCoverageWeight: number;
  crossCommunityWeight: number;
  flowParticipationWeight: number;
  surpriseCouplingWeight: number;
}

export interface FileRiskScore {
  filePath: string;
  dimensions: {
    security: number;
    testCoverage: number;
    crossCommunity: number;
    flowParticipation: number;
    surpriseCoupling: number;
  };
  overallScore: number;
  riskLevel: 'LOW' | 'MEDIUM' | 'HIGH';
  reasons: string[];
  calculatedAt: string;
}

const DEFAULT_OPTIONS: RiskScoreOptions = {
  projectRoot: '.',
  securityWeight: 0.25,
  testCoverageWeight: 0.20,
  crossCommunityWeight: 0.20,
  flowParticipationWeight: 0.20,
  surpriseCouplingWeight: 0.15,
};

// ── Security Keywords ─────────────────────────────────────────────────────────

const SECURITY_KEYWORDS = [
  'password', 'passwd', 'secret', 'token', 'key', 'apikey', 'api_key',
  'auth', 'cred', 'credential', 'encrypt', 'decrypt', 'hash', 'salt',
  'jwt', 'oauth', 'session', 'cookie', 'csrf', 'xss', 'sql', 'query',
  'exec', 'eval', 'spawn', 'env', 'process.env',
  'readFile', 'writeFile', 'unlink', 'rmdir', 'chmod', 'chown',
];

// ── Public API ────────────────────────────────────────────────────────────────

export async function scoreAllFiles(
  allFiles: string[],
  symbolStore: SymbolStore,
  graphStore: GraphStore,
  communityStore: CommunityStore,
  flowStore: FlowStore,
  projectRoot: string,
  options?: Partial<RiskScoreOptions>
): Promise<FileRiskScore[]> {
  const opts = { ...DEFAULT_OPTIONS, ...options, projectRoot };
  const scores: FileRiskScore[] = [];

  for (const filePath of allFiles) {
    const score = scoreFile(
      filePath, symbolStore, graphStore, communityStore, flowStore, opts
    );
    scores.push(score);
  }

  scores.sort((a, b) => b.overallScore - a.overallScore);
  return scores;
}

export function scoreFile(
  filePath: string,
  symbolStore: SymbolStore,
  graphStore: GraphStore,
  communityStore: CommunityStore,
  flowStore: FlowStore,
  options: RiskScoreOptions
): FileRiskScore {
  const reasons: string[] = [];
  const calculatedAt = new Date().toISOString();

  // Dimension 1: Security sensitivity
  const security = scoreSecuritySensitivity(filePath, symbolStore, reasons);

  // Dimension 2: Test coverage gap
  const testCoverage = scoreTestCoverageGap(filePath, graphStore, reasons);

  // Dimension 3: Cross-community callers
  const crossCommunity = scoreCrossCommunityCallers(
    filePath, graphStore, communityStore, reasons
  );

  // Dimension 4: Flow participation
  const flowParticipation = scoreFlowParticipation(filePath, flowStore, reasons);

  // Dimension 5: Surprise coupling
  const surpriseCoupling = scoreSurpriseCoupling(
    filePath, graphStore, communityStore, reasons
  );

  const dimensions = {
    security,
    testCoverage,
    crossCommunity,
    flowParticipation,
    surpriseCoupling,
  };

  const overallScore =
    dimensions.security * options.securityWeight +
    dimensions.testCoverage * options.testCoverageWeight +
    dimensions.crossCommunity * options.crossCommunityWeight +
    dimensions.flowParticipation * options.flowParticipationWeight +
    dimensions.surpriseCoupling * options.surpriseCouplingWeight;

  const riskLevel: 'LOW' | 'MEDIUM' | 'HIGH' =
    overallScore >= 0.7 ? 'HIGH' :
    overallScore >= 0.4 ? 'MEDIUM' :
    'LOW';

  return {
    filePath,
    dimensions,
    overallScore,
    riskLevel,
    reasons,
    calculatedAt,
  };
}

// ── Dimension 1: Security Sensitivity ─────────────────────────────────────────

function scoreSecuritySensitivity(
  filePath: string,
  symbolStore: SymbolStore,
  reasons: string[]
): number {
  let score = 0;
  const lowerPath = filePath.toLowerCase();

  // Check file path
  const pathHits = SECURITY_KEYWORDS.filter((kw) => lowerPath.includes(kw));
  if (pathHits.length > 0) {
    score += 0.4;
    reasons.push(`Security: path contains ${pathHits.join(', ')}`);
  }

  // Check exported function names
  const symbolMap = symbolStore.get(filePath);
  if (symbolMap) {
    const exportHits = symbolMap.exports.filter((exp) =>
      SECURITY_KEYWORDS.some((kw) => exp.name.toLowerCase().includes(kw))
    );
    if (exportHits.length > 0) {
      score += Math.min(0.3, exportHits.length * 0.15);
      reasons.push(
        `Security: exports ${exportHits.map((e) => e.name).join(', ')}`
      );
    }

    // Check function names
    const funcHits = symbolMap.functions.filter((fn) =>
      SECURITY_KEYWORDS.some((kw) => fn.name.toLowerCase().includes(kw))
    );
    if (funcHits.length > 0) {
      score += Math.min(0.3, funcHits.length * 0.1);
    }
  }

  return Math.min(1.0, score);
}

// ── Dimension 2: Test Coverage Gap ────────────────────────────────────────────

function scoreTestCoverageGap(
  filePath: string,
  graphStore: GraphStore,
  reasons: string[]
): number {
  // If the file IS a test, no gap
  const isTest = /\.(test|spec)\.(ts|js|tsx|jsx)$/.test(filePath)
              || /\/__tests__\//.test(filePath);
  if (isTest) return 0.0;

  // Check if any test file depends on (imports) this file
  const dependents = graphStore.getDependents(filePath);
  const hasTestImporter = dependents.some(
    (dep) =>
      /\.(test|spec)\.(ts|js|tsx|jsx)$/.test(dep) ||
      /\/__tests__\//.test(dep)
  );

  if (hasTestImporter) {
    return 0.0; // Has test coverage
  }

  // No coverage detected
  reasons.push('Test gap: no test file imports this module');
  return 1.0;
}

// ── Dimension 3: Cross-Community Callers ──────────────────────────────────────

function scoreCrossCommunityCallers(
  filePath: string,
  graphStore: GraphStore,
  communityStore: CommunityStore,
  reasons: string[]
): number {
  const thisCommunity = communityStore.getForFile(filePath);
  const dependents = graphStore.getDependents(filePath);

  const callerCommunities = new Set<string>();
  for (const dep of dependents) {
    const depComm = communityStore.getForFile(dep);
    if (depComm && depComm.name !== thisCommunity?.name) {
      callerCommunities.add(depComm.name);
    }
  }

  if (callerCommunities.size > 0) {
    reasons.push(
      `Cross-community: called by ${callerCommunities.size} other communities (${[...callerCommunities].join(', ')})`
    );
  }

  // 0 → 0.0, 1 → 0.3, 2 → 0.6, 3+ → 1.0
  return Math.min(1.0, callerCommunities.size / 3);
}

// ── Dimension 4: Flow Participation ───────────────────────────────────────────

function scoreFlowParticipation(
  filePath: string,
  flowStore: FlowStore,
  reasons: string[]
): number {
  const flows = flowStore.getFlowsForFile(filePath);

  if (flows.length === 0) return 0.0;

  const maxCriticality = Math.max(...flows.map((f) => f.criticality));
  const flowCount = Math.min(1.0, flows.length / 5);
  const score = 0.5 * flowCount + 0.5 * maxCriticality;

  reasons.push(
    `Flows: participates in ${flows.length} flows (max criticality: ${maxCriticality.toFixed(2)})`
  );

  return score;
}

// ── Dimension 5: Surprise Coupling ────────────────────────────────────────────

function scoreSurpriseCoupling(
  filePath: string,
  graphStore: GraphStore,
  communityStore: CommunityStore,
  reasons: string[]
): number {
  const thisCommunity = communityStore.getForFile(filePath);
  if (!thisCommunity) return 0.0;

  const deps = graphStore.getDependencies(filePath);
  const dependents = graphStore.getDependents(filePath);
  const neighbors = [...deps, ...dependents];

  const communityEdges = communityStore.getCommunityEdges();
  let surpriseScore = 0;

  for (const neighbor of neighbors) {
    const neighborComm = communityStore.getForFile(neighbor);
    if (!neighborComm || neighborComm.name === thisCommunity.name) continue;

    // Find the cross-community edge count
    const crossEdge = communityEdges.find(
      (e) =>
        (e.from === thisCommunity.name && e.to === neighborComm.name) ||
        (e.from === neighborComm.name && e.to === thisCommunity.name)
    );

    const edgeCount = crossEdge?.edgeCount ?? 0;
    // Solo cross-community edge = high surprise
    surpriseScore += edgeCount <= 1 ? 0.4 : 0.1;
  }

  if (surpriseScore > 0) {
    reasons.push(`Surprise: unexpected cross-community connections`);
  }

  return Math.min(1.0, surpriseScore);
}
