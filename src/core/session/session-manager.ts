import crypto from 'crypto';
import type { Database } from 'better-sqlite3';

export interface TaskRecord {
  taskId: string;
  sessionId: string;
  instruction: string;
  rawTokens: number;
  optimizedTokens: number;
  savedTokens: number;
  reductionPercent: number;
  completedAt: string;
}

export interface SessionSummary {
  sessionId: string;
  startedAt: string;
  taskCount: number;
  totalRawTokens: number;
  totalOptimizedTokens: number;
  totalSavedTokens: number;
  avgReductionPercent: number;
}

export interface WeeklySummary {
  weekStart: string;
  weekEnd: string;
  taskCount: number;
  totalSavedTokens: number;
  totalOptimizedTokens: number;
  avgReductionPercent: number;
  estimatedTasksRemaining: number;
  weeklyBudget: number;
}

export class SessionManager {
  private sessionId: string;
  private sessionStarted: string;

  constructor(private db: Database) {
    this.sessionId = crypto.randomUUID();
    this.sessionStarted = new Date().toISOString();
    this.ensureSchema();
    this.startSession();
  }

  private ensureSchema(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS sessions (
        session_id              TEXT PRIMARY KEY,
        started_at              TEXT NOT NULL,
        total_raw_tokens        INTEGER NOT NULL DEFAULT 0,
        total_optimized_tokens  INTEGER NOT NULL DEFAULT 0,
        total_saved_tokens      INTEGER NOT NULL DEFAULT 0
      );

      CREATE TABLE IF NOT EXISTS task_records (
        task_id             TEXT PRIMARY KEY,
        session_id          TEXT NOT NULL,
        instruction         TEXT NOT NULL,
        raw_tokens          INTEGER NOT NULL DEFAULT 0,
        optimized_tokens    INTEGER NOT NULL DEFAULT 0,
        saved_tokens        INTEGER NOT NULL DEFAULT 0,
        reduction_percent   INTEGER NOT NULL DEFAULT 0,
        completed_at        TEXT NOT NULL
      );

      CREATE INDEX IF NOT EXISTS idx_task_records_session
        ON task_records(session_id);

      CREATE INDEX IF NOT EXISTS idx_task_records_completed
        ON task_records(completed_at);
    `);
  }

  private startSession(): void {
    this.db
      .prepare(`
        INSERT OR IGNORE INTO sessions
          (session_id, started_at)
        VALUES (?, ?)
      `)
      .run(this.sessionId, this.sessionStarted);
  }

  recordTask(
    instruction: string,
    rawTokens: number,
    optimizedTokens: number
  ): TaskRecord {
    const taskId = crypto.randomUUID();
    const savedTokens = rawTokens - optimizedTokens;
    const reductionPercent =
      rawTokens > 0 ? Math.round((savedTokens / rawTokens) * 100) : 0;
    const completedAt = new Date().toISOString();

    // Insert task record
    this.db
      .prepare(`
        INSERT INTO task_records
          (task_id, session_id, instruction, raw_tokens,
           optimized_tokens, saved_tokens, reduction_percent, completed_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `)
      .run(
        taskId,
        this.sessionId,
        instruction,
        rawTokens,
        optimizedTokens,
        savedTokens,
        reductionPercent,
        completedAt
      );

    // Update session totals
    this.db
      .prepare(`
        UPDATE sessions SET
          total_raw_tokens        = total_raw_tokens + ?,
          total_optimized_tokens  = total_optimized_tokens + ?,
          total_saved_tokens      = total_saved_tokens + ?
        WHERE session_id = ?
      `)
      .run(rawTokens, optimizedTokens, savedTokens, this.sessionId);

    return {
      taskId,
      sessionId: this.sessionId,
      instruction,
      rawTokens,
      optimizedTokens,
      savedTokens,
      reductionPercent,
      completedAt,
    };
  }

  getCurrentSession(): SessionSummary {
    const session = this.db
      .prepare('SELECT * FROM sessions WHERE session_id = ?')
      .get(this.sessionId) as DbSession | undefined;

    const taskCount = (
      this.db
        .prepare(
          'SELECT COUNT(*) as count FROM task_records WHERE session_id = ?'
        )
        .get(this.sessionId) as { count: number }
    ).count;

    const avgReduction =
      taskCount > 0
        ? Math.round(
            (this.db
              .prepare(
                'SELECT AVG(reduction_percent) as avg FROM task_records WHERE session_id = ?'
              )
              .get(this.sessionId) as { avg: number }
            ).avg
          )
        : 0;

    return {
      sessionId: this.sessionId,
      startedAt: this.sessionStarted,
      taskCount,
      totalRawTokens: session?.total_raw_tokens ?? 0,
      totalOptimizedTokens: session?.total_optimized_tokens ?? 0,
      totalSavedTokens: session?.total_saved_tokens ?? 0,
      avgReductionPercent: avgReduction,
    };
  }

  getWeeklySummary(weeklyBudget = 1_000_000): WeeklySummary {
    // Week starts on Monday
    const now = new Date();
    const dayOfWeek = now.getDay();
    const daysFromMonday = dayOfWeek === 0 ? 6 : dayOfWeek - 1;
    const weekStart = new Date(now);
    weekStart.setDate(now.getDate() - daysFromMonday);
    weekStart.setHours(0, 0, 0, 0);

    const weekEnd = new Date(weekStart);
    weekEnd.setDate(weekStart.getDate() + 6);
    weekEnd.setHours(23, 59, 59, 999);

    const rows = this.db
      .prepare(`
        SELECT
          COUNT(*)                    as task_count,
          SUM(raw_tokens)             as total_raw,
          SUM(optimized_tokens)       as total_optimized,
          SUM(saved_tokens)           as total_saved,
          AVG(reduction_percent)      as avg_reduction
        FROM task_records
        WHERE completed_at >= ? AND completed_at <= ?
      `)
      .get(
        weekStart.toISOString(),
        weekEnd.toISOString()
      ) as DbWeeklyRow | undefined;

    const totalOptimized = rows?.total_optimized ?? 0;
    const taskCount = rows?.task_count ?? 0;
    const avgOptimizedPerTask =
      taskCount > 0 ? totalOptimized / taskCount : 2000;

    const budgetRemaining = Math.max(0, weeklyBudget - totalOptimized);
    const estimatedTasksRemaining =
      avgOptimizedPerTask > 0
        ? Math.floor(budgetRemaining / avgOptimizedPerTask)
        : 0;

    return {
      weekStart: weekStart.toISOString(),
      weekEnd: weekEnd.toISOString(),
      taskCount,
      totalSavedTokens: rows?.total_saved ?? 0,
      totalOptimizedTokens: totalOptimized,
      avgReductionPercent: Math.round(rows?.avg_reduction ?? 0),
      estimatedTasksRemaining,
      weeklyBudget,
    };
  }

  getAllTimeSummary(): {
    totalTasks: number;
    totalSavedTokens: number;
    totalOptimizedTokens: number;
    avgReductionPercent: number;
  } {
    const row = this.db
      .prepare(`
        SELECT
          COUNT(*)              as total_tasks,
          SUM(saved_tokens)     as total_saved,
          SUM(optimized_tokens) as total_optimized,
          AVG(reduction_percent) as avg_reduction
        FROM task_records
      `)
      .get() as DbAllTimeRow | undefined;

    return {
      totalTasks: row?.total_tasks ?? 0,
      totalSavedTokens: row?.total_saved ?? 0,
      totalOptimizedTokens: row?.total_optimized ?? 0,
      avgReductionPercent: Math.round(row?.avg_reduction ?? 0),
    };
  }

  getRecentTasks(limit = 10): TaskRecord[] {
    const rows = this.db
      .prepare(`
        SELECT * FROM task_records
        ORDER BY completed_at DESC
        LIMIT ?
      `)
      .all(limit) as DbTaskRow[];

    return rows.map(rowToTask);
  }
}

// ── DB row types ──────────────────────────────────────────────────────────────

interface DbSession {
  session_id: string;
  started_at: string;
  total_raw_tokens: number;
  total_optimized_tokens: number;
  total_saved_tokens: number;
}

interface DbWeeklyRow {
  task_count: number;
  total_raw: number;
  total_optimized: number;
  total_saved: number;
  avg_reduction: number;
}

interface DbAllTimeRow {
  total_tasks: number;
  total_saved: number;
  total_optimized: number;
  avg_reduction: number;
}

interface DbTaskRow {
  task_id: string;
  session_id: string;
  instruction: string;
  raw_tokens: number;
  optimized_tokens: number;
  saved_tokens: number;
  reduction_percent: number;
  completed_at: string;
}

function rowToTask(row: DbTaskRow): TaskRecord {
  return {
    taskId: row.task_id,
    sessionId: row.session_id,
    instruction: row.instruction,
    rawTokens: row.raw_tokens,
    optimizedTokens: row.optimized_tokens,
    savedTokens: row.saved_tokens,
    reductionPercent: row.reduction_percent,
    completedAt: row.completed_at,
  };
}