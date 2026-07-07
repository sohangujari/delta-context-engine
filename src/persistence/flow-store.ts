import crypto from 'crypto';
import type { Database } from './database.js';
import type {
  ExecutionFlow,
  FlowStep,
  EntryPointType,
} from '../core/graph/flow-tracer.js';

// ── Store ─────────────────────────────────────────────────────────────────────

export class FlowStore {
  constructor(private db: Database) {}

  saveFlow(flow: ExecutionFlow): void {
    const tx = this.db.transaction(() => {
      this.db.prepare(`
        INSERT OR REPLACE INTO execution_flows
          (id, name, entry_file, entry_symbol, entry_type, depth, file_count, criticality, detected_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        flow.id,
        flow.name,
        flow.entryFile,
        flow.entrySymbol,
        flow.entryType,
        flow.depth,
        flow.fileCount,
        flow.criticality,
        flow.detectedAt
      );

      const stepStmt = this.db.prepare(`
        INSERT OR REPLACE INTO flow_steps
          (id, flow_id, file_path, symbol, step_order, depth, criticality)
        VALUES (?, ?, ?, ?, ?, ?, ?)
      `);

      for (const step of flow.steps) {
        stepStmt.run(
          step.id,
          flow.id,
          step.filePath,
          step.symbol,
          step.stepOrder,
          step.depth,
          step.criticality
        );
      }
    });
    tx();
  }

  saveAll(flows: ExecutionFlow[]): void {
    const tx = this.db.transaction(() => {
      for (const flow of flows) {
        this.saveFlow(flow);
      }
    });
    tx();
  }

  get(id: string): ExecutionFlow | null {
    const row = this.db.prepare(
      'SELECT * FROM execution_flows WHERE id = ?'
    ).get(id) as DbFlowRow | undefined;

    if (!row) return null;
    return this.hydrate(row);
  }

  getAll(): ExecutionFlow[] {
    const rows = this.db.prepare(
      'SELECT * FROM execution_flows ORDER BY criticality DESC'
    ).all() as DbFlowRow[];

    return rows.map((r) => this.hydrate(r));
  }

  getFlowsForFile(filePath: string): ExecutionFlow[] {
    // Find flows that have steps touching this file
    const flowIds = this.db.prepare(
      'SELECT DISTINCT flow_id FROM flow_steps WHERE file_path = ?'
    ).all(filePath) as Array<{ flow_id: string }>;

    return flowIds
      .map((r) => this.get(r.flow_id))
      .filter((f): f is ExecutionFlow => f !== null);
  }

  getFlowsForSymbol(filePath: string, symbol: string): ExecutionFlow[] {
    const flowIds = this.db.prepare(
      'SELECT DISTINCT flow_id FROM flow_steps WHERE file_path = ? AND symbol = ?'
    ).all(filePath, symbol) as Array<{ flow_id: string }>;

    return flowIds
      .map((r) => this.get(r.flow_id))
      .filter((f): f is ExecutionFlow => f !== null);
  }

  getByEntryType(type: EntryPointType): ExecutionFlow[] {
    const rows = this.db.prepare(
      'SELECT * FROM execution_flows WHERE entry_type = ? ORDER BY criticality DESC'
    ).all(type) as DbFlowRow[];

    return rows.map((r) => this.hydrate(r));
  }

  clear(): void {
    const tx = this.db.transaction(() => {
      this.db.prepare('DELETE FROM flow_steps').run();
      this.db.prepare('DELETE FROM execution_flows').run();
    });
    tx();
  }

  count(): number {
    const row = this.db.prepare(
      'SELECT COUNT(*) as cnt FROM execution_flows'
    ).get() as { cnt: number };
    return row.cnt;
  }

  // ── Private ─────────────────────────────────────────────────────────────────

  private hydrate(row: DbFlowRow): ExecutionFlow {
    const stepRows = this.db.prepare(
      'SELECT * FROM flow_steps WHERE flow_id = ? ORDER BY step_order ASC'
    ).all(row.id) as DbStepRow[];

    const steps: FlowStep[] = stepRows.map((s) => ({
      id: s.id,
      filePath: s.file_path,
      symbol: s.symbol,
      depth: s.depth,
      stepOrder: s.step_order,
      criticality: s.criticality,
    }));

    return {
      id: row.id,
      name: row.name,
      entryFile: row.entry_file,
      entrySymbol: row.entry_symbol,
      entryType: row.entry_type as EntryPointType,
      steps,
      depth: row.depth,
      fileCount: row.file_count,
      criticality: row.criticality,
      detectedAt: row.detected_at,
    };
  }
}

// ── DB row types ──────────────────────────────────────────────────────────────

interface DbFlowRow {
  id: string;
  name: string;
  entry_file: string;
  entry_symbol: string;
  entry_type: string;
  depth: number;
  file_count: number;
  criticality: number;
  detected_at: string;
}

interface DbStepRow {
  id: string;
  flow_id: string;
  file_path: string;
  symbol: string;
  step_order: number;
  depth: number;
  criticality: number;
}
