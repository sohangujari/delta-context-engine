import type { Database } from 'better-sqlite3';
import type { FileRiskScore } from '../core/graph/risk-scorer.js';

// ── Store ─────────────────────────────────────────────────────────────────────

export class RiskStore {
  constructor(private db: Database) {}

  save(score: FileRiskScore): void {
    this.db.prepare(`
      INSERT OR REPLACE INTO risk_scores
        (file_path, security_score, test_coverage_score, cross_community_score,
         flow_participation, surprise_coupling, overall_score, risk_level, calculated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      score.filePath,
      score.dimensions.security,
      score.dimensions.testCoverage,
      score.dimensions.crossCommunity,
      score.dimensions.flowParticipation,
      score.dimensions.surpriseCoupling,
      score.overallScore,
      score.riskLevel,
      score.calculatedAt
    );
  }

  saveAll(scores: FileRiskScore[]): void {
    const tx = this.db.transaction(() => {
      for (const score of scores) {
        this.save(score);
      }
    });
    tx();
  }

  get(filePath: string): FileRiskScore | null {
    const row = this.db.prepare(
      'SELECT * FROM risk_scores WHERE file_path = ?'
    ).get(filePath) as DbRiskRow | undefined;

    if (!row) return null;
    return this.hydrate(row);
  }

  getAll(): FileRiskScore[] {
    const rows = this.db.prepare(
      'SELECT * FROM risk_scores ORDER BY overall_score DESC'
    ).all() as DbRiskRow[];

    return rows.map((r) => this.hydrate(r));
  }

  getByRiskLevel(level: 'LOW' | 'MEDIUM' | 'HIGH'): FileRiskScore[] {
    const rows = this.db.prepare(
      'SELECT * FROM risk_scores WHERE risk_level = ? ORDER BY overall_score DESC'
    ).all(level) as DbRiskRow[];

    return rows.map((r) => this.hydrate(r));
  }

  getTopN(n: number): FileRiskScore[] {
    const rows = this.db.prepare(
      'SELECT * FROM risk_scores ORDER BY overall_score DESC LIMIT ?'
    ).all(n) as DbRiskRow[];

    return rows.map((r) => this.hydrate(r));
  }

  clear(): void {
    this.db.prepare('DELETE FROM risk_scores').run();
  }

  count(): number {
    const row = this.db.prepare(
      'SELECT COUNT(*) as cnt FROM risk_scores'
    ).get() as { cnt: number };
    return row.cnt;
  }

  // ── Private ─────────────────────────────────────────────────────────────────

  private hydrate(row: DbRiskRow): FileRiskScore {
    return {
      filePath: row.file_path,
      dimensions: {
        security: row.security_score,
        testCoverage: row.test_coverage_score,
        crossCommunity: row.cross_community_score,
        flowParticipation: row.flow_participation,
        surpriseCoupling: row.surprise_coupling,
      },
      overallScore: row.overall_score,
      riskLevel: row.risk_level as 'LOW' | 'MEDIUM' | 'HIGH',
      reasons: [],
      calculatedAt: row.calculated_at,
    };
  }
}

// ── DB row type ───────────────────────────────────────────────────────────────

interface DbRiskRow {
  file_path: string;
  security_score: number;
  test_coverage_score: number;
  cross_community_score: number;
  flow_participation: number;
  surprise_coupling: number;
  overall_score: number;
  risk_level: string;
  calculated_at: string;
}
