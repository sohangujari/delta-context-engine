import type { Database } from 'better-sqlite3';

export type FileState = 'CHANGED' | 'TOUCHED' | 'ANCESTOR' | 'UNRELATED';

export interface FileRecord {
  path: string;
  hash: string;
  state: FileState;
  tokenCount: number;
  symbolTokenCount: number;
  summary: string;
  lastIndexed: string;
  lastChanged: string;
}

export class StateStore {
  constructor(private db: Database) {}

  save(record: FileRecord): void {
    this.db
      .prepare(`
        INSERT OR REPLACE INTO indexed_files
          (path, hash, state, token_count, symbol_token_count,
           summary, last_indexed, last_changed)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `)
      .run(
        record.path,
        record.hash,
        record.state,
        record.tokenCount,
        record.symbolTokenCount,
        record.summary,
        record.lastIndexed,
        record.lastChanged
      );
  }

  get(filePath: string): FileRecord | null {
    const row = this.db
      .prepare('SELECT * FROM indexed_files WHERE path = ?')
      .get(filePath) as DbRow | undefined;

    return row ? rowToRecord(row) : null;
  }

  getHash(filePath: string): string | null {
    const row = this.db
      .prepare('SELECT hash FROM indexed_files WHERE path = ?')
      .get(filePath) as { hash: string } | undefined;

    return row?.hash ?? null;
  }

  getAll(): FileRecord[] {
    const rows = this.db
      .prepare('SELECT * FROM indexed_files')
      .all() as DbRow[];

    return rows.map(rowToRecord);
  }

  updateState(filePath: string, state: FileState): void {
    this.db
      .prepare('UPDATE indexed_files SET state = ? WHERE path = ?')
      .run(state, filePath);
  }

  delete(filePath: string): void {
    this.db
      .prepare('DELETE FROM indexed_files WHERE path = ?')
      .run(filePath);
  }

  count(): number {
    const row = this.db
      .prepare('SELECT COUNT(*) as count FROM indexed_files')
      .get() as { count: number };

    return row.count;
  }
}

interface DbRow {
  path: string;
  hash: string;
  state: string;
  token_count: number;
  symbol_token_count: number;
  summary: string;
  last_indexed: string;
  last_changed: string;
}

function rowToRecord(row: DbRow): FileRecord {
  return {
    path: row.path,
    hash: row.hash,
    state: row.state as FileState,
    tokenCount: row.token_count,
    symbolTokenCount: row.symbol_token_count,
    summary: row.summary,
    lastIndexed: row.last_indexed,
    lastChanged: row.last_changed,
  };
}