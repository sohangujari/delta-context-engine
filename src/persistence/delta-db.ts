import Database from 'better-sqlite3';
import fs from 'fs';
import path from 'path';
import { DELTA_DIR, DB_FILE } from '../config/defaults.js';

const SCHEMA_VERSION = 1;

const SCHEMA = `
  -- Schema version tracking
  CREATE TABLE IF NOT EXISTS schema_version (
    version     INTEGER NOT NULL,
    applied_at  TEXT NOT NULL
  );

  -- Indexed files
  CREATE TABLE IF NOT EXISTS indexed_files (
    path              TEXT PRIMARY KEY,
    hash              TEXT NOT NULL,
    state             TEXT NOT NULL DEFAULT 'UNRELATED',
    token_count       INTEGER NOT NULL DEFAULT 0,
    symbol_token_count INTEGER NOT NULL DEFAULT 0,
    summary           TEXT NOT NULL DEFAULT '',
    last_indexed      TEXT NOT NULL,
    last_changed      TEXT NOT NULL
  );

  -- Symbol maps (stored as JSON)
  CREATE TABLE IF NOT EXISTS symbol_maps (
    file_path   TEXT PRIMARY KEY,
    symbols_json TEXT NOT NULL,
    token_count INTEGER NOT NULL DEFAULT 0,
    FOREIGN KEY (file_path) REFERENCES indexed_files(path) ON DELETE CASCADE
  );

  -- Dependency graph edges
  CREATE TABLE IF NOT EXISTS graph_edges (
    from_path   TEXT NOT NULL,
    to_path     TEXT NOT NULL,
    PRIMARY KEY (from_path, to_path),
    FOREIGN KEY (from_path) REFERENCES indexed_files(path) ON DELETE CASCADE
  );

  -- Session tracking
  CREATE TABLE IF NOT EXISTS sessions (
    session_id          TEXT PRIMARY KEY,
    started_at          TEXT NOT NULL,
    total_raw_tokens    INTEGER NOT NULL DEFAULT 0,
    total_optimized_tokens INTEGER NOT NULL DEFAULT 0,
    total_saved_tokens  INTEGER NOT NULL DEFAULT 0
  );

  -- Task records
  CREATE TABLE IF NOT EXISTS task_records (
    task_id         TEXT PRIMARY KEY,
    session_id      TEXT NOT NULL,
    instruction     TEXT NOT NULL,
    raw_tokens      INTEGER NOT NULL DEFAULT 0,
    optimized_tokens INTEGER NOT NULL DEFAULT 0,
    saved_tokens    INTEGER NOT NULL DEFAULT 0,
    completed_at    TEXT NOT NULL,
    FOREIGN KEY (session_id) REFERENCES sessions(session_id)
  );

  -- Indexes for performance
  CREATE INDEX IF NOT EXISTS idx_graph_edges_from ON graph_edges(from_path);
  CREATE INDEX IF NOT EXISTS idx_graph_edges_to ON graph_edges(to_path);
  CREATE INDEX IF NOT EXISTS idx_files_state ON indexed_files(state);
`;

export class DeltaDb {
  private db: Database.Database;

  constructor(projectRoot: string) {
    const dbPath = path.join(projectRoot, DB_FILE);
    this.db = new Database(dbPath);
    this.db.pragma('journal_mode = WAL');
    this.db.pragma('foreign_keys = ON');
    this.applySchema();
  }

  private applySchema(): void {
    this.db.exec(SCHEMA);

    const versionRow = this.db
      .prepare('SELECT version FROM schema_version ORDER BY version DESC LIMIT 1')
      .get() as { version: number } | undefined;

    if (!versionRow) {
      this.db
        .prepare('INSERT INTO schema_version (version, applied_at) VALUES (?, ?)')
        .run(SCHEMA_VERSION, new Date().toISOString());
    }
  }

  getDb(): Database.Database {
    return this.db;
  }

  close(): void {
    this.db.close();
  }

  static ensureDirectory(projectRoot: string): void {
    const deltaDir = path.join(projectRoot, DELTA_DIR);
    if (!fs.existsSync(deltaDir)) {
      fs.mkdirSync(deltaDir, { recursive: true });
    }
  }
}