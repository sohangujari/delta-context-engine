import chalk from 'chalk';
import fs from 'fs';
import ora from 'ora';
import path from 'path';
import { saveConfig } from '../../../config/delta.config.js';
import { DEFAULT_CONFIG } from '../../../config/defaults.js';
import { loadIgnorePatterns } from '../../../config/deltaignore.js';
import { walkDirectory } from '../../../core/change-detector/hash-tracker.js';
import { buildFullGraph } from '../../../core/graph/builder.js';
import { embedFile } from '../../../core/embeddings/query.js';
import { DeltaDb } from '../../../persistence/delta-db.js';
import { GraphStore } from '../../../persistence/graph-store.js';
import { StateStore } from '../../../persistence/state-store.js';
import { SymbolStore } from '../../../persistence/symbol-store.js';
import { VectorStore } from '../../../core/embeddings/vector-store.js';
import { detectCommunities } from '../../../core/graph/community-detector.js';
import { CommunityStore } from '../../../persistence/community-store.js';
import { traceAllFlows } from '../../../core/graph/flow-tracer.js';
import { FlowStore } from '../../../persistence/flow-store.js';
import { scoreAllFiles } from '../../../core/graph/risk-scorer.js';
import { RiskStore } from '../../../persistence/risk-store.js';
import { detectHubsAndBridges } from '../../../core/graph/hub-detector.js';
import { HubStore } from '../../../persistence/hub-store.js';
import { SearchIndexer } from '../../../persistence/search-indexer.js';
import { MemoryStore } from '../../../persistence/memory-store.js';

