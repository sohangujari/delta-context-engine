import fs from 'fs';
import path from 'path';
import { countTokens } from './token-counter.js';
import { extractSymbols } from '../ast/symbol-extractor.js';
import { generateSummary } from '../ast/summary-generator.js';
import {
  compressFull,
  compressToSymbols,
  compressToSummary,
  downgrade,
  type CompressedFile,
  type CompressionLevel,
} from './compressor.js';
import type { ClassifiedFile } from '../change-detector/state-classifier.js';
import type { TraversalResult } from '../graph/traverser.js';

export interface ContextSlot {
  priority: 1 | 2 | 3 | 4 | 5;
  label: string;
  content: string;
  tokenCount: number;
  compressionLevel: CompressionLevel;
  files: string[];
}

export interface TokenSavings {
  rawTokens: number;
  optimizedTokens: number;
  savedTokens: number;
  reductionPercent: number;
  reductionMultiple: number;
}

export interface ContextManifest {
  included: Array<{
    relativePath: string;
    compressionLevel: CompressionLevel;
    tokenCount: number;
    reason: string;
  }>;
  excluded: Array<{
    relativePath: string;
    reason: string;
  }>;
}

export interface ContextPayload {
  taskInstruction: string;
  tokenBudget: number;
  totalTokens: number;
  slots: ContextSlot[];
  manifest: ContextManifest;
  savings: TokenSavings;
  formatted: string;  // final string to send to Claude
}

export interface AssembleOptions {
  task: string;
  traversal: TraversalResult;
  projectRoot: string;
  tokenBudget: number;
  allProjectFiles: string[];
}

/**
 * Core context assembly pipeline.
 *
 * Priority stack:
 *   SLOT 1 (priority=1): Task instruction        — always included
 *   SLOT 2 (priority=2): Changed files, full     — always included
 *   SLOT 3 (priority=3): Touched files, symbols  — include until budget
 *   SLOT 4 (priority=4): Ancestor files, summary — include until budget
 *   SLOT 5 (priority=5): Project skeleton        — include if budget allows
 *
 * Compression cascade if budget exceeded:
 *   Step 1: Downgrade touched from symbols → summary
 *   Step 2: Drop ancestor summaries
 *   Step 3: Drop project skeleton
 *   Step 4: Downgrade changed from full → symbols (last resort)
 */
export async function assembleContext(
  options: AssembleOptions
): Promise<ContextPayload> {
  const { task, traversal, projectRoot, tokenBudget, allProjectFiles } = options;

  const manifest: ContextManifest = { included: [], excluded: [] };
  let totalRawTokens = 0;

  // ── SLOT 1: Task instruction ─────────────────────────────────────────────
  const taskContent = `TASK: ${task}`;
  const taskTokens = countTokens(taskContent);

  // ── SLOT 2: Changed files (full content) ─────────────────────────────────
  const changedFiles: CompressedFile[] = [];

  for (const f of traversal.changed) {
    if (!fs.existsSync(f.path)) continue;

    const rawContent = fs.readFileSync(f.path, 'utf-8');
    const rawTokens = countTokens(rawContent);
    totalRawTokens += rawTokens;

    const compressed = compressFull(f.path, f.relativePath, rawContent);
    changedFiles.push(compressed);

    manifest.included.push({
      relativePath: f.relativePath,
      compressionLevel: 'full',
      tokenCount: compressed.tokenCount,
      reason: 'CHANGED (depth=0)',
    });
  }

  // ── SLOT 3: Touched files (symbol maps) ──────────────────────────────────
  const touchedFiles: CompressedFile[] = [];
  const touchedSymbolMaps = new Map<string, Awaited<ReturnType<typeof extractSymbols>>>();

  for (const f of traversal.touched) {
    if (!fs.existsSync(f.path)) continue;

    const symbolMap = await extractSymbols(f.path);
    if (!symbolMap) continue;

    totalRawTokens += symbolMap.rawTokenCount;
    touchedSymbolMaps.set(f.path, symbolMap);

    const compressed = compressToSymbols(f.path, f.relativePath, symbolMap);
    touchedFiles.push(compressed);
  }

  // ── SLOT 4: Ancestor files (1-line summaries) ────────────────────────────
  const ancestorFiles: CompressedFile[] = [];
  const ancestorSymbolMaps = new Map<string, Awaited<ReturnType<typeof extractSymbols>>>();

  for (const f of traversal.ancestors) {
    if (!fs.existsSync(f.path)) continue;

    const symbolMap = await extractSymbols(f.path);
    if (!symbolMap) continue;

    totalRawTokens += symbolMap.rawTokenCount;
    ancestorSymbolMaps.set(f.path, symbolMap);

    const compressed = compressToSummary(f.path, f.relativePath, symbolMap);
    ancestorFiles.push(compressed);
  }

  // ── SLOT 5: Project skeleton ──────────────────────────────────────────────
  const skeletonContent = buildProjectSkeleton(allProjectFiles, projectRoot);
  const skeletonTokens = countTokens(skeletonContent);

  // Count all unrelated/unvisited files as raw token cost
  const visitedPaths = new Set([
    ...traversal.changed.map((f) => f.path),
    ...traversal.touched.map((f) => f.path),
    ...traversal.ancestors.map((f) => f.path),
  ]);
  for (const filePath of allProjectFiles) {
    if (!visitedPaths.has(filePath) && fs.existsSync(filePath)) {
      const content = fs.readFileSync(filePath, 'utf-8');
      totalRawTokens += countTokens(content);
    }
  }

  // ── Budget enforcement + compression cascade ──────────────────────────────
  const slots = await fitToBudget({
    task: taskContent,
    taskTokens,
    changedFiles,
    touchedFiles,
    ancestorFiles,
    skeletonContent,
    skeletonTokens,
    tokenBudget,
    touchedSymbolMaps,
    manifest,
    traversal,
  });

  const totalTokens = slots.reduce((sum, s) => sum + s.tokenCount, 0);

  // Build excluded list
  for (const filePath of allProjectFiles) {
    if (!visitedPaths.has(filePath)) {
      manifest.excluded.push({
        relativePath: path.relative(projectRoot, filePath),
        reason: 'UNRELATED (depth > 2)',
      });
    }
  }

  // ── Savings calculation ───────────────────────────────────────────────────
  const savedTokens = totalRawTokens - totalTokens;
  const reductionPercent =
    totalRawTokens > 0
      ? Math.round((savedTokens / totalRawTokens) * 100)
      : 0;
  const reductionMultiple =
    totalTokens > 0
      ? Math.round((totalRawTokens / totalTokens) * 10) / 10
      : 1;

  const savings: TokenSavings = {
    rawTokens: totalRawTokens,
    optimizedTokens: totalTokens,
    savedTokens,
    reductionPercent,
    reductionMultiple,
  };

  // ── Format final payload ──────────────────────────────────────────────────
  const formatted = formatPayload(slots, savings, tokenBudget);

  return {
    taskInstruction: task,
    tokenBudget,
    totalTokens,
    slots,
    manifest,
    savings,
    formatted,
  };
}

