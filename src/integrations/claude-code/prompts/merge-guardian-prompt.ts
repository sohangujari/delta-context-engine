/**
 * merge_guardian prompt — "Is this PR safe to merge?"
 *
 * Assembles risk + blast radius + test gaps + community violations
 * into an APPROVE / REVIEW / BLOCK recommendation.
 */

import type { AllStores } from './index.js';
import { shortPath } from './index.js';
import { calculateBlastRadius } from '../../../core/graph/blast-radius.js';
import { getGitChangedFiles } from '../../../core/change-detector/git-diff.js';

export interface MergeGuardianInput {
  changedFiles?: string[] | undefined;
  branchName?: string | undefined;
  projectRoot?: string | undefined;
}

export async function buildMergeGuardianPrompt(
  input: MergeGuardianInput,
  stores: AllStores
): Promise<string> {
  const root = input.projectRoot ?? stores.projectRoot;
  const branchLabel = input.branchName ?? 'current changes';

  // 1. Get changed files
  let changedFiles = input.changedFiles ?? [];
  if (changedFiles.length === 0) {
    try {
      const gitResult = await getGitChangedFiles(root);
      changedFiles = gitResult.changedFiles.slice(0, 30);
    } catch {
      changedFiles = [];
    }
  }

  if (changedFiles.length === 0) {
    return `# ∆ Merge Guardian: ${branchLabel}\n\nNo changed files detected. Pass \`changedFiles\` or make changes first.`;
  }

  // 2. Risk scores for changed files
  const allRisks = stores.riskStore.getAll();
  const changedRisks = allRisks
    .filter(r => changedFiles.includes(r.filePath))
    .sort((a, b) => b.overallScore - a.overallScore);

  // 3. Blast radius
  let totalAffected = 0;
  let totalFlows = 0;
  const affectedCommunities = new Set<string>();

  for (const file of changedFiles.slice(0, 10)) {
    try {
      const br = await calculateBlastRadius(
        file, stores.graphStore, stores.communityStore,
        stores.flowStore, stores.symbolStore, { projectRoot: root }
      );
      totalAffected += br.directDependents.length + br.transitiveDependents.length;
      totalFlows += br.flowsAffected.length;
      for (const c of br.communitiesAffected) affectedCommunities.add(c.name);
    } catch {
      // skip
    }
  }

  // 4. Test gap detection
  const testGaps = changedFiles.filter(f => {
    const risk = changedRisks.find(r => r.filePath === f);
    return risk && risk.dimensions.testCoverage > 0.5; // higher = less coverage
  });

  // 5. Hub/bridge files in changed set
  const hubFiles = stores.hubStore.getHubs()
    .filter(h => changedFiles.includes(h.filePath));
  const bridgeFiles = stores.hubStore.getBridges()
    .filter(b => changedFiles.includes(b.filePath));

  // 6. Cross-community changes
  const fileCommunities = new Map<string, string>();
  for (const f of changedFiles) {
    const c = stores.communityStore.getForFile(f);
    if (c) fileCommunities.set(f, c.name);
  }
  const uniqueCommunities = new Set(fileCommunities.values());
  const crossCommunity = uniqueCommunities.size > 2;

  // 7. Security-sensitive files
  const securityFiles = changedRisks.filter(r => r.dimensions.security > 0.5);

  // 8. Compute recommendation
  const recommendation = computeRecommendation({
    highRiskCount: changedRisks.filter(r => r.riskLevel === 'HIGH').length,
    testGapCount: testGaps.length,
    hubCount: hubFiles.length,
    securityCount: securityFiles.length,
    totalAffected,
    crossCommunity,
  });

  return `# ∆ Merge Guardian: ${branchLabel}

## Recommendation: ${recommendation === 'APPROVE' ? '✅ APPROVE' : recommendation === 'REVIEW' ? '⚠ REVIEW' : '🛑 BLOCK'}

## Changed Files (${changedFiles.length})
${changedFiles.map(f => {
  const risk = changedRisks.find(r => r.filePath === f);
  const level = risk?.riskLevel ?? 'LOW';
  const badge = level === 'HIGH' ? ' ⚠ HIGH RISK' : level === 'MEDIUM' ? ' ⚡ MEDIUM' : '';
  return `- \`${shortPath(f, root)}\` ${level} (${risk?.overallScore.toFixed(2) ?? '0.00'})${badge}`;
}).join('\n')}

## Blast Radius
- **${totalAffected} files affected** · ${totalFlows} flows · ${affectedCommunities.size} communities

${testGaps.length > 0 ? `## Test Gaps (${testGaps.length} files with low coverage)
${testGaps.map(f => `- \`${shortPath(f, root)}\`${changedRisks.find(r => r.filePath === f)?.riskLevel === 'HIGH' ? ' ← HIGH RISK, needs tests ⚠' : ''}`).join('\n')}` : '## Test Coverage\n✅ No significant test gaps detected'}

${hubFiles.length > 0 ? `## Hub Files Changed ⚠
${hubFiles.map(h => `- \`${shortPath(h.filePath, root)}\` (${h.degreeIn} dependents · betweenness: ${h.betweenness.toFixed(2)})`).join('\n')}` : ''}

${bridgeFiles.length > 0 ? `## Bridge Files Changed
${bridgeFiles.map(b => `- \`${shortPath(b.filePath, root)}\``).join('\n')}` : ''}

${crossCommunity ? `## Cross-Community Changes ⚠
Changes span ${uniqueCommunities.size} communities: ${[...uniqueCommunities].join(', ')}
Review for unintended coupling.` : ''}

${securityFiles.length > 0 ? `## Security-Sensitive Files ⚠
${securityFiles.map(s => `- \`${shortPath(s.filePath, root)}\` (security score: ${s.dimensions.security.toFixed(2)})`).join('\n')}` : ''}

## Why ${recommendation}
${explainRecommendation(recommendation, {
  highRiskCount: changedRisks.filter(r => r.riskLevel === 'HIGH').length,
  testGapCount: testGaps.length,
  hubCount: hubFiles.length,
  securityCount: securityFiles.length,
  totalAffected,
})}
`.trim();
}

interface RecommendationFactors {
  highRiskCount: number;
  testGapCount: number;
  hubCount: number;
  securityCount: number;
  totalAffected: number;
  crossCommunity?: boolean;
}

function computeRecommendation(f: RecommendationFactors): 'APPROVE' | 'REVIEW' | 'BLOCK' {
  if ((f.highRiskCount > 0 && f.testGapCount > 0) || f.securityCount > 1) return 'BLOCK';
  if (f.hubCount > 0 || f.highRiskCount > 0 || f.crossCommunity || f.totalAffected > 20) return 'REVIEW';
  return 'APPROVE';
}

function explainRecommendation(rec: string, f: RecommendationFactors): string {
  const reasons: string[] = [];
  if (rec === 'BLOCK') {
    if (f.highRiskCount > 0 && f.testGapCount > 0) reasons.push(`${f.highRiskCount} HIGH risk files with test gaps — add tests before merging`);
    if (f.securityCount > 1) reasons.push(`${f.securityCount} security-sensitive files changed — requires security review`);
  } else if (rec === 'REVIEW') {
    if (f.hubCount > 0) reasons.push(`Hub files changed — run full test suite`);
    if (f.highRiskCount > 0) reasons.push(`${f.highRiskCount} HIGH risk files — careful review needed`);
    if (f.totalAffected > 20) reasons.push(`Large blast radius (${f.totalAffected} files affected)`);
  } else {
    reasons.push('All changes are low risk with adequate test coverage');
  }
  return reasons.map(r => `- ${r}`).join('\n');
}
