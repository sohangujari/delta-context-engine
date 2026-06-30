/**
 * Execution Flow Tracer — Detects entry points and traces call chains.
 *
 * Entry points: HTTP routes, CLI commands, event listeners, exports, tests.
 * Tracing: BFS traversal through dependency graph with cycle protection.
 * Output: Named flows from entry → leaf with criticality scores per step.
 */

import crypto from 'crypto';
import fs from 'fs';
import type { GraphStore } from '../../persistence/graph-store.js';
import type { SymbolStore } from '../../persistence/symbol-store.js';

// ── Types ─────────────────────────────────────────────────────────────────────

export type EntryPointType =
  | 'HTTP_ROUTE'
  | 'CLI_CMD'
  | 'EVENT'
  | 'EXPORT'
  | 'TEST'
  | 'CRON'
  | 'WEBHOOK';

export interface EntryPoint {
  filePath: string;
  symbol: string;
  type: EntryPointType;
  route?: string;
  description?: string;
}

export interface FlowStep {
  id: string;
  filePath: string;
  symbol: string;
  depth: number;
  stepOrder: number;
  criticality: number;
}

export interface ExecutionFlow {
  id: string;
  name: string;
  entryFile: string;
  entrySymbol: string;
  entryType: EntryPointType;
  steps: FlowStep[];
  depth: number;
  fileCount: number;
  criticality: number;
  detectedAt: string;
}

export interface FlowTracerOptions {
  maxDepth: number;
  maxFlows: number;
}

const DEFAULT_OPTIONS: FlowTracerOptions = {
  maxDepth: 10,
  maxFlows: 100,
};

// ── Entry Point Detection Patterns ────────────────────────────────────────────

