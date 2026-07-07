import crypto from 'crypto';
import type { Database } from './database.js';

// ── Types ─────────────────────────────────────────────────────────────────────

export type MemoryType =
  | 'ARCHITECTURAL'
  | 'DECISION'
  | 'BUG'
  | 'FLOW'
  | 'EDGE_CASE'
  | 'COMMUNITY';

export type MemoryConfidence = 'HIGH' | 'MEDIUM' | 'LOW' | 'STALE';

export interface MemoryItem {
  id: string;
  topic: string;
  type: MemoryType;
  title: string;
  content: string;
  confidence: MemoryConfidence;
  source: 'auto' | 'manual';
  sessionId?: string;
  createdAt: string;
  updatedAt: string;
  lastAccessed: string;
  filePaths: string[];   // from memory_file_links join
  tags: string[];        // from memory_tags join
}

// ── Store ─────────────────────────────────────────────────────────────────────

export class MemoryStore {
  constructor(private db: Database) {}

  /**
   * Generate a new UUID for memory items.
   */
  static generateId(): string {
    return crypto.randomUUID();
  }

  /**
   * Upsert a memory item with its file links and tags.
   * Uses a transaction to keep all 3 tables in sync.
   */
  save(item: MemoryItem): void {
    const upsertItem = this.db.prepare(`
      INSERT INTO memory_items
        (id, topic, type, title, content, confidence, source,
         session_id, created_at, updated_at, last_accessed)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        topic         = excluded.topic,
        type          = excluded.type,
        title         = excluded.title,
        content       = excluded.content,
        confidence    = excluded.confidence,
        source        = excluded.source,
        session_id    = excluded.session_id,
        updated_at    = excluded.updated_at,
        last_accessed = excluded.last_accessed
    `);

    const deleteLinks = this.db.prepare(
      'DELETE FROM memory_file_links WHERE memory_id = ?'
    );
    const insertLink = this.db.prepare(
      'INSERT OR IGNORE INTO memory_file_links (memory_id, file_path) VALUES (?, ?)'
    );

    const deleteTags = this.db.prepare(
      'DELETE FROM memory_tags WHERE memory_id = ?'
    );
    const insertTag = this.db.prepare(
      'INSERT OR IGNORE INTO memory_tags (memory_id, tag) VALUES (?, ?)'
    );

    const transaction = this.db.transaction(() => {
      upsertItem.run(
        item.id,
        item.topic,
        item.type,
        item.title,
        item.content,
        item.confidence,
        item.source,
        item.sessionId ?? null,
        item.createdAt,
        item.updatedAt,
        item.lastAccessed
      );

      // Sync file links
      deleteLinks.run(item.id);
      for (const fp of item.filePaths) {
        insertLink.run(item.id, fp);
      }

      // Sync tags
      deleteTags.run(item.id);
      for (const tag of item.tags) {
        insertTag.run(item.id, tag);
      }
    });

    transaction();
  }

  /**
   * Get a single memory item by ID, including file links and tags.
   * Updates last_accessed on read.
   */
  get(id: string): MemoryItem | null {
    const row = this.db
      .prepare('SELECT * FROM memory_items WHERE id = ?')
      .get(id) as DbMemoryRow | undefined;

    if (!row) return null;

    // Touch last_accessed
    this.db
      .prepare('UPDATE memory_items SET last_accessed = ? WHERE id = ?')
      .run(new Date().toISOString(), id);

    return this.hydrate(row);
  }

  /**
   * Get all memories matching a topic prefix.
   */
  getByTopic(topic: string): MemoryItem[] {
    const rows = this.db
      .prepare('SELECT * FROM memory_items WHERE topic = ? OR topic LIKE ? ORDER BY updated_at DESC')
      .all(topic, `${topic}/%`) as DbMemoryRow[];

    return rows.map((r) => this.hydrate(r));
  }

  /**
   * Get all memories linked to a specific file path.
   */
  getByFilePath(filePath: string): MemoryItem[] {
    const rows = this.db
      .prepare(`
        SELECT m.* FROM memory_items m
        INNER JOIN memory_file_links l ON m.id = l.memory_id
        WHERE l.file_path = ?
        ORDER BY m.updated_at DESC
      `)
      .all(filePath) as DbMemoryRow[];

    return rows.map((r) => this.hydrate(r));
  }

  /**
   * Simple LIKE search on title + content.
   */
  search(query: string): MemoryItem[] {
    const pattern = `%${query}%`;
    const rows = this.db
      .prepare(`
        SELECT * FROM memory_items
        WHERE title LIKE ? OR content LIKE ?
        ORDER BY updated_at DESC
      `)
      .all(pattern, pattern) as DbMemoryRow[];

    return rows.map((r) => this.hydrate(r));
  }

