import type { Database } from 'better-sqlite3';
import type { HubMetrics } from '../core/graph/hub-detector.js';

// ── Store ─────────────────────────────────────────────────────────────────────

export class HubStore {
  constructor(private db: Database) {}

  save(metrics: HubMetrics): void {
    this.db.prepare(`
      INSERT OR REPLACE INTO hub_metrics
        (file_path, betweenness, degree_in, degree_out, is_hub, is_bridge,
         bridge_communities, surprise_score, calculated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      metrics.filePath,
      metrics.betweenness,
      metrics.degreeIn,
      metrics.degreeOut,
      metrics.isHub ? 1 : 0,
      metrics.isBridge ? 1 : 0,
      JSON.stringify(metrics.bridgeCommunities),
      metrics.surpriseScore,
      metrics.calculatedAt
    );
  }

  saveAll(metrics: HubMetrics[]): void {
    const tx = this.db.transaction(() => {
      for (const m of metrics) {
        this.save(m);
      }
    });
    tx();
  }

  get(filePath: string): HubMetrics | null {
    const row = this.db.prepare(
      'SELECT * FROM hub_metrics WHERE file_path = ?'
    ).get(filePath) as DbHubRow | undefined;

    if (!row) return null;
    return this.hydrate(row);
  }

  getHubs(): HubMetrics[] {
    const rows = this.db.prepare(
      'SELECT * FROM hub_metrics WHERE is_hub = 1 ORDER BY betweenness DESC'
    ).all() as DbHubRow[];

    return rows.map((r) => this.hydrate(r));
  }

  getBridges(): HubMetrics[] {
    const rows = this.db.prepare(
      'SELECT * FROM hub_metrics WHERE is_bridge = 1 ORDER BY betweenness DESC'
    ).all() as DbHubRow[];

    return rows.map((r) => this.hydrate(r));
  }

  getTopBetweenness(n: number): HubMetrics[] {
    const rows = this.db.prepare(
      'SELECT * FROM hub_metrics ORDER BY betweenness DESC LIMIT ?'
    ).all(n) as DbHubRow[];

    return rows.map((r) => this.hydrate(r));
  }

  getHighSurprise(threshold: number = 0.5): HubMetrics[] {
    const rows = this.db.prepare(
      'SELECT * FROM hub_metrics WHERE surprise_score >= ? ORDER BY surprise_score DESC'
    ).all(threshold) as DbHubRow[];

    return rows.map((r) => this.hydrate(r));
  }

  clear(): void {
    this.db.prepare('DELETE FROM hub_metrics').run();
  }

  // ── Private ─────────────────────────────────────────────────────────────────

  private hydrate(row: DbHubRow): HubMetrics {
    let bridgeCommunities: string[] = [];
    try {
      bridgeCommunities = JSON.parse(row.bridge_communities ?? '[]') as string[];
    } catch {
      bridgeCommunities = [];
    }

    return {
      filePath: row.file_path,
      betweenness: row.betweenness,
      degreeIn: row.degree_in,
      degreeOut: row.degree_out,
      isHub: row.is_hub === 1,
      isBridge: row.is_bridge === 1,
      bridgeCommunities,
      surpriseScore: row.surprise_score,
      calculatedAt: row.calculated_at,
    };
  }
}

// ── DB row type ───────────────────────────────────────────────────────────────

interface DbHubRow {
  file_path: string;
  betweenness: number;
  degree_in: number;
  degree_out: number;
  is_hub: number;
  is_bridge: number;
  bridge_communities: string | null;
  surprise_score: number;
  calculated_at: string;
}
