/**
 * fault_tracer prompt — "Trace this error to its root cause."
 *
 * Parses error messages, runs hybrid search, traces flows,
 * finds similar bugs from memory, and ranks suspect locations.
 */

import type { AllStores } from './index.js';
import { shortPath } from './index.js';

export interface FaultTracerInput {
  errorMessage: string;
  symptom?: string | undefined;
  projectRoot?: string | undefined;
}

export async function buildFaultTracerPrompt(
  input: FaultTracerInput,
  stores: AllStores
): Promise<string> {
  const root = input.projectRoot ?? stores.projectRoot;

  // 1. Parse error for file paths and function names
  const parsedFiles = parseErrorForPaths(input.errorMessage);
  const parsedFunctions = parseErrorForFunctions(input.errorMessage);

  // 2. FTS search on error message
  const searchResults = stores.ftsSearch.search(input.errorMessage.slice(0, 200), 'all', 10);

  // 3. Get flows touching the error files
  const allFlows = stores.flowStore.getAll();
  const relevantFlows = allFlows.filter(flow =>
    flow.steps.some(step =>
      parsedFiles.some(f => step.filePath.includes(f))
    )
  ).slice(0, 5);

  // 4. Get risk scores for suspect files
  const riskScores = stores.riskStore.getAll()
    .filter(r => parsedFiles.some(f => r.filePath.includes(f)))
    .sort((a, b) => b.overallScore - a.overallScore);

  // 5. Search memory for similar bugs
  const bugMemories = stores.memoryStore.getAll()
    .filter(m => m.type === 'BUG' || m.type === 'EDGE_CASE')
    .filter(m => {
      const combined = `${m.title} ${m.content}`.toLowerCase();
      const errorLower = input.errorMessage.toLowerCase();
      return errorLower.split(/\s+/).some(word => word.length > 3 && combined.includes(word));
    })
    .slice(0, 3);

  return `# ∆ Fault Tracer

## Error
\`\`\`
${input.errorMessage}
\`\`\`
${input.symptom ? `\n## Symptom\n${input.symptom}\n` : ''}

## Suspect Locations (ranked by risk)
${riskScores.length > 0 ? riskScores.map((r, i) =>
  `${i + 1}. \`${shortPath(r.filePath, root)}\` — ${r.riskLevel} risk (${r.overallScore.toFixed(2)})`
).join('\n') : parsedFiles.length > 0 ? parsedFiles.map((f, i) =>
  `${i + 1}. \`${f}\` (from stack trace)`
).join('\n') : '- No suspect files identified from error message'}

${searchResults.length > 0 ? `## Related Code (from search)
${searchResults.slice(0, 5).map(r => {
  const name = r.symbolName ?? r.relativePath ?? r.filePath ?? r.memoryTitle ?? '';
  const rType = r.type;
  return `- **${name}** [${rType}] — score: ${r.score.toFixed(2)}`;
}).join('\n')}` : ''}

${relevantFlows.length > 0 ? `## Relevant Execution Flows
${relevantFlows.map(f =>
  `- **${f.name}** (${f.entryType} · depth: ${f.depth})\n  ${f.steps.slice(0, 5).map(s => s.symbol).join(' → ')}`
).join('\n')}` : ''}

${bugMemories.length > 0 ? `## Similar Past Bugs (from memory)
${bugMemories.map(m => `### ${m.title} (${m.confidence})
${m.content}`).join('\n\n')}` : ''}

## Suggested Investigation Points
${buildInvestigationPoints(parsedFiles, parsedFunctions, riskScores.length)}
`.trim();
}

function parseErrorForPaths(error: string): string[] {
  const paths: string[] = [];
  // Match file paths like /path/to/file.ts:42 or src/utils/jwt.ts
  const pathRegex = /(?:\/[\w.-]+)+\.(?:ts|js|py|go|rs|java|tsx|jsx)(?::\d+)?/g;
  let match;
  while ((match = pathRegex.exec(error)) !== null) {
    const clean = match[0].split(':')[0] ?? match[0];
    if (!paths.includes(clean)) paths.push(clean);
  }
  return paths;
}

function parseErrorForFunctions(error: string): string[] {
  const fns: string[] = [];
  // Match function names from stack traces: at functionName (
  const fnRegex = /at\s+(?:async\s+)?(\w[\w.]*)\s*\(/g;
  let match;
  while ((match = fnRegex.exec(error)) !== null) {
    if (match[1] && !fns.includes(match[1])) fns.push(match[1]);
  }
  return fns;
}

function buildInvestigationPoints(
  files: string[], functions: string[], riskCount: number
): string {
  const points: string[] = [];
  if (files.length > 0) points.push(`- Check ${files[0]} — appears in stack trace`);
  if (functions.length > 0) points.push(`- Investigate \`${functions[0]}()\` — first in call stack`);
  if (riskCount > 0) points.push('- High-risk files in the error path — review recent changes');
  if (points.length === 0) points.push('- Error message does not contain recognizable file paths or functions');
  return points.join('\n');
}