// ── Budget fitting ────────────────────────────────────────────────────────────

interface FitOptions {
  task: string;
  taskTokens: number;
  changedFiles: CompressedFile[];
  touchedFiles: CompressedFile[];
  ancestorFiles: CompressedFile[];
  skeletonContent: string;
  skeletonTokens: number;
  tokenBudget: number;
  touchedSymbolMaps: Map<string, Awaited<ReturnType<typeof extractSymbols>>>;
  manifest: ContextManifest;
  traversal: TraversalResult;
}

async function fitToBudget(opts: FitOptions): Promise<ContextSlot[]> {
  const {
    task, taskTokens, changedFiles, tokenBudget,
    skeletonContent, skeletonTokens, touchedSymbolMaps,
    manifest, traversal,
  } = opts;

  let { touchedFiles, ancestorFiles } = opts;

  // Calculate initial token usage
  const changedTokens = changedFiles.reduce((s, f) => s + f.tokenCount, 0);
  let touchedTokens = touchedFiles.reduce((s, f) => s + f.tokenCount, 0);
  let ancestorTokens = ancestorFiles.reduce((s, f) => s + f.tokenCount, 0);

  let used = taskTokens + changedTokens + touchedTokens + ancestorTokens + skeletonTokens;

  // ── Cascade Step 1: Downgrade touched symbols → summaries ────────────────
  if (used > tokenBudget) {
    const downgradedTouched: CompressedFile[] = [];

    for (const f of touchedFiles) {
      const symbolMap = touchedSymbolMaps.get(f.path);
      if (symbolMap) {
        downgradedTouched.push(compressToSummary(f.path, f.relativePath, symbolMap));
      } else {
        downgradedTouched.push({ ...f, compressionLevel: 'excluded', content: '', tokenCount: 0 });
      }
    }

    touchedFiles = downgradedTouched;
    touchedTokens = touchedFiles.reduce((s, f) => s + f.tokenCount, 0);
    used = taskTokens + changedTokens + touchedTokens + ancestorTokens + skeletonTokens;
  }

  // ── Cascade Step 2: Drop ancestor summaries ───────────────────────────────
  if (used > tokenBudget) {
    ancestorFiles = [];
    ancestorTokens = 0;
    used = taskTokens + changedTokens + touchedTokens + skeletonTokens;
  }

  // ── Cascade Step 3: Drop skeleton ────────────────────────────────────────
  let includeSkeletonFinal = true;
  if (used > tokenBudget) {
    includeSkeletonFinal = false;
    used = taskTokens + changedTokens + touchedTokens;
  }

  // ── Cascade Step 4: Trim touched list to fit ──────────────────────────────
  if (used > tokenBudget) {
    const remaining = tokenBudget - taskTokens - changedTokens;
    const trimmed: CompressedFile[] = [];
    let accumulated = 0;

    for (const f of touchedFiles) {
      if (accumulated + f.tokenCount <= remaining) {
        trimmed.push(f);
        accumulated += f.tokenCount;
      }
    }

    touchedFiles = trimmed;
    touchedTokens = touchedFiles.reduce((s, f) => s + f.tokenCount, 0);
    used = taskTokens + changedTokens + touchedTokens;
  }

  // ── Build manifest for touched files ─────────────────────────────────────
  for (const f of touchedFiles) {
    if (f.compressionLevel !== 'excluded') {
      manifest.included.push({
        relativePath: f.relativePath,
        compressionLevel: f.compressionLevel,
        tokenCount: f.tokenCount,
        reason: 'TOUCHED (depth=1)',
      });
    }
  }

  for (const f of ancestorFiles) {
    manifest.included.push({
      relativePath: f.relativePath,
      compressionLevel: f.compressionLevel,
      tokenCount: f.tokenCount,
      reason: 'ANCESTOR (depth=2)',
    });
  }

  // ── Assemble final slots ──────────────────────────────────────────────────
  const slots: ContextSlot[] = [];

  // Slot 1: Task
  slots.push({
    priority: 1,
    label: 'Task',
    content: task,
    tokenCount: taskTokens,
    compressionLevel: 'full',
    files: [],
  });

  // Slot 2: Changed files
  if (changedFiles.length > 0) {
    slots.push({
      priority: 2,
      label: 'Changed Files (full content)',
      content: changedFiles
        .map((f) => `// FILE: ${f.relativePath}\n${f.content}`)
        .join('\n\n'),
      tokenCount: changedTokens,
      compressionLevel: 'full',
      files: changedFiles.map((f) => f.relativePath),
    });
  }

  // Slot 3: Touched files
  const activeTouched = touchedFiles.filter((f) => f.compressionLevel !== 'excluded');
  if (activeTouched.length > 0) {
    slots.push({
      priority: 3,
      label: 'Dependencies (symbols only)',
      content: activeTouched
        .map((f) => `// SYMBOLS: ${f.relativePath}\n${f.content}`)
        .join('\n\n'),
      tokenCount: activeTouched.reduce((s, f) => s + f.tokenCount, 0),
      compressionLevel: 'symbols',
      files: activeTouched.map((f) => f.relativePath),
    });
  }

  // Slot 4: Ancestor summaries
  if (ancestorFiles.length > 0) {
    const summaryLines = ancestorFiles
      .map((f) => `  ${f.relativePath}: ${f.content}`)
      .join('\n');

    slots.push({
      priority: 4,
      label: 'Transitive Dependencies (summaries)',
      content: `SUMMARIES:\n${summaryLines}`,
      tokenCount: ancestorTokens,
      compressionLevel: 'summary',
      files: ancestorFiles.map((f) => f.relativePath),
    });
  }

  // Slot 5: Project skeleton
  if (includeSkeletonFinal && skeletonTokens > 0) {
    slots.push({
      priority: 5,
      label: 'Project Structure',
      content: skeletonContent,
      tokenCount: skeletonTokens,
      compressionLevel: 'summary',
      files: [],
    });
  }

  return slots;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function buildProjectSkeleton(
  allFiles: string[],
  projectRoot: string
): string {
  const dirs = new Set<string>();

  for (const filePath of allFiles) {
    const rel = path.relative(projectRoot, filePath);
    const parts = rel.split(path.sep);

    // Add each directory segment
    for (let i = 1; i < parts.length; i++) {
      dirs.add(parts.slice(0, i).join('/'));
    }
  }

  const sorted = [...dirs].sort();
  return `PROJECT STRUCTURE:\n${sorted.map((d) => `  ${d}/`).join('\n')}`;
}

function formatPayload(
  slots: ContextSlot[],
  savings: TokenSavings,
  budget: number
): string {
  const lines: string[] = [];

  lines.push('━'.repeat(50));
  lines.push('∆ DELTA CONTEXT PAYLOAD');
  lines.push(
    `Token Budget: ${budget} | Used: ${savings.optimizedTokens} | Saved: ${savings.reductionPercent}%`
  );
  lines.push('━'.repeat(50));
  lines.push('');

  for (const slot of slots) {
    lines.push(`[${slot.label.toUpperCase()}]`);
    lines.push(slot.content);
    lines.push('');
  }

  lines.push('━'.repeat(50));
  lines.push(
    `Total: ${savings.optimizedTokens} tokens ` +
    `(saved ${savings.savedTokens.toLocaleString()} · ${savings.reductionMultiple}× fewer)`
  );
  lines.push('━'.repeat(50));

  return lines.join('\n');
}// trigger
