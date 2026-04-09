import type { Database } from 'better-sqlite3';
import type { SymbolMap } from '../core/ast/symbol-map.js';

export class SymbolStore {
  constructor(private db: Database) {}

  save(symbolMap: SymbolMap): void {
    this.db
      .prepare(`
        INSERT OR REPLACE INTO symbol_maps (file_path, symbols_json, token_count)
        VALUES (?, ?, ?)
      `)
      .run(symbolMap.filePath, JSON.stringify(symbolMap), symbolMap.tokenCount);
  }

  get(filePath: string): SymbolMap | null {
    const row = this.db
      .prepare('SELECT symbols_json FROM symbol_maps WHERE file_path = ?')
      .get(filePath) as { symbols_json: string } | undefined;

    if (!row) return null;
    return JSON.parse(row.symbols_json) as SymbolMap;
  }

  delete(filePath: string): void {
    this.db
      .prepare('DELETE FROM symbol_maps WHERE file_path = ?')
      .run(filePath);
  }

  getAll(): SymbolMap[] {
    const rows = this.db
      .prepare('SELECT symbols_json FROM symbol_maps')
      .all() as Array<{ symbols_json: string }>;

    return rows.map((row) => JSON.parse(row.symbols_json) as SymbolMap);
  }
}