export async function initCommand(projectRoot: string): Promise<void> {
  const root = path.resolve(projectRoot);

  console.log(chalk.bold('\n∆ Delta Context Engine'));
  console.log(chalk.dim('─'.repeat(45)));

  // Step 1: Create .delta/ directory
  const dirSpinner = ora('Creating .delta/ directory...').start();
  DeltaDb.ensureDirectory(root);
  dirSpinner.succeed(chalk.green('.delta/ directory ready'));

  // Step 2: Initialize database
  const dbSpinner = ora('Initializing database...').start();
  const db = new DeltaDb(root);
  dbSpinner.succeed(chalk.green('Database initialized'));

  // Step 3: Write default config
  const configSpinner = ora('Writing configuration...').start();
  saveConfig(root, DEFAULT_CONFIG);
  configSpinner.succeed(chalk.green('.delta/config.json written'));

  // Step 4: Write .deltaignore
  writeDeltaIgnore(root);

  // Step 5: Index all files + build dependency graph
  const ignorePatterns = loadIgnorePatterns(root);
  const allFiles = walkDirectory(root, root, ignorePatterns);

  console.log('');

  const indexSpinner = ora(`Indexing ${allFiles.length} files...`).start();

  const graphStore = new GraphStore(db.getDb());
  const stateStore = new StateStore(db.getDb());
  const symbolStore = new SymbolStore(db.getDb());
  const vectorStore = new VectorStore(db.getDb());

  let lastPercent = 0;

  const result = await buildFullGraph({
    projectRoot: root,
    allFiles,
    graphStore,
    stateStore,
    symbolStore,
    onProgress: (done, total) => {
      const percent = Math.floor((done / total) * 100);
      if (percent >= lastPercent + 10) {
        lastPercent = percent;
        indexSpinner.text = `Indexing files... ${percent}%`;
      }
    },
  });

  if (result.errors.length > 0) {
    indexSpinner.warn(
      chalk.yellow(
        `Indexed ${result.filesProcessed} files · ${result.edgesCreated} edges · ${result.errors.length} warning(s)`
      )
    );
  } else {
    indexSpinner.succeed(
      chalk.green(
        `Indexed ${result.filesProcessed} files · ${result.edgesCreated} dependency edges`
      )
    );
  }

  // Step 6: Detect communities (Leiden algorithm)
  console.log('');
  const communityStore = new CommunityStore(db.getDb());
  const communitySpinner = ora('Detecting communities...').start();
  try {
    communityStore.clear();
    const communityResult = await detectCommunities(graphStore, symbolStore);
    communityStore.saveAll(communityResult.communities);
    communityStore.saveCommunityEdges(communityResult.communityEdges);

    const names = communityResult.communities
      .slice(0, 6)
      .map((c) => `${c.name} (${c.fileCount})`)
      .join('  ');
    communitySpinner.succeed(
      chalk.green(`${communityResult.communities.length} communities detected`) +
      chalk.dim(` · modularity: ${communityResult.modularity.toFixed(2)}`)
    );
    if (communityResult.communities.length > 0) {
      console.log(chalk.dim(`  ${names}`));
    }
  } catch (err) {
    communitySpinner.warn(
      chalk.yellow('Community detection skipped: ' + (err instanceof Error ? err.message : String(err)))
    );
  }

  // Step 7: Trace execution flows
  console.log('');
  const flowStore = new FlowStore(db.getDb());
  const flowSpinner = ora('Tracing execution flows...').start();
  try {
    flowStore.clear();
    const flows = await traceAllFlows(graphStore, symbolStore, root, allFiles);
    flowStore.saveAll(flows);

    const routeCount = flows.filter((f) => f.entryType === 'HTTP_ROUTE').length;
    const cmdCount = flows.filter((f) => f.entryType === 'CLI_CMD').length;
    flowSpinner.succeed(
      chalk.green(`${flows.length} execution flows traced`) +
      chalk.dim(` · ${routeCount} routes · ${cmdCount} commands`)
    );
  } catch (err) {
    flowSpinner.warn(
      chalk.yellow('Flow tracing skipped: ' + (err instanceof Error ? err.message : String(err)))
    );
  }

  // Step 8: Calculate risk scores
  console.log('');
  const riskStore = new RiskStore(db.getDb());
  const riskSpinner = ora('Calculating risk scores...').start();
  try {
    riskStore.clear();
    const scores = await scoreAllFiles(
      allFiles, symbolStore, graphStore, communityStore, flowStore, root
    );
    riskStore.saveAll(scores);

    const highRisk = scores.filter((s) => s.riskLevel === 'HIGH').length;
    riskSpinner.succeed(
      chalk.green('Risk scores calculated') +
      chalk.dim(` · ${highRisk} HIGH risk files`)
    );
  } catch (err) {
    riskSpinner.warn(
      chalk.yellow('Risk scoring skipped: ' + (err instanceof Error ? err.message : String(err)))
    );
  }

  // Step 9: Detect hubs and bridges
  console.log('');
  const hubStore = new HubStore(db.getDb());
  const hubSpinner = ora('Detecting hubs and bridges...').start();
  try {
    hubStore.clear();
    const hubResult = await detectHubsAndBridges(graphStore, communityStore, allFiles);
    hubStore.saveAll(hubResult.allMetrics);

    hubSpinner.succeed(
      chalk.green(`${hubResult.hubs.length} hubs · ${hubResult.bridges.length} bridges detected`)
    );
  } catch (err) {
    hubSpinner.warn(
      chalk.yellow('Hub detection skipped: ' + (err instanceof Error ? err.message : String(err)))
    );
  }

  // Step 10: Generate embeddings (if embedding provider is available)
  console.log('');
  const { checkProviderAvailable } = await import('../../../core/embeddings/embedder.js');
  const providerCheck = await checkProviderAvailable();

  if (!providerCheck.available) {
    console.log(
      chalk.yellow(`⚠ Skipping embeddings (${providerCheck.providerName}): ${providerCheck.reason}`)
    );
    console.log(
      chalk.dim('  Semantic scoring disabled. Graph + AST scoring still active.')
    );
    if (providerCheck.providerName === 'ollama') {
      console.log(
        chalk.dim('  To enable: ollama serve && ollama pull nomic-embed-text')
      );
    } else {
      console.log(
        chalk.dim('  Configure provider in .delta/config.json → embeddings block')
      );
    }
  } else {
    const embedSpinner = ora(
      `Generating embeddings (${providerCheck.providerName}) for ${allFiles.length} files...`
    ).start();

    let embedded = 0;
    let embedErrors = 0;
    lastPercent = 0;

    for (let i = 0; i < allFiles.length; i++) {
      const filePath = allFiles[i];
      if (!filePath) continue;

      try {
        const success = await embedFile(
          filePath,
          root,
          symbolStore,
          vectorStore
        );
        if (success) embedded++;
      } catch {
        embedErrors++;
      }

      const percent = Math.floor(((i + 1) / allFiles.length) * 100);
      if (percent >= lastPercent + 10) {
        lastPercent = percent;
        embedSpinner.text = `Generating embeddings... ${percent}% (${embedded} embedded)`;
      }
    }

    if (embedErrors > 0) {
      embedSpinner.warn(
        chalk.yellow(`Embedded ${embedded} files · ${embedErrors} skipped`)
      );
    } else {
      embedSpinner.succeed(
        chalk.green(`Embedded ${embedded} / ${allFiles.length} files`)
      );
    }
  }

  // Step 11: Build FTS5 search index
  console.log('');
  const searchSpinner = ora('Building search index...').start();
  try {
    const searchIndexer = new SearchIndexer(db.getDb());
    const memoryStore = new MemoryStore(db.getDb());
    searchIndexer.indexSymbols(symbolStore);
    searchIndexer.indexFiles(stateStore, communityStore, root);
    searchIndexer.indexCommunities(communityStore);
    searchIndexer.indexFlows(flowStore);
    searchIndexer.indexMemory(memoryStore);
    searchSpinner.succeed(
      chalk.green('Search index built (FTS5)')
    );
  } catch (err) {
    searchSpinner.warn(
      chalk.yellow('Search index skipped: ' + (err instanceof Error ? err.message : String(err)))
    );
  }

  db.close();

  printGitignoreNote(root);

  console.log(chalk.dim('─'.repeat(45)));
  console.log(chalk.bold.green('✓ Delta initialized successfully'));
  console.log('');
  console.log('Next steps:');
  console.log(`  ${chalk.cyan('delta run "your task here"')}   Assemble optimized context`);
  console.log(`  ${chalk.cyan('delta stats')}                  Show index statistics`);
  console.log('');
}

function writeDeltaIgnore(projectRoot: string): void {
  const deltaignorePath = path.join(projectRoot, '.deltaignore');
  if (fs.existsSync(deltaignorePath)) return;

  const contents = [
    '# Delta ignore patterns',
    '# These extend .gitignore for Delta-specific exclusions',
    '',
    'node_modules/**',
    'dist/**',
    'build/**',
    '.next/**',
    'out/**',
    '*.generated.ts',
    '*.generated.js',
    'coverage/**',
    '.delta/**',
  ].join('\n');

  fs.writeFileSync(deltaignorePath, contents, 'utf-8');
}

function printGitignoreNote(projectRoot: string): void {
  const gitignorePath = path.join(projectRoot, '.gitignore');
  if (!fs.existsSync(gitignorePath)) return;

  const content = fs.readFileSync(gitignorePath, 'utf-8');
  if (!content.includes('.delta/')) {
    console.log(chalk.yellow('\n⚠ Add .delta/ to your .gitignore:'));
    console.log(chalk.dim('  echo ".delta/" >> .gitignore'));
    console.log('');
  }
}