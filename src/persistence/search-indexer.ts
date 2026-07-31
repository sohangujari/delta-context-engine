import type { Database } from './database.js';
import type { SymbolStore } from './symbol-store.js';
import type { StateStore } from './state-store.js';
import type { CommunityStore } from './community-store.js';
import type { MemoryStore } from './memory-store.js';
import type { FlowStore } from './flow-store.js';
import type { SymbolMap } from '../core/ast/symbol-map.js';

// ── SearchIndexer ─────────────────────────────────────────────────────────────
//
// Populates FTS5 virtual tables from existing stores.
// Called during `delta init` after each pipeline step,
// and incrementally by the file watcher.

export class SearchIndexer {
  constructor(private db: Database) {}

  /**
   * Index all symbols into fts_symbols.
   * Called after symbol extraction (Step 5 of init).
   */
  indexSymbols(symbolStore: SymbolStore): void {
    this.db.prepare('DELETE FROM fts_symbols').run();

    const allMaps = symbolStore.getAll();
    const insert = this.db.prepare(
      'INSERT INTO fts_symbols (file_path, symbol_name, symbol_kind, signature, language) VALUES (?, ?, ?, ?, ?)'
    );

    const transaction = this.db.transaction(() => {
      for (const symbolMap of allMaps) {
        // Index exports
        for (const exp of symbolMap.exports) {
          insert.run(
            symbolMap.filePath,
            exp.name,
            exp.kind ?? 'export',
            exp.signature ?? exp.name,
            symbolMap.language
          );
        }
        // Index classes + their methods
        for (const cls of symbolMap.classes) {
          insert.run(
            symbolMap.filePath,
            cls.name,
            'class',
            `class ${cls.name}`,
            symbolMap.language
          );
          for (const method of cls.methods) {
            insert.run(
              symbolMap.filePath,
              `${cls.name}.${method.name}`,
              'method',
              `${method.name}${method.params}`,
              symbolMap.language
            );
          }
        }
        // Index functions
        for (const fn of symbolMap.functions) {
          insert.run(
            symbolMap.filePath,
            fn.name,
            'function',
            `${fn.name}${fn.params}`,
            symbolMap.language
          );
        }
        // Index types
        for (const type of symbolMap.types) {
          insert.run(
            symbolMap.filePath,
            type.name,
            type.kind,
            type.definition,
            symbolMap.language
          );
        }
      }
    });
    transaction();
  }

  /**
   * Index all file paths and summaries into fts_files.
   * Called after graph build (Step 5 of init).
   */
  indexFiles(stateStore: StateStore, communityStore: CommunityStore, projectRoot: string): void {
    this.db.prepare('DELETE FROM fts_files').run();

    const insert = this.db.prepare(
      'INSERT INTO fts_files (file_path, relative_path, summary, language, community_name) VALUES (?, ?, ?, ?, ?)'
    );

    const records = stateStore.getAll();
    const transaction = this.db.transaction(() => {
      for (const record of records) {
        const community = communityStore.getForFile(record.path);
        const relativePath = record.path
          .replace(projectRoot + '/', '')
          .replace(/\\/g, '/');

        insert.run(
          record.path,
          relativePath,
          record.summary,
          '',
          community?.name ?? ''
        );
      }
    });
    transaction();
  }

  /**
   * Index all memory items into fts_memory.
   * Called after memory operations.
   */
  indexMemory(memoryStore: MemoryStore): void {
    this.db.prepare('DELETE FROM fts_memory').run();

    const insert = this.db.prepare(
      'INSERT INTO fts_memory (memory_id, title, content, topic, tags) VALUES (?, ?, ?, ?, ?)'
    );

    const items = memoryStore.list();
    const transaction = this.db.transaction(() => {
      for (const item of items) {
        insert.run(
          item.id,
          item.title,
          item.content,
          item.topic,
          item.tags.join(', ')
        );
      }
    });
    transaction();
  }

  /**
   * Index all execution flows into fts_flows.
   * Called after flow tracing (P2.2).
   */
  indexFlows(flowStore: FlowStore): void {
    this.db.prepare('DELETE FROM fts_flows').run();

    const insert = this.db.prepare(
      'INSERT INTO fts_flows (flow_id, name, entry_symbol, entry_file) VALUES (?, ?, ?, ?)'
    );

    const flows = flowStore.getAll();
    const transaction = this.db.transaction(() => {
      for (const flow of flows) {
        insert.run(flow.id, flow.name, flow.entrySymbol, flow.entryFile);
      }
    });
    transaction();
  }

  /**
   * Index all communities into fts_communities.
   * Called after community detection (P2.1).
   */
  indexCommunities(communityStore: CommunityStore): void {
    this.db.prepare('DELETE FROM fts_communities').run();

    const insert = this.db.prepare(
      'INSERT INTO fts_communities (community_id, name, description) VALUES (?, ?, ?)'
    );

    const communities = communityStore.getAll();
    const transaction = this.db.transaction(() => {
      for (const community of communities) {
        insert.run(community.id, community.name, community.description);
      }
    });
    transaction();
  }

  /**
   * Incremental update: re-index one file after watcher detects a change.
   */
  updateFileInIndex(
    filePath: string,
    symbolMap: SymbolMap | null,
    summary: string,
    communityName: string,
    projectRoot: string
  ): void {
    // Delete old entries for this file
    this.db.prepare('DELETE FROM fts_symbols WHERE file_path = ?').run(filePath);
    this.db.prepare('DELETE FROM fts_files WHERE file_path = ?').run(filePath);

    if (!symbolMap) return;

    // Re-insert symbols
    const insertSym = this.db.prepare(
      'INSERT INTO fts_symbols (file_path, symbol_name, symbol_kind, signature, language) VALUES (?, ?, ?, ?, ?)'
    );
    for (const exp of symbolMap.exports) {
      insertSym.run(filePath, exp.name, exp.kind ?? 'export', exp.signature ?? exp.name, symbolMap.language);
    }
    for (const fn of symbolMap.functions) {
      insertSym.run(filePath, fn.name, 'function', `${fn.name}${fn.params}`, symbolMap.language);
    }
    for (const cls of symbolMap.classes) {
      insertSym.run(filePath, cls.name, 'class', `class ${cls.name}`, symbolMap.language);
    }

    // Re-insert file
    const relativePath = filePath.replace(projectRoot + '/', '').replace(/\\/g, '/');
    this.db.prepare(
      'INSERT INTO fts_files (file_path, relative_path, summary, language, community_name) VALUES (?, ?, ?, ?, ?)'
    ).run(filePath, relativePath, summary, symbolMap.language, communityName);
  }

  /**
   * Update a single memory item in the FTS index.
   */
  updateMemoryInIndex(item: { id: string; title: string; content: string; topic: string; tags: string[] }): void {
    this.db.prepare('DELETE FROM fts_memory WHERE memory_id = ?').run(item.id);
    this.db.prepare(
      'INSERT INTO fts_memory (memory_id, title, content, topic, tags) VALUES (?, ?, ?, ?, ?)'
    ).run(item.id, item.title, item.content, item.topic, item.tags.join(', '));
  }
}
