import chalk from 'chalk';
import fs from 'fs';
import path from 'path';
import { DeltaDb } from '../../../persistence/delta-db.js';
import { GraphStore } from '../../../persistence/graph-store.js';
import { StateStore } from '../../../persistence/state-store.js';

export interface GraphOptions {
  root: string;
  depth: number;
  open: boolean;
}

export async function graphCommand(
  filePath: string,
  options: GraphOptions
): Promise<void> {
  const root = path.resolve(options.root);
  const absPath = path.resolve(root, filePath);
  const relPath = path.relative(root, absPath);

  console.log(chalk.bold('\n∆ Delta — Dependency Graph'));
  console.log(chalk.dim('─'.repeat(45)));

  if (!fs.existsSync(absPath)) {
    console.log(chalk.red(`✗ File not found: ${relPath}`));
    return;
  }

  const db = new DeltaDb(root);
  const graphStore = new GraphStore(db.getDb());
  const stateStore = new StateStore(db.getDb());

  try {
    const record = stateStore.get(absPath);
    if (!record) {
      console.log(chalk.yellow(`⚠ File not in index: ${relPath}`));
      console.log(chalk.dim('  Run: delta init'));
      return;
    }

    console.log(chalk.bold(relPath));
    console.log('');

    // Build tree recursively up to maxDepth
    const visited = new Set<string>();
    const lines: string[] = [];

    buildTree(
      absPath,
      root,
      graphStore,
      options.depth,
      0,
      '',
      true,
      visited,
      lines
    );

    console.log(lines.join('\n'));
    console.log('');

    // Stats
    const deps = graphStore.getDependencies(absPath);
    const dependents = graphStore.getDependents(absPath);

    console.log(chalk.dim('─'.repeat(45)));
    console.log(chalk.dim(`Dependencies: ${deps.length} direct · ${visited.size - 1} total (depth ≤ ${options.depth})`));
    console.log(chalk.dim(`Imported by:  ${dependents.length} file(s)`));

    if (dependents.length > 0) {
      console.log('');
      console.log(chalk.dim('Imported by:'));
      for (const dep of dependents.slice(0, 5)) {
        console.log(chalk.dim(`  ← ${path.relative(root, dep)}`));
      }
      if (dependents.length > 5) {
        console.log(chalk.dim(`  ... and ${dependents.length - 5} more`));
      }
    }

    // Write SVG if --open flag
    if (options.open) {
      const svgPath = writeSvgGraph(absPath, root, graphStore, options.depth);
      console.log('');
      console.log(chalk.green(`✓ Graph saved: ${path.relative(root, svgPath)}`));

      // Open in browser
      const { exec } = await import('child_process');
      exec(`open "${svgPath}"`);
    }

  } finally {
    db.close();
  }
}

// ── Tree builder ──────────────────────────────────────────────────────────────

function buildTree(
  filePath: string,
  projectRoot: string,
  graphStore: GraphStore,
  maxDepth: number,
  currentDepth: number,
  prefix: string,
  isLast: boolean,
  visited: Set<string>,
  lines: string[]
): void {
  const relPath = path.relative(projectRoot, filePath);

  if (currentDepth === 0) {
    lines.push(chalk.bold.cyan(relPath));
    visited.add(filePath);
  } else {
    const connector = isLast ? '└── ' : '├── ';
    const depthColor =
      currentDepth === 1 ? chalk.yellow :
      currentDepth === 2 ? chalk.dim :
      chalk.dim;

    lines.push(`${prefix}${connector}${depthColor(relPath)}`);
    visited.add(filePath);
  }

  if (currentDepth >= maxDepth) return;

  const deps = graphStore.getDependencies(filePath);
  const newPrefix = currentDepth === 0 ? '' : prefix + (isLast ? '    ' : '│   ');

  for (let i = 0; i < deps.length; i++) {
    const dep = deps[i];
    if (!dep) continue;

    // Skip already-visited to prevent infinite loops
    if (visited.has(dep)) {
      const connector = i === deps.length - 1 ? '└── ' : '├── ';
      lines.push(`${newPrefix}${connector}${chalk.dim(path.relative(projectRoot, dep))} ${chalk.dim('(circular)')}`);
      continue;
    }

    buildTree(
      dep,
      projectRoot,
      graphStore,
      maxDepth,
      currentDepth + 1,
      newPrefix,
      i === deps.length - 1,
      visited,
      lines
    );
  }
}

// ── SVG generator ─────────────────────────────────────────────────────────────

