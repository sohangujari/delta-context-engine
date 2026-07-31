/**
 * first_day prompt — "Get a new developer productive in minutes."
 *
 * Assembles architecture overview, entry points, conventions,
 * high-risk files, and tech stack into an onboarding guide.
 */

import type { AllStores } from './index.js';
import { shortPath } from './index.js';

export interface FirstDayInput {
  focusArea?: string | undefined;
  projectRoot?: string | undefined;
}

export async function buildFirstDayPrompt(
  input: FirstDayInput,
  stores: AllStores
): Promise<string> {
  const root = input.projectRoot ?? stores.projectRoot;

  // 1. Communities
  const communities = stores.communityStore.getAll();
  const totalFiles = stores.stateStore.getAll().length;

  // 2. Entry points (from flows)
  const flows = stores.flowStore.getAll()
    .sort((a, b) => b.criticality - a.criticality);

  const httpRoutes = flows.filter(f => f.entryType === 'HTTP_ROUTE').slice(0, 5);
  const cliCommands = flows.filter(f => f.entryType === 'CLI_CMD').slice(0, 5);
  const exports = flows.filter(f => f.entryType === 'EXPORT').slice(0, 5);

  // 3. Conventions from memory
  const conventions = stores.memoryStore.getAll()
    .filter(m => m.type === 'ARCHITECTURAL' || m.type === 'DECISION')
    .slice(0, 8);

  // 4. High-risk files
  const highRisk = stores.riskStore.getAll()
    .filter(r => r.riskLevel === 'HIGH')
    .sort((a, b) => b.overallScore - a.overallScore)
    .slice(0, 5);

  // 5. Hub files
  const hubs = stores.hubStore.getHubs().slice(0, 5);

  // 6. Focus area
  const focusCommunity = input.focusArea
    ? communities.find(c => c.name.toLowerCase().includes(input.focusArea!.toLowerCase()))
    : null;

  return `# ∆ Welcome to the Codebase

## Project Overview
- **${totalFiles} files** indexed across **${communities.length} communities**
- **${flows.length} execution flows** traced

## How the Code is Organised (${communities.length} communities)
${communities.map(c =>
  `- **${c.name}** (${c.fileCount} files): ${c.description || 'Cluster of related functionality'}`
).join('\n')}

${httpRoutes.length > 0 ? `## HTTP Entry Points
${httpRoutes.map(f => `- **${f.name}** → \`${shortPath(f.entryFile, root)}\` (criticality: ${f.criticality.toFixed(2)})`).join('\n')}` : ''}

${cliCommands.length > 0 ? `## CLI Commands
${cliCommands.map(f => `- **${f.name}** → \`${shortPath(f.entryFile, root)}\``).join('\n')}` : ''}

${exports.length > 0 ? `## Key Exports
${exports.map(f => `- **${f.entrySymbol}** from \`${shortPath(f.entryFile, root)}\``).join('\n')}` : ''}

${conventions.length > 0 ? `## Key Conventions
${conventions.map(m => `- **${m.title}**: ${m.content.slice(0, 150)}${m.content.length > 150 ? '...' : ''}`).join('\n')}` : ''}

${highRisk.length > 0 ? `## Files to Be Careful With (HIGH risk)
${highRisk.map(r => `- \`${shortPath(r.filePath, root)}\` — risk: ${r.overallScore.toFixed(2)} (security: ${r.dimensions.security.toFixed(2)}, coupling: ${r.dimensions.crossCommunity.toFixed(2)})`).join('\n')}` : ''}

${hubs.length > 0 ? `## Architectural Hub Files
These files are critical — many other files depend on them:
${hubs.map(h => `- \`${shortPath(h.filePath, root)}\` (${h.degreeIn} dependents)`).join('\n')}` : ''}

${focusCommunity ? `## Getting Started with "${focusCommunity.name}"
This community has ${focusCommunity.fileCount} files with cohesion ${focusCommunity.cohesionScore.toFixed(2)}.
${focusCommunity.description}

Start by exploring the entry points in this community's execution flows.` : `## Getting Started
1. Run \`delta search "<topic>"\` to find relevant code
2. Use \`delta blast <file>\` before modifying critical files
3. Check \`delta risk\` for files that need extra care`}
`.trim();
}