  /**
   * List all memories with optional type/confidence filters.
   */
  list(filters?: {
    type?: MemoryType;
    confidence?: MemoryConfidence;
  }): MemoryItem[] {
    let sql = 'SELECT * FROM memory_items WHERE 1=1';
    const params: string[] = [];

    if (filters?.type) {
      sql += ' AND type = ?';
      params.push(filters.type);
    }
    if (filters?.confidence) {
      sql += ' AND confidence = ?';
      params.push(filters.confidence);
    }

    sql += ' ORDER BY updated_at DESC';

    const rows = this.db.prepare(sql).all(...params) as DbMemoryRow[];
    return rows.map((r) => this.hydrate(r));
  }

  /**
   * Delete a memory item and its file links + tags (CASCADE).
   */
  delete(id: string): boolean {
    const result = this.db
      .prepare('DELETE FROM memory_items WHERE id = ?')
      .run(id);

    return result.changes > 0;
  }

  /**
   * Mark a memory as stale (confidence = 'STALE').
   */
  markStale(id: string): void {
    this.db
      .prepare(
        'UPDATE memory_items SET confidence = ?, updated_at = ? WHERE id = ?'
      )
      .run('STALE', new Date().toISOString(), id);
  }

  /**
   * Update confidence level of a memory.
   */
  updateConfidence(id: string, confidence: MemoryConfidence): void {
    this.db
      .prepare(
        'UPDATE memory_items SET confidence = ?, updated_at = ? WHERE id = ?'
      )
      .run(confidence, new Date().toISOString(), id);
  }

  /**
   * Get total count of memory items.
   */
  count(): number {
    const row = this.db
      .prepare('SELECT COUNT(*) as count FROM memory_items')
      .get() as { count: number };

    return row.count;
  }

  /**
   * Get detailed statistics for the memory system.
   */
  getStats(): MemoryStats {
    const total = this.count();

    const typeCounts = this.db
      .prepare('SELECT type, COUNT(*) as count FROM memory_items GROUP BY type')
      .all() as Array<{ type: string; count: number }>;

    const confidenceCounts = this.db
      .prepare(
        'SELECT confidence, COUNT(*) as count FROM memory_items GROUP BY confidence'
      )
      .all() as Array<{ confidence: string; count: number }>;

    const linkedFiles = this.db
      .prepare(
        'SELECT COUNT(DISTINCT file_path) as count FROM memory_file_links'
      )
      .get() as { count: number };

    const byType: Record<MemoryType, number> = {
      ARCHITECTURAL: 0,
      FLOW: 0,
      DECISION: 0,
      BUG: 0,
      EDGE_CASE: 0,
      COMMUNITY: 0,
    };
    for (const row of typeCounts) {
      if (row.type in byType) {
        byType[row.type as MemoryType] = row.count;
      }
    }

    const byConfidence: Record<MemoryConfidence, number> = {
      HIGH: 0,
      MEDIUM: 0,
      LOW: 0,
      STALE: 0,
    };
    for (const row of confidenceCounts) {
      if (row.confidence in byConfidence) {
        byConfidence[row.confidence as MemoryConfidence] = row.count;
      }
    }

    return {
      total,
      byType,
      byConfidence,
      linkedFiles: linkedFiles.count,
    };
  }

  /**
   * Get all memory items (for export).
   */
  getAll(): MemoryItem[] {
    const rows = this.db
      .prepare('SELECT * FROM memory_items ORDER BY topic, updated_at DESC')
      .all() as DbMemoryRow[];

    return rows.map((r) => this.hydrate(r));
  }

  // ── Private helpers ─────────────────────────────────────────────────────────

  /**
   * Hydrate a DB row into a full MemoryItem with file links and tags.
   */
  private hydrate(row: DbMemoryRow): MemoryItem {
    const filePaths = this.db
      .prepare('SELECT file_path FROM memory_file_links WHERE memory_id = ?')
      .all(row.id) as Array<{ file_path: string }>;

    const tags = this.db
      .prepare('SELECT tag FROM memory_tags WHERE memory_id = ?')
      .all(row.id) as Array<{ tag: string }>;

    const item: MemoryItem = {
      id: row.id,
      topic: row.topic,
      type: row.type as MemoryType,
      title: row.title,
      content: row.content,
      confidence: row.confidence as MemoryConfidence,
      source: row.source as 'auto' | 'manual',
      createdAt: row.created_at,
      updatedAt: row.updated_at,
      lastAccessed: row.last_accessed,
      filePaths: filePaths.map((r) => r.file_path),
      tags: tags.map((r) => r.tag),
    };

    if (row.session_id !== null) {
      item.sessionId = row.session_id;
    }

    return item;
  }
}

// ── DB row type ───────────────────────────────────────────────────────────────

interface DbMemoryRow {
  id: string;
  topic: string;
  type: string;
  title: string;
  content: string;
  confidence: string;
  source: string;
  session_id: string | null;
  created_at: string;
  updated_at: string;
  last_accessed: string;
}

// ── Stats type ────────────────────────────────────────────────────────────────

export interface MemoryStats {
  total: number;
  byType: Record<MemoryType, number>;
  byConfidence: Record<MemoryConfidence, number>;
  linkedFiles: number;
}
