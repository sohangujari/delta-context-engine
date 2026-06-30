import type { Database } from 'better-sqlite3';
import type { SnapshotData } from '../core/graph/graph-diff.js';

// ── Types ─────────────────────────────────────────────────────────────────────

export interface SnapshotFileData {
  filePath: string;
  hash: string;
  communityId?: string;
  riskScore?: number;
  betweenness?: number;
  isHub: boolean;
  isBridge: boolean;
}

export interface SnapshotEdgeData {
  from: string;
  to: string;
}

// ── Store ─────────────────────────────────────────────────────────────────────

export class SnapshotStore {
  constructor(private db: Database) {}

  saveSnapshot(snapshot: SnapshotData): void {
    this.db.prepare(`
      INSERT OR REPLACE INTO graph_snapshots
        (id, label, created_at, file_count, edge_count, community_count, notes)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(
      snapshot.id,
      snapshot.label,
      snapshot.createdAt,
      snapshot.fileCount,
      snapshot.edgeCount,
      snapshot.communityCount,
      snapshot.notes ?? null
    );
  }

  saveSnapshotFile(snapshotId: string, file: SnapshotFileData): void {
    this.db.prepare(`
      INSERT OR REPLACE INTO snapshot_files
        (snapshot_id, file_path, hash, community_id, risk_score,
         betweenness, is_hub, is_bridge)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      snapshotId,
      file.filePath,
      file.hash,
      file.communityId ?? null,
      file.riskScore ?? null,
      file.betweenness ?? null,
      file.isHub ? 1 : 0,
      file.isBridge ? 1 : 0
    );
  }

  saveSnapshotEdge(snapshotId: string, fromPath: string, toPath: string): void {
    this.db.prepare(`
      INSERT OR IGNORE INTO snapshot_edges (snapshot_id, from_path, to_path)
      VALUES (?, ?, ?)
    `).run(snapshotId, fromPath, toPath);
  }

  get(id: string): SnapshotData | null {
    const row = this.db.prepare(
      'SELECT * FROM graph_snapshots WHERE id = ?'
    ).get(id) as DbSnapshotRow | undefined;

    if (!row) return null;
    return this.hydrateSnapshot(row);
  }

  getByLabel(label: string): SnapshotData | null {
    const row = this.db.prepare(
      'SELECT * FROM graph_snapshots WHERE label = ? ORDER BY created_at DESC LIMIT 1'
    ).get(label) as DbSnapshotRow | undefined;

    if (!row) return null;
    return this.hydrateSnapshot(row);
  }

  getAll(): SnapshotData[] {
    const rows = this.db.prepare(
      'SELECT * FROM graph_snapshots ORDER BY created_at DESC'
    ).all() as DbSnapshotRow[];

    return rows.map((r) => this.hydrateSnapshot(r));
  }

  getSnapshotFiles(snapshotId: string): SnapshotFileData[] {
    const rows = this.db.prepare(
      'SELECT * FROM snapshot_files WHERE snapshot_id = ?'
    ).all(snapshotId) as DbSnapshotFileRow[];

    return rows.map((r) => ({
      filePath: r.file_path,
      hash: r.hash,
      ...(r.community_id != null ? { communityId: r.community_id } : {}),
      ...(r.risk_score != null ? { riskScore: r.risk_score } : {}),
      ...(r.betweenness != null ? { betweenness: r.betweenness } : {}),
      isHub: r.is_hub === 1,
      isBridge: r.is_bridge === 1,
    }));
  }

  getSnapshotEdges(snapshotId: string): SnapshotEdgeData[] {
    const rows = this.db.prepare(
      'SELECT from_path, to_path FROM snapshot_edges WHERE snapshot_id = ?'
    ).all(snapshotId) as Array<{ from_path: string; to_path: string }>;

    return rows.map((r) => ({ from: r.from_path, to: r.to_path }));
  }

  deleteSnapshot(id: string): void {
    // Cascade will handle snapshot_files and snapshot_edges
    this.db.prepare('DELETE FROM graph_snapshots WHERE id = ?').run(id);
  }

  // ── Private ─────────────────────────────────────────────────────────────────

  private hydrateSnapshot(row: DbSnapshotRow): SnapshotData {
    return {
      id: row.id,
      label: row.label,
      createdAt: row.created_at,
      fileCount: row.file_count,
      edgeCount: row.edge_count,
      communityCount: row.community_count,
      ...(row.notes ? { notes: row.notes } : {}),
    };
  }
}

// ── DB row types ──────────────────────────────────────────────────────────────

interface DbSnapshotRow {
  id: string;
  label: string;
  created_at: string;
  file_count: number;
  edge_count: number;
  community_count: number;
  notes: string | null;
}

interface DbSnapshotFileRow {
  snapshot_id: string;
  file_path: string;
  hash: string;
  community_id: string | null;
  risk_score: number | null;
  betweenness: number | null;
  is_hub: number;
  is_bridge: number;
}
