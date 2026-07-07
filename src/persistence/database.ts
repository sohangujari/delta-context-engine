/**
 * SQLite Database Adapter — better-sqlite3-compatible API over sql.js (WASM).
 *
 * Provides the same synchronous query API (prepare/run/get/all/exec/pragma/
 * transaction/close) that all stores expect, but uses sql.js underneath.
 * sql.js is pure JavaScript/WASM — zero native compilation, works on ANY
 * Node version (18, 20, 22, 23, 24+).
 *
 * Usage:
 *   await Database.initialize();              // once at startup
 *   const db = new Database('/path/to/db');   // then use synchronously
 */

import initSqlJs, { type Database as SqlJsDatabase } from 'sql.js';
import fs from 'fs';
import path from 'path';

// ── Global sql.js engine ──────────────────────────────────────────────────────

let SQL: Awaited<ReturnType<typeof initSqlJs>> | null = null;

/**
 * Initialize the sql.js WASM engine. Call once at app startup.
 * After this call, `new Database(path)` works synchronously.
 */
export async function initializeDatabase(): Promise<void> {
  if (!SQL) {
    SQL = await initSqlJs();
  }
}

// ── Statement ─────────────────────────────────────────────────────────────────

export class Statement {
  constructor(
    private db: SqlJsDatabase,
    private sql: string,
    private saveFn: () => void
  ) {}

  run(...params: unknown[]): RunResult {
    this.db.run(this.sql, params as any[]);
    this.saveFn();
    return {
      changes: this.db.getRowsModified(),
      lastInsertRowid: 0,
    };
  }

  get(...params: unknown[]): unknown {
    const stmt = this.db.prepare(this.sql);
    try {
      stmt.bind(params as any[]);
      if (stmt.step()) {
        return stmt.getAsObject();
      }
      return undefined;
    } finally {
      stmt.free();
    }
  }

  all(...params: unknown[]): unknown[] {
    const results: unknown[] = [];
    const stmt = this.db.prepare(this.sql);
    try {
      stmt.bind(params as any[]);
      while (stmt.step()) {
        results.push(stmt.getAsObject());
      }
    } finally {
      stmt.free();
    }
    return results;
  }
}

interface RunResult {
  changes: number;
  lastInsertRowid: number;
}

// ── Database ──────────────────────────────────────────────────────────────────

export class Database {
  private db: SqlJsDatabase;
  private dbPath: string;

  constructor(filePath: string) {
    if (!SQL) {
      throw new Error(
        'sql.js not initialized. Call initializeDatabase() before creating a Database.'
      );
    }

    this.dbPath = filePath;

    const dir = path.dirname(filePath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }

    if (fs.existsSync(filePath)) {
      const buffer = fs.readFileSync(filePath);
      this.db = new SQL.Database(buffer);
    } else {
      this.db = new SQL.Database();
    }
  }

  prepare(sql: string): Statement {
    return new Statement(this.db, sql, () => this.save());
  }

  exec(sql: string): void {
    this.db.exec(sql);
    this.save();
  }

  pragma(pragma: string): unknown {
    const results = this.db.exec(`PRAGMA ${pragma}`);
    if (results.length === 0) return undefined;
    const first = results[0]!;
    if (first.values.length === 0) return undefined;
    if (first.columns.length === 1) {
      return first.values[0]![0];
    }
    const row: Record<string, unknown> = {};
    for (let i = 0; i < first.columns.length; i++) {
      row[first.columns[i]!] = first.values[0]![i];
    }
    return row;
  }

  transaction<T>(fn: () => T): () => T {
    return () => {
      this.db.run('BEGIN TRANSACTION');
      try {
        const result = fn();
        this.db.run('COMMIT');
        this.save();
        return result;
      } catch (err) {
        this.db.run('ROLLBACK');
        throw err;
      }
    };
  }

  close(): void {
    this.save();
    this.db.close();
  }

  private save(): void {
    try {
      const data = this.db.export();
      const buffer = Buffer.from(data);
      fs.writeFileSync(this.dbPath, buffer);
    } catch {
      // Ignore save errors (e.g., if db already closed)
    }
  }
}
