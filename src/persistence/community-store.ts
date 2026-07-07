import crypto from 'crypto';
import type { Database } from './database.js';

// ── Types ─────────────────────────────────────────────────────────────────────

export interface CommunityData {
  id: string;
  name: string;
  description: string;
  files: string[];
  fileCount: number;
  cohesionScore: number;
  couplingScore: number;
  riskLevel: 'LOW' | 'MEDIUM' | 'HIGH';
  detectedAt: string;
  algorithm: string;
  resolution: number;
  /** Centrality per file: filePath → centrality score */
  centralities: Map<string, number>;
}

export interface CommunityEdge {
  from: string;
  to: string;
  edgeCount: number;
}

// ── Store ─────────────────────────────────────────────────────────────────────

export class CommunityStore {
  constructor(private db: Database) {}

  static generateId(): string {
    return crypto.randomUUID();
  }

  save(community: CommunityData): void {
    const tx = this.db.transaction(() => {
      this.db.prepare(`
        INSERT OR REPLACE INTO communities
          (id, name, description, file_count, cohesion_score, coupling_score,
           risk_level, detected_at, algorithm, resolution)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        community.id,
        community.name,
        community.description,
        community.fileCount,
        community.cohesionScore,
        community.couplingScore,
        community.riskLevel,
        community.detectedAt,
        community.algorithm,
        community.resolution
      );

      // Save members
      const memberStmt = this.db.prepare(`
        INSERT OR REPLACE INTO community_members (community_id, file_path, centrality)
        VALUES (?, ?, ?)
      `);
      for (const filePath of community.files) {
        const centrality = community.centralities.get(filePath) ?? 0;
        memberStmt.run(community.id, filePath, centrality);
      }
    });
    tx();
  }

  saveAll(communities: CommunityData[]): void {
    const tx = this.db.transaction(() => {
      for (const community of communities) {
        this.save(community);
      }
    });
    tx();
  }

  saveCommunityEdges(edges: CommunityEdge[]): void {
    const stmt = this.db.prepare(`
      INSERT OR REPLACE INTO community_edges (from_community, to_community, edge_count)
      VALUES (?, ?, ?)
    `);
    const tx = this.db.transaction(() => {
      for (const edge of edges) {
        stmt.run(edge.from, edge.to, edge.edgeCount);
      }
    });
    tx();
  }

  get(id: string): CommunityData | null {
    const row = this.db.prepare(
      'SELECT * FROM communities WHERE id = ?'
    ).get(id) as DbCommunityRow | undefined;

    if (!row) return null;
    return this.hydrate(row);
  }

  getByName(name: string): CommunityData | null {
    const row = this.db.prepare(
      'SELECT * FROM communities WHERE name = ?'
    ).get(name) as DbCommunityRow | undefined;

    if (!row) return null;
    return this.hydrate(row);
  }

  getAll(): CommunityData[] {
    const rows = this.db.prepare(
      'SELECT * FROM communities ORDER BY file_count DESC'
    ).all() as DbCommunityRow[];

    return rows.map((r) => this.hydrate(r));
  }

  getForFile(filePath: string): CommunityData | null {
    const row = this.db.prepare(`
      SELECT c.* FROM communities c
      JOIN community_members cm ON c.id = cm.community_id
      WHERE cm.file_path = ?
      LIMIT 1
    `).get(filePath) as DbCommunityRow | undefined;

    if (!row) return null;
    return this.hydrate(row);
  }

  getCommunityEdges(): CommunityEdge[] {
    const rows = this.db.prepare(
      'SELECT from_community, to_community, edge_count FROM community_edges'
    ).all() as Array<{ from_community: string; to_community: string; edge_count: number }>;

    return rows.map((r) => ({
      from: r.from_community,
      to: r.to_community,
      edgeCount: r.edge_count,
    }));
  }

  clear(): void {
    const tx = this.db.transaction(() => {
      this.db.prepare('DELETE FROM community_edges').run();
      this.db.prepare('DELETE FROM community_members').run();
      this.db.prepare('DELETE FROM communities').run();
    });
    tx();
  }

  count(): number {
    const row = this.db.prepare(
      'SELECT COUNT(*) as cnt FROM communities'
    ).get() as { cnt: number };
    return row.cnt;
  }

  // ── Private ─────────────────────────────────────────────────────────────────

  private hydrate(row: DbCommunityRow): CommunityData {
    // Get member files
    const members = this.db.prepare(
      'SELECT file_path, centrality FROM community_members WHERE community_id = ?'
    ).all(row.id) as Array<{ file_path: string; centrality: number }>;

    const files = members.map((m) => m.file_path);
    const centralities = new Map<string, number>();
    for (const m of members) {
      centralities.set(m.file_path, m.centrality);
    }

    return {
      id: row.id,
      name: row.name,
      description: row.description,
      files,
      fileCount: row.file_count,
      cohesionScore: row.cohesion_score,
      couplingScore: row.coupling_score,
      riskLevel: row.risk_level as 'LOW' | 'MEDIUM' | 'HIGH',
      detectedAt: row.detected_at,
      algorithm: row.algorithm,
      resolution: row.resolution,
      centralities,
    };
  }
}

// ── DB row type ───────────────────────────────────────────────────────────────

interface DbCommunityRow {
  id: string;
  name: string;
  description: string;
  file_count: number;
  cohesion_score: number;
  coupling_score: number;
  risk_level: string;
  detected_at: string;
  algorithm: string;
  resolution: number;
}
