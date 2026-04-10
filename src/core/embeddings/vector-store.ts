import type { Database } from 'better-sqlite3';

export interface StoredVector {
  filePath: string;
  vector: Float32Array;
  dimensions: number;
  model: string;
  createdAt: string;
}

/**
 * Stores and retrieves embedding vectors in SQLite as BLOBs.
 * Float32Array → Buffer → BLOB (no external vector DB needed)
 */
export class VectorStore {
  constructor(private db: Database) {}

  save(filePath: string, vector: Float32Array, model: string): void {
    const buffer = Buffer.from(vector.buffer);
    const now = new Date().toISOString();

    this.db
      .prepare(`
        INSERT OR REPLACE INTO embeddings
          (file_path, vector, dimensions, model, created_at)
        VALUES (?, ?, ?, ?, ?)
      `)
      .run(filePath, buffer, vector.length, model, now);
  }

  get(filePath: string): StoredVector | null {
    const row = this.db
      .prepare(`
        SELECT file_path, vector, dimensions, model, created_at
        FROM embeddings
        WHERE file_path = ?
      `)
      .get(filePath) as DbRow | undefined;

    if (!row) return null;
    return rowToVector(row);
  }

  getAll(): StoredVector[] {
    const rows = this.db
      .prepare(`
        SELECT file_path, vector, dimensions, model, created_at
        FROM embeddings
      `)
      .all() as DbRow[];

    return rows.map(rowToVector);
  }

  delete(filePath: string): void {
    this.db
      .prepare('DELETE FROM embeddings WHERE file_path = ?')
      .run(filePath);
  }

  count(): number {
    const row = this.db
      .prepare('SELECT COUNT(*) as count FROM embeddings')
      .get() as { count: number };
    return row.count;
  }

  hasEmbedding(filePath: string): boolean {
    const row = this.db
      .prepare('SELECT 1 FROM embeddings WHERE file_path = ?')
      .get(filePath);
    return row !== undefined;
  }

  /**
   * Return all vectors as Float32Arrays for similarity computation.
   * Used during query time to rank all files.
   */
  getAllVectors(): Array<{ filePath: string; vector: Float32Array }> {
    const rows = this.db
      .prepare('SELECT file_path, vector FROM embeddings')
      .all() as Array<{ file_path: string; vector: Buffer }>;

    return rows.map((row) => ({
      filePath: row.file_path,
      vector: new Float32Array(
        row.vector.buffer,
        row.vector.byteOffset,
        row.vector.length / 4
      ),
    }));
  }
}

interface DbRow {
  file_path: string;
  vector: Buffer;
  dimensions: number;
  model: string;
  created_at: string;
}

function rowToVector(row: DbRow): StoredVector {
  return {
    filePath: row.file_path,
    vector: new Float32Array(
      row.vector.buffer,
      row.vector.byteOffset,
      row.vector.length / 4
    ),
    dimensions: row.dimensions,
    model: row.model,
    createdAt: row.created_at,
  };
}