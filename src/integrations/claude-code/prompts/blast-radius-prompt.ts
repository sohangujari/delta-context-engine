/**
 * blast_radius prompt — "What does this change break?"
 *
 * Assembles blast radius + communities + flows + risks + memories
 * into a structured Markdown output for AI context injection.
 */

import type { AllStores } from './index.js';
import { shortPath } from './index.js';
import { calculateBlastRadius } from '../../../core/graph/blast-radius.js';
import { getGitChangedFiles } from '../../../core/change-detector/git-diff.js';

export interface BlastRadiusPromptInput {
  filePaths?: string[] | undefined;
  symbols?: string[] | undefined;
  projectRoot?: string | undefined;
}

export async function buildBlastRadiusPrompt(
  input: BlastRadiusPromptInput,
  stores: AllStores
): Promise<string> {
  const root = input.projectRoot ?? stores.projectRoot;

  // 1. Detect changed files (or use provided)
  let changedFiles = input.filePaths ?? [];
  if (changedFiles.length === 0) {
    try {
      const gitResult = await getGitChangedFiles(root);
      changedFiles = gitResult.changedFiles.slice(0, 20);
    } catch {
      changedFiles = [];
    }
  }

  if (changedFiles.length === 0) {
    return '# ∆ Blast Radius Analysis\n\nNo changed files detected. Pass `filePaths` or make changes first.';
  }

  // 2. Calculate blast radius for each file
  const blastResults = [];
  for (const file of changedFiles) {
    try {
      const result = await calculateBlastRadius(
        file, stores.graphStore, stores.communityStore,
        stores.flowStore, stores.symbolStore, { projectRoot: root }
      );
      blastResults.push(result);
    } catch {
      // Skip files that can't be analyzed
    }
  }

  // 3. Aggregate results
  const allAffected = new Set<string>();
  const allFlows: string[] = [];
  const allCommunities = new Set<string>();
  let maxRisk = 0;

  for (const br of blastResults) {
    for (const dep of br.directDependents) allAffected.add(dep);
    for (const dep of br.transitiveDependents) allAffected.add(dep);
    for (const c of br.communitiesAffected) allCommunities.add(c.name);
    for (const f of br.flowsAffected) allFlows.push(f.name);
    if (br.overallRisk > maxRisk) maxRisk = br.overallRisk;
  }

  // 4. Get risk scores for affected files
  const highRiskFiles = stores.riskStore.getAll()
    .filter(r => allAffected.has(r.filePath) || changedFiles.includes(r.filePath))
    .filter(r => r.riskLevel === 'HIGH' || r.riskLevel === 'MEDIUM')
    .sort((a, b) => b.overallScore - a.overallScore)
    .slice(0, 10);

  // 5. Check for hub files
  const hubFiles = stores.hubStore.getHubs()
    .filter(h => allAffected.has(h.filePath) || changedFiles.includes(h.filePath));

  // 6. Find relevant memories
  const memories = stores.memoryStore.getAll()
    .filter(m => m.filePaths.some(fp => changedFiles.includes(fp) || allAffected.has(fp)))
    .slice(0, 5);

  // 7. Format output
  const riskLevel = maxRisk > 0.7 ? 'HIGH' : maxRisk > 0.4 ? 'MEDIUM' : 'LOW';
  const uniqueFlows = [...new Set(allFlows)];

  return `# ∆ Blast Radius Analysis

## Changed Files
${changedFiles.map(f => `- \`${shortPath(f, root)}\``).join('\n')}

## Impact Summary
- **Total affected files:** ${allAffected.size}
- **Communities affected:** ${[...allCommunities].join(', ') || 'none'}
- **Execution flows affected:** ${uniqueFlows.length}
- **Overall risk:** ${riskLevel} (${maxRisk.toFixed(2)})

## Direct & Transitive Dependents
${blastResults.map(br => {
  const deps = [...br.directDependents, ...br.transitiveDependents].slice(0, 10);
  return deps.length > 0
    ? `### \`${shortPath(br.targetFile, root)}\`\n${deps.map(d => `- \`${shortPath(d, root)}\``).join('\n')}`
    : '';
}).filter(Boolean).join('\n\n')}

${uniqueFlows.length > 0 ? `## Execution Flows Affected
${uniqueFlows.map(f => `- **${f}**`).join('\n')}` : ''}

${highRiskFiles.length > 0 ? `## Risk Breakdown
${highRiskFiles.map(r => `- \`${shortPath(r.filePath, root)}\` — ${r.riskLevel} (${r.overallScore.toFixed(2)})`).join('\n')}` : ''}

${hubFiles.length > 0 ? `## Architectural Warnings
${hubFiles.map(h => `- ⚠ \`${shortPath(h.filePath, root)}\` is an architectural HUB (betweenness: ${h.betweenness.toFixed(2)})`).join('\n')}` : ''}

${memories.length > 0 ? `## Relevant Memory
${memories.map(m => `### ${m.title} (${m.confidence})\n${m.content}`).join('\n\n')}` : ''}

## Recommended Actions
${buildRecommendations(riskLevel, hubFiles.length, highRiskFiles.length, uniqueFlows.length)}
`.trim();
}

function buildRecommendations(
  riskLevel: string, hubCount: number, highRiskCount: number, flowCount: number
): string {
  const recs: string[] = [];
  if (riskLevel === 'HIGH') recs.push('- ⚠ HIGH risk changes — thorough testing recommended');
  if (hubCount > 0) recs.push('- Hub files changed — run full test suite');
  if (highRiskCount > 0) recs.push(`- ${highRiskCount} high/medium risk files in blast radius — review carefully`);
  if (flowCount > 3) recs.push(`- ${flowCount} execution flows affected — integration tests recommended`);
  if (recs.length === 0) recs.push('- Low risk change — standard review process');
  return recs.join('\n');
}
