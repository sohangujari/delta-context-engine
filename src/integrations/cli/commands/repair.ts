import chalk from 'chalk';
import fs from 'fs';
import path from 'path';
import ora from 'ora';
import { DeltaDb } from '../../../persistence/delta-db.js';
import { StateStore } from '../../../persistence/state-store.js';
import { GraphStore } from '../../../persistence/graph-store.js';
import { SymbolStore } from '../../../persistence/symbol-store.js';
import { VectorStore } from '../../../core/embeddings/vector-store.js';
import { extractSymbols } from '../../../core/ast/symbol-extractor.js';
import { generateSummary } from '../../../core/ast/summary-generator.js';
import { hashFile } from '../../../core/change-detector/hash-tracker.js';
import { resolveImports } from '../../../core/graph/resolver.js';
import { embedFile } from '../../../core/embeddings/query.js';
import { checkOllamaAvailable } from '../../../core/embeddings/embedder.js';

export async function repairCommand(projectRoot: string): Promise<void> {
  const root = path.resolve(projectRoot);

  console.log(chalk.bold('\n∆ Delta - Index Repair'));
  console.log(chalk.dim('─'.repeat(45)));

  // Check .delta/ exists
  const deltaDir = path.join(root, '.delta');
  if (!fs.existsSync(deltaDir)) {
    console.log(chalk.red('✗ No .delta/ directory found. Run: delta init'));
    return;
  }

  const db = new DeltaDb(root);
  const stateStore = new StateStore(db.getDb());
  const graphStore = new GraphStore(db.getDb());
  const symbolStore = new SymbolStore(db.getDb());
  const vectorStore = new VectorStore(db.getDb());

  try {
    const allRecords = stateStore.getAll();
    console.log(chalk.dim(`Checking ${allRecords.length} indexed files...`));
    console.log('');

    let missingFiles = 0;
    let staleFiles = 0;
    let repairedFiles = 0;
    let errors = 0;
    const repairLog: string[] = [];

    const spinner = ora('Scanning index...').start();

    for (const record of allRecords) {
      // Check 1: File still exists on disk
      if (!fs.existsSync(record.path)) {
        spinner.stop();
        console.log(
          chalk.red('  ✗ missing') + `  ${path.relative(root, record.path)}`
        );
        spinner.start('Scanning index...');

        // Remove all records for this file
        graphStore.deleteEdgesFor(record.path);
        symbolStore.delete(record.path);
        vectorStore.delete(record.path);
        stateStore.delete(record.path);

        missingFiles++;
        repairLog.push(`removed missing: ${path.relative(root, record.path)}`);
        continue;
      }

      // Check 2: Hash matches current file content
      try {
        const currentHash = hashFile(record.path);
        if (currentHash !== record.hash) {
          staleFiles++;

          // Re-index this file
          const symbolMap = await extractSymbols(record.path);
          const summary = symbolMap ? generateSummary(symbolMap) : '';
          const now = new Date().toISOString();

          stateStore.save({
            path: record.path,
            hash: currentHash,
            state: 'UNRELATED',
            tokenCount: symbolMap?.rawTokenCount ?? 0,
            symbolTokenCount: symbolMap?.tokenCount ?? 0,
            summary,
            lastIndexed: now,
            lastChanged: now,
          });

          if (symbolMap) {
            symbolStore.save(symbolMap);

            const resolvedDeps = resolveImports(
              symbolMap.imports,
              record.path,
              root
            );
            graphStore.saveEdges(record.path, resolvedDeps);
          }

          repairedFiles++;
          repairLog.push(`re-indexed stale: ${path.relative(root, record.path)}`);
        }
      } catch (err) {
        errors++;
        repairLog.push(
          `error: ${path.relative(root, record.path)} - ${err instanceof Error ? err.message : String(err)}`
        );
      }
    }

    spinner.succeed(chalk.green('Index scan complete'));
    console.log('');

    // Results
    console.log(chalk.bold('Repair Results'));
    console.log(`  Files checked:    ${chalk.cyan(allRecords.length.toString())}`);
    console.log(`  Missing removed:  ${missingFiles > 0 ? chalk.red(missingFiles.toString()) : chalk.dim('0')}`);
    console.log(`  Stale re-indexed: ${staleFiles > 0 ? chalk.yellow(staleFiles.toString()) : chalk.dim('0')}`);
    console.log(`  Errors:           ${errors > 0 ? chalk.red(errors.toString()) : chalk.dim('0')}`);

    const totalRepaired = missingFiles + repairedFiles;

    if (totalRepaired === 0 && errors === 0) {
      console.log('');
      console.log(chalk.green('✓ Index is healthy - no repairs needed'));
    } else {
      console.log('');

      // Re-embed stale files if Ollama available
      if (repairedFiles > 0) {
        const ollamaCheck = await checkOllamaAvailable();
        if (ollamaCheck.available) {
          const embedSpinner = ora(
            `Re-embedding ${repairedFiles} repaired file(s)...`
          ).start();

          let embedded = 0;
          for (const record of allRecords) {
            if (!fs.existsSync(record.path)) continue;
            try {
              const currentHash = hashFile(record.path);
              if (currentHash !== record.hash) {
                const success = await embedFile(
                  record.path,
                  root,
                  symbolStore,
                  vectorStore
                );
                if (success) embedded++;
              }
            } catch {
              // non-fatal
            }
          }

          embedSpinner.succeed(
            chalk.green(`Re-embedded ${embedded} file(s)`)
          );
        }
      }

      console.log(
        chalk.green(`✓ Repaired ${totalRepaired} entry/entries`)
      );

      if (errors > 0) {
        console.log(chalk.yellow(`⚠ ${errors} error(s) - check file permissions`));
      }
    }

    // Write repair log
    if (repairLog.length > 0) {
      const logPath = path.join(root, '.delta', 'repair.log');
      const logContent = [
        `Repair run: ${new Date().toISOString()}`,
        ...repairLog,
      ].join('\n');
      fs.writeFileSync(logPath, logContent, 'utf-8');
      console.log(chalk.dim(`\nRepair log: .delta/repair.log`));
    }

    console.log(chalk.dim('─'.repeat(45)));

  } finally {
    db.close();
  }
}