const HTTP_ROUTE_PATTERNS = [
  // Express / Hono / Fastify: app.get('/path', handler)
  /\.(get|post|put|patch|delete|use|all)\s*\(\s*['"`]([^'"`]+)['"`]/g,
  // router.get('/path', handler)
  /router\.(get|post|put|patch|delete)\s*\(\s*['"`]([^'"`]+)['"`]/g,
  // Decorators: @Get('/path'), @Post('/path')
  /@(Get|Post|Put|Patch|Delete)\s*\(\s*['"`]([^'"`]+)['"`]/g,
  // FastAPI / Flask: @app.get('/path')
  /@app\.(get|post|put|patch|delete)\s*\(\s*['"`]([^'"`]+)['"`]/g,
];

const CLI_PATTERNS = [
  // commander: program.command('name') or .command('name')
  /\.command\s*\(\s*['"`]([^'"`]+)['"`]\)/g,
  // yargs: .command('name', ...)
  /command\s*\(\s*['"`]([^'"`]+)['"`]/g,
];

const EVENT_PATTERNS = [
  // EventEmitter: .on('event', handler)
  /\.on\s*\(\s*['"`]([^'"`]+)['"`]/g,
  // .subscribe('event')
  /\.subscribe\s*\(\s*['"`]([^'"`]+)['"`]/g,
  // consumer.run, queue.process
  /consumer\.run/g,
  /queue\.process/g,
];

const CRON_PATTERNS = [
  /cron\.schedule\s*\(\s*['"`]([^'"`]+)['"`]/g,
  /schedule\s*\(\s*['"`]([^'"`]+)['"`]/g,
];

const TEST_PATTERNS = [
  // describe('name', ...) / it('name', ...) / test('name', ...)
  /(?:describe|it|test)\s*\(\s*['"`]([^'"`]+)['"`]/g,
];

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * Detect all entry points in the codebase.
 */
export async function detectEntryPoints(
  symbolStore: SymbolStore,
  projectRoot: string,
  allFiles: string[]
): Promise<EntryPoint[]> {
  const entryPoints: EntryPoint[] = [];

  for (const filePath of allFiles) {
    let source: string;
    try {
      source = fs.readFileSync(filePath, 'utf-8');
    } catch {
      continue;
    }

    // Detect HTTP routes
    for (const pattern of HTTP_ROUTE_PATTERNS) {
      const regex = new RegExp(pattern.source, pattern.flags);
      let match: RegExpExecArray | null;
      while ((match = regex.exec(source)) !== null) {
        const method = (match[1] ?? 'GET').toUpperCase();
        const route = match[2] ?? '';
        const handler = findNearestFunction(source, match.index);

        entryPoints.push({
          filePath,
          symbol: handler,
          type: 'HTTP_ROUTE',
          route: `${method} ${route}`,
          description: `${method} ${route}`,
        });
      }
    }

    // Detect CLI commands
    for (const pattern of CLI_PATTERNS) {
      const regex = new RegExp(pattern.source, pattern.flags);
      let match: RegExpExecArray | null;
      while ((match = regex.exec(source)) !== null) {
        const cmdName = match[1] ?? '';
        entryPoints.push({
          filePath,
          symbol: cmdName,
          type: 'CLI_CMD',
          description: `CLI: ${cmdName}`,
        });
      }
    }

    // Detect event listeners
    for (const pattern of EVENT_PATTERNS) {
      const regex = new RegExp(pattern.source, pattern.flags);
      let match: RegExpExecArray | null;
      while ((match = regex.exec(source)) !== null) {
        const eventName = match[1] ?? 'event';
        entryPoints.push({
          filePath,
          symbol: eventName,
          type: 'EVENT',
          description: `Event: ${eventName}`,
        });
      }
    }

    // Detect test suites
    const isTestFile = /\.(test|spec)\.(ts|js|tsx|jsx)$/.test(filePath)
                    || /\/__tests__\//.test(filePath);
    if (isTestFile) {
      for (const pattern of TEST_PATTERNS) {
        const regex = new RegExp(pattern.source, pattern.flags);
        let match: RegExpExecArray | null;
        while ((match = regex.exec(source)) !== null) {
          const testName = match[1] ?? 'test';
          entryPoints.push({
            filePath,
            symbol: testName,
            type: 'TEST',
            description: `Test: ${testName}`,
          });
          break; // One per test file is enough
        }
      }
    }

    // Detect exported functions as entry points (only from index files)
    const isIndexFile = /(?:index|main|mod)\.(ts|js|tsx|jsx)$/.test(filePath);
    if (isIndexFile) {
      const symbolMap = symbolStore.get(filePath);
      if (symbolMap) {
        for (const exp of symbolMap.exports) {
          if (exp.kind === 'function') {
            entryPoints.push({
              filePath,
              symbol: exp.name,
              type: 'EXPORT',
              description: `Export: ${exp.name}`,
            });
          }
        }
      }
    }
  }

  // Deduplicate by file+symbol
  const seen = new Set<string>();
  return entryPoints.filter((ep) => {
    const key = `${ep.filePath}::${ep.symbol}::${ep.type}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

/**
 * Trace a single flow from an entry point.
 */
export async function traceFlow(
  entryPoint: EntryPoint,
  graphStore: GraphStore,
  maxDepth: number = 10
): Promise<ExecutionFlow> {
  const id = crypto.randomUUID();
  const detectedAt = new Date().toISOString();

  // BFS through dependency graph
  const steps: FlowStep[] = [];
  const visited = new Set<string>();
  const queue: Array<{ filePath: string; symbol: string; depth: number }> = [
    { filePath: entryPoint.filePath, symbol: entryPoint.symbol, depth: 0 },
  ];

  while (queue.length > 0) {
    const current = queue.shift()!;
    const key = current.filePath;

    if (visited.has(key)) continue;
    visited.add(key);

    if (current.depth > maxDepth) continue;

    const stepCriticality = 1.0 / (current.depth + 1);

    steps.push({
      id: crypto.randomUUID(),
      filePath: current.filePath,
      symbol: current.symbol,
      depth: current.depth,
      stepOrder: steps.length,
      criticality: stepCriticality,
    });

    // Get dependencies (files this file imports)
    const deps = graphStore.getDependencies(current.filePath);
    for (const dep of deps) {
      if (!visited.has(dep)) {
        queue.push({
          filePath: dep,
          symbol: extractLastSegment(dep),
          depth: current.depth + 1,
        });
      }
    }
  }

  // Flow-level metrics
  const depth = steps.length > 0
    ? Math.max(...steps.map((s) => s.depth))
    : 0;
  const fileCount = new Set(steps.map((s) => s.filePath)).size;
  const fileCountWeight = Math.min(1.0, fileCount / 10);
  const depthWeight = Math.min(1.0, depth / 8);
  const criticality = 0.5 * fileCountWeight + 0.5 * depthWeight;

  return {
    id,
    name: entryPoint.route ?? entryPoint.description ?? entryPoint.symbol,
    entryFile: entryPoint.filePath,
    entrySymbol: entryPoint.symbol,
    entryType: entryPoint.type,
    steps,
    depth,
    fileCount,
    criticality,
    detectedAt,
  };
}

/**
 * Trace all entry points and return all flows.
 */
export async function traceAllFlows(
  graphStore: GraphStore,
  symbolStore: SymbolStore,
  projectRoot: string,
  allFiles: string[],
  options?: Partial<FlowTracerOptions>
): Promise<ExecutionFlow[]> {
  const opts = { ...DEFAULT_OPTIONS, ...options };

  const entryPoints = await detectEntryPoints(symbolStore, projectRoot, allFiles);
  const flows: ExecutionFlow[] = [];

  for (const ep of entryPoints) {
    if (flows.length >= opts.maxFlows) break;

    const flow = await traceFlow(ep, graphStore, opts.maxDepth);
    // Only keep flows with at least 2 steps (non-trivial)
    if (flow.steps.length >= 2) {
      flows.push(flow);
    }
  }

  // Sort by criticality (highest first)
  flows.sort((a, b) => b.criticality - a.criticality);

  return flows;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function findNearestFunction(source: string, offset: number): string {
  // Look backwards from offset for the nearest function declaration
  const before = source.slice(0, offset);
  const lines = before.split('\n');

  for (let i = lines.length - 1; i >= 0; i--) {
    const line = lines[i] ?? '';
    // Match function/handler names
    const funcMatch = line.match(
      /(?:function|async\s+function)\s+(\w+)|(?:const|let|var)\s+(\w+)\s*=|(?:export\s+(?:async\s+)?function)\s+(\w+)/
    );
    if (funcMatch) {
      return funcMatch[1] ?? funcMatch[2] ?? funcMatch[3] ?? 'handler';
    }
  }

  return 'handler';
}

function extractLastSegment(filePath: string): string {
  const parts = filePath.split('/');
  const filename = parts[parts.length - 1] ?? '';
  return filename.replace(/\.[^.]+$/, '');
}