function writeSvgGraph(
  rootFile: string,
  projectRoot: string,
  graphStore: GraphStore,
  maxDepth: number
): string {
  const nodes: Array<{ id: string; label: string; depth: number }> = [];
  const edges: Array<{ from: string; to: string }> = [];
  const visited = new Set<string>();

  function collect(filePath: string, depth: number): void {
    if (visited.has(filePath) || depth > maxDepth) return;
    visited.add(filePath);

    const id = filePath.replace(/[^a-zA-Z0-9]/g, '_');
    const label = path.relative(projectRoot, filePath);
    nodes.push({ id, label, depth });

    const deps = graphStore.getDependencies(filePath);
    for (const dep of deps) {
      const toId = dep.replace(/[^a-zA-Z0-9]/g, '_');
      edges.push({ from: id, to: toId });
      collect(dep, depth + 1);
    }
  }

  collect(rootFile, 0);

  // Layout constants
  const NODE_W = 220;
  const NODE_H = 28;
  const H_GAP = 20;   // horizontal gap between nodes
  const V_GAP = 80;   // vertical gap between depth levels
  const PADDING = 40;

  // Group nodes by depth
  const byDepth = new Map<number, typeof nodes>();
  for (const node of nodes) {
    const list = byDepth.get(node.depth) ?? [];
    list.push(node);
    byDepth.set(node.depth, list);
  }

  // Calculate canvas size based on widest depth level
  const maxNodesInRow = Math.max(...[...byDepth.values()].map((n) => n.length));
  const canvasWidth = Math.max(
    900,
    maxNodesInRow * (NODE_W + H_GAP) + PADDING * 2
  );
  const canvasHeight = (maxDepth + 1) * V_GAP + PADDING * 3 + 30;

  // Assign positions — center each depth level
  const positions = new Map<string, { x: number; y: number; w: number }>();
  for (const [depth, depthNodes] of byDepth.entries()) {
    const rowWidth = depthNodes.length * NODE_W + (depthNodes.length - 1) * H_GAP;
    const startX = (canvasWidth - rowWidth) / 2;
    const y = PADDING + 30 + depth * V_GAP;

    depthNodes.forEach((node, i) => {
      const x = startX + i * (NODE_W + H_GAP);
      positions.set(node.id, { x, y, w: NODE_W });
    });
  }

  const depthColors = ['#0098FF', '#F59E0B', '#6B7280', '#9CA3AF'];
  const depthFill   = ['rgba(0,152,255,0.15)', 'rgba(245,158,11,0.12)',
                       'rgba(107,114,128,0.10)', 'rgba(156,163,175,0.08)'];

  const svgNodes = nodes.map((node) => {
    const pos = positions.get(node.id);
    if (!pos) return '';
    const color = depthColors[Math.min(node.depth, depthColors.length - 1)] ?? '#6B7280';
    const fill  = depthFill[Math.min(node.depth, depthFill.length - 1)] ?? 'rgba(0,0,0,0.1)';
    const labelShort = node.label.length > 28
      ? '...' + node.label.slice(-25)
      : node.label;

    return `
  <g transform="translate(${pos.x},${pos.y})">
    <rect x="0" y="-${NODE_H / 2}" width="${NODE_W}" height="${NODE_H}"
          rx="5" fill="${fill}" stroke="${color}" stroke-width="1.2"/>
    <text x="${NODE_W / 2}" y="5" text-anchor="middle"
          font-family="monospace" font-size="10" fill="${color}">${labelShort}</text>
  </g>`;
  }).join('');

  const svgEdges = edges.map((edge) => {
    const from = positions.get(edge.from);
    const to   = positions.get(edge.to);
    if (!from || !to) return '';
    // Draw from bottom-center of source to top-center of target
    const x1 = from.x + NODE_W / 2;
    const y1 = from.y + NODE_H / 2;
    const x2 = to.x + NODE_W / 2;
    const y2 = to.y - NODE_H / 2;
    // Cubic bezier for smooth curves
    const cy = (y1 + y2) / 2;
    return `<path d="M${x1},${y1} C${x1},${cy} ${x2},${cy} ${x2},${y2}"
                  fill="none" stroke="#374151" stroke-width="1.2"
                  stroke-opacity="0.5" marker-end="url(#arrow)"/>`;
  }).join('');

  const svg = `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg"
     width="${canvasWidth}" height="${canvasHeight}"
     style="background:#111827;font-family:monospace">
  <defs>
    <marker id="arrow" markerWidth="7" markerHeight="7"
            refX="5" refY="3.5" orient="auto">
      <path d="M0,0 L0,7 L7,3.5 z" fill="#4B5563"/>
    </marker>
  </defs>
  <text x="${PADDING}" y="22" font-size="12" fill="#6B7280">
    ∆ Delta — ${path.relative(projectRoot, rootFile)}
  </text>
  ${svgEdges}
  ${svgNodes}
</svg>`;

  const graphsDir = path.join(projectRoot, '.delta', 'graphs');
  fs.mkdirSync(graphsDir, { recursive: true });

  const filename = path.basename(rootFile).replace(/\.[^.]+$/, '') + '-graph.svg';
  const svgPath = path.join(graphsDir, filename);
  fs.writeFileSync(svgPath, svg, 'utf-8');

  return svgPath;
}