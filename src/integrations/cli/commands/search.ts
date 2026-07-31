import chalk from 'chalk';
import path from 'path';
import { DeltaDb } from '../../../persistence/delta-db.js';
import { FtsSearch, type SearchScope, type FtsResult } from '../../../core/search/fts-search.js';
import { HybridSearch, type HybridResult } from '../../../core/search/hybrid-search.js';
import { VectorStore } from '../../../core/embeddings/vector-store.js';
import { checkProviderAvailable } from '../../../core/embeddings/embedder.js';

export async function searchCommand(
  query: string,
  options: {
    root: string;
    scope?: string;
    limit?: string;
    json?: boolean;
    verbose?: boolean;
  }
): Promise<void> {
  const root = path.resolve(options.root);
  const db = new DeltaDb(root);
  const ftsSearch = new FtsSearch(db.getDb());

  const scope = (options.scope ?? 'all') as SearchScope;
  const limit = options.limit ? parseInt(options.limit, 10) : 20;

  const start = performance.now();

  // Try hybrid search (FTS5 + semantic) when embeddings available
  let results: FtsResult[] | HybridResult[];
  let searchMode = 'Keyword';

  const providerCheck = await checkProviderAvailable();
  if (providerCheck.available) {
    const vectorStore = new VectorStore(db.getDb());
    const hybridSearch = new HybridSearch(ftsSearch, vectorStore, db.getDb());
    results = await hybridSearch.search({ query, projectRoot: root, scope, limit });
    searchMode = 'Hybrid (FTS5 + semantic)';
  } else {
    results = ftsSearch.search(query, scope, limit);
    searchMode = 'Keyword (FTS5)';
  }

  const elapsed = (performance.now() - start).toFixed(0);

  if (options.json) {
    console.log(JSON.stringify(results, null, 2));
    db.close();
    return;
  }

  // ── Formatted output ─────────────────────────────────────────

  console.log(chalk.bold(`\n∆ Delta Search: "${query}"`));
  console.log(chalk.dim(`${searchMode} · ${results.length} results · ${elapsed}ms`));
  console.log(chalk.dim('─'.repeat(55)));

  if (results.length === 0) {
    console.log(chalk.yellow('  No results found.'));
    console.log(chalk.dim(`\n0 results · ${elapsed}ms\n`));
    db.close();
    return;
  }

  // Group by type — normalize hybrid results to FtsResult for display
  const normalized: FtsResult[] = results.map(r => {
    if ('rrfScore' in r) {
      const { rrfScore, ...rest } = r as HybridResult;
      return { ...rest, score: rrfScore } as FtsResult;
    }
    return r as FtsResult;
  });
  const grouped = groupByType(normalized);

  if (grouped.symbols.length > 0) {
    console.log(chalk.cyan.bold('\nSYMBOLS') + chalk.dim(` (${grouped.symbols.length} matches):`));
    for (const r of grouped.symbols) {
      const score = options.verbose ? chalk.dim(` score=${r.score.toFixed(2)}`) : '';
      const relPath = r.filePath ? shortPath(r.filePath, root) : '';
      console.log(
        `  ${chalk.green('●')} ${chalk.bold(r.symbolName ?? '')}` +
        chalk.dim(`  ${relPath}`) + score
      );
      if (r.signature) {
        console.log(chalk.dim(`    ${r.signature}`));
      }
    }
  }

  if (grouped.files.length > 0) {
    console.log(chalk.blue.bold('\nFILES') + chalk.dim(` (${grouped.files.length} matches):`));
    for (const r of grouped.files) {
      const score = options.verbose ? chalk.dim(` score=${r.score.toFixed(2)}`) : '';
      const community = r.communityName ? chalk.dim(` [${r.communityName}]`) : '';
      console.log(
        `  ${chalk.blue('○')} ${chalk.bold(r.relativePath ?? shortPath(r.filePath ?? '', root))}` +
        community + score
      );
      if (r.summary) {
        console.log(chalk.dim(`    ${r.summary}`));
      }
    }
  }

  if (grouped.memory.length > 0) {
    console.log(chalk.magenta.bold('\nMEMORY') + chalk.dim(` (${grouped.memory.length} matches):`));
    for (const r of grouped.memory) {
      const score = options.verbose ? chalk.dim(` score=${r.score.toFixed(2)}`) : '';
      console.log(
        `  ${chalk.magenta('·')} ${chalk.bold(r.memoryTitle ?? '')}` + score
      );
      if (r.memoryContent) {
        const preview = r.memoryContent.slice(0, 80).replace(/\n/g, ' ');
        console.log(chalk.dim(`    "${preview}${r.memoryContent.length > 80 ? '...' : ''}"`));
      }
    }
  }

  if (grouped.flows.length > 0) {
    console.log(chalk.yellow.bold('\nFLOWS') + chalk.dim(` (${grouped.flows.length} matches):`));
    for (const r of grouped.flows) {
      const score = options.verbose ? chalk.dim(` score=${r.score.toFixed(2)}`) : '';
      console.log(
        `  ${chalk.yellow('·')} ${chalk.bold(r.flowName ?? '')}` +
        chalk.dim(`  entry: ${r.entrySymbol ?? ''}`) + score
      );
    }
  }

  if (grouped.communities.length > 0) {
    console.log(chalk.white.bold('\nCOMMUNITIES') + chalk.dim(` (${grouped.communities.length} matches):`));
    for (const r of grouped.communities) {
      const score = options.verbose ? chalk.dim(` score=${r.score.toFixed(2)}`) : '';
      console.log(
        `  ${chalk.white('◆')} ${chalk.bold(r.communityName ?? '')}` + score
      );
      if (r.summary) {
        console.log(chalk.dim(`    ${r.summary}`));
      }
    }
  }

  console.log(chalk.dim(`\n${results.length} results · ${elapsed}ms\n`));
  db.close();
}

// ── Helpers ───────────────────────────────────────────────────────────────────

interface GroupedResults {
  symbols: FtsResult[];
  files: FtsResult[];
  memory: FtsResult[];
  flows: FtsResult[];
  communities: FtsResult[];
}

function groupByType(results: FtsResult[]): GroupedResults {
  const groups: GroupedResults = {
    symbols: [],
    files: [],
    memory: [],
    flows: [],
    communities: [],
  };
  for (const r of results) {
    if (r.type === 'symbol') groups.symbols.push(r);
    else if (r.type === 'file') groups.files.push(r);
    else if (r.type === 'memory') groups.memory.push(r);
    else if (r.type === 'flow') groups.flows.push(r);
    else groups.communities.push(r);
  }
  return groups;
}

function shortPath(fullPath: string, root: string): string {
  return fullPath.replace(root + '/', '').replace(/\\/g, '/');
}
