/**
 * codebase_compass prompt — "Show me how this codebase is structured."
 *
 * Assembles community map + hubs + bridges + flows + tech stack
 * into an architectural overview for AI context.
 */

import type { AllStores } from './index.js';
import { shortPath } from './index.js';

export interface CodebaseCompassInput {
  focusArea?: string | undefined;
  projectRoot?: string | undefined;
}

export async function buildCodebaseCompassPrompt(
  input: CodebaseCompassInput,
  stores: AllStores
): Promise<string> {
  const root = input.projectRoot ?? stores.projectRoot;

  // 1. Communities
  const communities = stores.communityStore.getAll();
  const totalFiles = stores.stateStore.getAll().length;

  // 2. Hubs & bridges
  const hubs = stores.hubStore.getHubs().slice(0, 10);
  const bridges = stores.hubStore.getBridges().slice(0, 10);

  // 3. Top flows
  const flows = stores.flowStore.getAll()
    .sort((a, b) => b.criticality - a.criticality)
    .slice(0, 10);

  // 4. Architectural memories
  const archMemories = stores.memoryStore.getAll()
    .filter(m => m.type === 'ARCHITECTURAL' || m.type === 'DECISION')
    .slice(0, 5);

  // 5. Tech stack detection from imports
  const techStack = detectTechStack(stores);

  // 6. Focus area filter
  const focusCommunity = input.focusArea
    ? communities.find(c => c.name.toLowerCase().includes(input.focusArea!.toLowerCase()))
    : null;

  return `# ∆ Codebase Architecture Overview

## Project Stats
- **Total files indexed:** ${totalFiles}
- **Communities:** ${communities.length}
- **Execution flows:** ${stores.flowStore.getAll().length}

## Communities (${communities.length})
${communities.map(c => {
  const riskBadge = c.riskLevel === 'HIGH' ? ' ⚠ HIGH RISK' : '';
  return `### ${c.name} (${c.fileCount} files · cohesion: ${c.cohesionScore.toFixed(2)})${riskBadge}
${c.description || 'No description available.'}`;
}).join('\n\n')}

${focusCommunity ? `## Focus: ${focusCommunity.name}
Files: ${focusCommunity.fileCount}
Cohesion: ${focusCommunity.cohesionScore.toFixed(2)}
${focusCommunity.description}` : ''}

${hubs.length > 0 ? `## Architectural Hubs
${hubs.map(h => `- \`${shortPath(h.filePath, root)}\` (${h.degreeIn} dependents · betweenness: ${h.betweenness.toFixed(2)})`).join('\n')}` : ''}

${bridges.length > 0 ? `## Architectural Bridges
${bridges.map(b => {
  const comms = b.bridgeCommunities.length > 0 ? b.bridgeCommunities.join(' ↔ ') : 'unknown';
  return `- \`${shortPath(b.filePath, root)}\` (connects ${comms})`;
}).join('\n')}` : ''}

${flows.length > 0 ? `## Main Execution Flows
${flows.map(f => `- **${f.name}** (${f.entryType} · depth: ${f.depth} · criticality: ${f.criticality.toFixed(2)})`).join('\n')}` : ''}

${techStack.length > 0 ? `## Tech Stack Detected
${techStack.map(t => `- ${t}`).join('\n')}` : ''}

${archMemories.length > 0 ? `## Key Conventions (from memory)
${archMemories.map(m => `- **${m.title}**: ${m.content.slice(0, 120)}${m.content.length > 120 ? '...' : ''}`).join('\n')}` : ''}
`.trim();
}

function detectTechStack(stores: AllStores): string[] {
  const stack: string[] = [];
  const allSymbols = stores.symbolStore.getAll();

  const imports = new Set<string>();
  for (const sm of allSymbols) {
    for (const imp of sm.imports) {
      if (imp.source && !imp.source.startsWith('.')) {
        imports.add(imp.source);
      }
    }
  }

  if (imports.has('express') || imports.has('fastify') || imports.has('koa')) stack.push('Framework: Express/Fastify/Koa');
  if (imports.has('next') || imports.has('next/server')) stack.push('Framework: Next.js');
  if (imports.has('react') || imports.has('react-dom')) stack.push('UI: React');
  if (imports.has('vue')) stack.push('UI: Vue');
  if (imports.has('prisma') || imports.has('@prisma/client')) stack.push('ORM: Prisma');
  if (imports.has('typeorm')) stack.push('ORM: TypeORM');
  if (imports.has('mongoose')) stack.push('Database: MongoDB (Mongoose)');
  if (imports.has('jsonwebtoken') || imports.has('jose')) stack.push('Auth: JWT');
  if (imports.has('passport')) stack.push('Auth: Passport');
  if (imports.has('stripe')) stack.push('Payments: Stripe');
  if (imports.has('redis') || imports.has('ioredis')) stack.push('Cache: Redis');
  if (imports.has('jest') || imports.has('vitest') || imports.has('mocha')) stack.push('Testing: Jest/Vitest/Mocha');

  return stack;
}
