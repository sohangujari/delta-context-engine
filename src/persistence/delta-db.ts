import { Database } from './database.js';
import fs from 'fs';
import path from 'path';
import { DELTA_DIR, DB_FILE } from '../config/defaults.js';

const SCHEMA_VERSION = 4;

const SCHEMA = `
  -- Schema version tracking
  CREATE TABLE IF NOT EXISTS schema_version (
    version     INTEGER NOT NULL,
    applied_at  TEXT NOT NULL
  );

  -- Indexed files
  CREATE TABLE IF NOT EXISTS indexed_files (
    path                TEXT PRIMARY KEY,
    hash                TEXT NOT NULL,
    state               TEXT NOT NULL DEFAULT 'UNRELATED',
    token_count         INTEGER NOT NULL DEFAULT 0,
    symbol_token_count  INTEGER NOT NULL DEFAULT 0,
    summary             TEXT NOT NULL DEFAULT '',
    last_indexed        TEXT NOT NULL,
    last_changed        TEXT NOT NULL
  );

  -- Symbol maps (stored as JSON)
  CREATE TABLE IF NOT EXISTS symbol_maps (
    file_path    TEXT PRIMARY KEY,
    symbols_json TEXT NOT NULL,
    token_count  INTEGER NOT NULL DEFAULT 0,
    FOREIGN KEY (file_path) REFERENCES indexed_files(path) ON DELETE CASCADE
  );

  -- Dependency graph edges
  -- No FK constraint - edges can reference files outside the index
  CREATE TABLE IF NOT EXISTS graph_edges (
    from_path  TEXT NOT NULL,
    to_path    TEXT NOT NULL,
    PRIMARY KEY (from_path, to_path)
  );

  -- Vector embeddings (stored as BLOB of 32-bit floats)
  -- nomic-embed-text produces 768-dimensional vectors
  CREATE TABLE IF NOT EXISTS embeddings (
    file_path   TEXT PRIMARY KEY,
    vector      BLOB NOT NULL,       -- Float32Array serialized to buffer
    dimensions  INTEGER NOT NULL DEFAULT 768,
    model       TEXT NOT NULL DEFAULT 'nomic-embed-text',
    created_at  TEXT NOT NULL,
    FOREIGN KEY (file_path) REFERENCES indexed_files(path) ON DELETE CASCADE
  );

  -- Session tracking
  CREATE TABLE IF NOT EXISTS sessions (
    session_id              TEXT PRIMARY KEY,
    started_at              TEXT NOT NULL,
    total_raw_tokens        INTEGER NOT NULL DEFAULT 0,
    total_optimized_tokens  INTEGER NOT NULL DEFAULT 0,
    total_saved_tokens      INTEGER NOT NULL DEFAULT 0
  );

  -- Task records
  CREATE TABLE IF NOT EXISTS task_records (
    task_id             TEXT PRIMARY KEY,
    session_id          TEXT NOT NULL,
    instruction         TEXT NOT NULL,
    raw_tokens          INTEGER NOT NULL DEFAULT 0,
    optimized_tokens    INTEGER NOT NULL DEFAULT 0,
    saved_tokens        INTEGER NOT NULL DEFAULT 0,
    reduction_percent   INTEGER NOT NULL DEFAULT 0,
    completed_at        TEXT NOT NULL,
    FOREIGN KEY (session_id) REFERENCES sessions(session_id)
  );

  -- Indexes for performance
  CREATE INDEX IF NOT EXISTS idx_graph_edges_from ON graph_edges(from_path);
  CREATE INDEX IF NOT EXISTS idx_graph_edges_to   ON graph_edges(to_path);
  CREATE INDEX IF NOT EXISTS idx_files_state      ON indexed_files(state);

  -- Memory items: structured knowledge captured from AI sessions
  CREATE TABLE IF NOT EXISTS memory_items (
    id              TEXT PRIMARY KEY,
    topic           TEXT NOT NULL,
    type            TEXT NOT NULL,
    title           TEXT NOT NULL,
    content         TEXT NOT NULL,
    confidence      TEXT NOT NULL DEFAULT 'MEDIUM',
    source          TEXT NOT NULL DEFAULT 'auto',
    session_id      TEXT,
    created_at      TEXT NOT NULL,
    updated_at      TEXT NOT NULL,
    last_accessed   TEXT NOT NULL
  );

  -- Links memory items to specific files they are about
  CREATE TABLE IF NOT EXISTS memory_file_links (
    memory_id   TEXT NOT NULL,
    file_path   TEXT NOT NULL,
    PRIMARY KEY (memory_id, file_path),
    FOREIGN KEY (memory_id) REFERENCES memory_items(id) ON DELETE CASCADE
  );

  -- Tag system for searching and filtering memories
  CREATE TABLE IF NOT EXISTS memory_tags (
    memory_id  TEXT NOT NULL,
    tag        TEXT NOT NULL,
    PRIMARY KEY (memory_id, tag),
    FOREIGN KEY (memory_id) REFERENCES memory_items(id) ON DELETE CASCADE
  );

  CREATE INDEX IF NOT EXISTS idx_memory_topic      ON memory_items(topic);
  CREATE INDEX IF NOT EXISTS idx_memory_type        ON memory_items(type);
  CREATE INDEX IF NOT EXISTS idx_memory_confidence  ON memory_items(confidence);
  CREATE INDEX IF NOT EXISTS idx_memory_updated     ON memory_items(updated_at);
  CREATE INDEX IF NOT EXISTS idx_memory_links_file  ON memory_file_links(file_path);
  CREATE INDEX IF NOT EXISTS idx_memory_tags_tag    ON memory_tags(tag);

  -- ═══ Phase 2: Graph Intelligence ═══════════════════════════════════════════

  -- Communities: clusters of related files (Leiden algorithm)
  CREATE TABLE IF NOT EXISTS communities (
    id               TEXT PRIMARY KEY,
    name             TEXT NOT NULL,
    description      TEXT NOT NULL DEFAULT '',
    file_count       INTEGER NOT NULL DEFAULT 0,
    cohesion_score   REAL NOT NULL DEFAULT 0.0,
    coupling_score   REAL NOT NULL DEFAULT 0.0,
    risk_level       TEXT NOT NULL DEFAULT 'LOW',
    detected_at      TEXT NOT NULL,
    algorithm        TEXT NOT NULL DEFAULT 'leiden',
    resolution       REAL NOT NULL DEFAULT 1.0
  );

  CREATE TABLE IF NOT EXISTS community_members (
    community_id  TEXT NOT NULL,
    file_path     TEXT NOT NULL,
    centrality    REAL NOT NULL DEFAULT 0.0,
    PRIMARY KEY (community_id, file_path),
    FOREIGN KEY (community_id) REFERENCES communities(id) ON DELETE CASCADE
  );

  CREATE TABLE IF NOT EXISTS community_edges (
    from_community  TEXT NOT NULL,
    to_community    TEXT NOT NULL,
    edge_count      INTEGER NOT NULL DEFAULT 1,
    PRIMARY KEY (from_community, to_community)
  );

  CREATE INDEX IF NOT EXISTS idx_community_members_file ON community_members(file_path);
  CREATE INDEX IF NOT EXISTS idx_community_edges_from   ON community_edges(from_community);

  -- Execution flows: entry point → call chain paths
  CREATE TABLE IF NOT EXISTS execution_flows (
    id            TEXT PRIMARY KEY,
    name          TEXT NOT NULL,
    entry_file    TEXT NOT NULL,
    entry_symbol  TEXT NOT NULL,
    entry_type    TEXT NOT NULL,
    depth         INTEGER NOT NULL DEFAULT 0,
    file_count    INTEGER NOT NULL DEFAULT 0,
    criticality   REAL NOT NULL DEFAULT 0.0,
    detected_at   TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS flow_steps (
    id          TEXT PRIMARY KEY,
    flow_id     TEXT NOT NULL,
    file_path   TEXT NOT NULL,
    symbol      TEXT NOT NULL,
    step_order  INTEGER NOT NULL,
    depth       INTEGER NOT NULL,
    criticality REAL NOT NULL DEFAULT 0.0,
    FOREIGN KEY (flow_id) REFERENCES execution_flows(id) ON DELETE CASCADE
  );

  CREATE INDEX IF NOT EXISTS idx_flow_steps_flow  ON flow_steps(flow_id);
  CREATE INDEX IF NOT EXISTS idx_flow_steps_file  ON flow_steps(file_path);
  CREATE INDEX IF NOT EXISTS idx_flow_entry_file  ON execution_flows(entry_file);

  -- Risk scores per file (5 dimensions)
  CREATE TABLE IF NOT EXISTS risk_scores (
    file_path             TEXT PRIMARY KEY,
    security_score        REAL NOT NULL DEFAULT 0.0,
    test_coverage_score   REAL NOT NULL DEFAULT 0.0,
    cross_community_score REAL NOT NULL DEFAULT 0.0,
    flow_participation    REAL NOT NULL DEFAULT 0.0,
    surprise_coupling     REAL NOT NULL DEFAULT 0.0,
    overall_score         REAL NOT NULL DEFAULT 0.0,
    risk_level            TEXT NOT NULL DEFAULT 'LOW',
    calculated_at         TEXT NOT NULL
  );

  CREATE INDEX IF NOT EXISTS idx_risk_overall ON risk_scores(overall_score DESC);
  CREATE INDEX IF NOT EXISTS idx_risk_level   ON risk_scores(risk_level);

  -- Hub metrics per file (betweenness centrality, bridges)
  CREATE TABLE IF NOT EXISTS hub_metrics (
    file_path           TEXT PRIMARY KEY,
    betweenness         REAL NOT NULL DEFAULT 0.0,
    degree_in           INTEGER NOT NULL DEFAULT 0,
    degree_out          INTEGER NOT NULL DEFAULT 0,
    is_hub              INTEGER NOT NULL DEFAULT 0,
    is_bridge           INTEGER NOT NULL DEFAULT 0,
    bridge_communities  TEXT,
    surprise_score      REAL NOT NULL DEFAULT 0.0,
    calculated_at       TEXT NOT NULL
  );

  CREATE INDEX IF NOT EXISTS idx_hub_betweenness ON hub_metrics(betweenness DESC);
  CREATE INDEX IF NOT EXISTS idx_hub_is_hub      ON hub_metrics(is_hub);
  CREATE INDEX IF NOT EXISTS idx_hub_is_bridge   ON hub_metrics(is_bridge);

  -- Graph snapshots for architectural diff
  CREATE TABLE IF NOT EXISTS graph_snapshots (
    id              TEXT PRIMARY KEY,
    label           TEXT NOT NULL,
    created_at      TEXT NOT NULL,
    file_count      INTEGER NOT NULL DEFAULT 0,
    edge_count      INTEGER NOT NULL DEFAULT 0,
    community_count INTEGER NOT NULL DEFAULT 0,
    notes           TEXT
  );

  CREATE TABLE IF NOT EXISTS snapshot_files (
    snapshot_id   TEXT NOT NULL,
    file_path     TEXT NOT NULL,
    hash          TEXT NOT NULL,
    community_id  TEXT,
    risk_score    REAL,
    betweenness   REAL,
    is_hub        INTEGER DEFAULT 0,
    is_bridge     INTEGER DEFAULT 0,
    PRIMARY KEY (snapshot_id, file_path),
    FOREIGN KEY (snapshot_id) REFERENCES graph_snapshots(id) ON DELETE CASCADE
  );

  CREATE TABLE IF NOT EXISTS snapshot_edges (
    snapshot_id  TEXT NOT NULL,
    from_path    TEXT NOT NULL,
    to_path      TEXT NOT NULL,
    PRIMARY KEY (snapshot_id, from_path, to_path),
    FOREIGN KEY (snapshot_id) REFERENCES graph_snapshots(id) ON DELETE CASCADE
  );

  CREATE INDEX IF NOT EXISTS idx_snapshot_files_snap ON snapshot_files(snapshot_id);
  CREATE INDEX IF NOT EXISTS idx_snapshot_edges_snap ON snapshot_edges(snapshot_id);
`;

export class DeltaDb {
  private db: Database;

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
      .prepare(
        'SELECT version FROM schema_version ORDER BY version DESC LIMIT 1'
      )
      .get() as { version: number } | undefined;

    if (!versionRow) {
      this.db
        .prepare(
          'INSERT INTO schema_version (version, applied_at) VALUES (?, ?)'
        )
        .run(SCHEMA_VERSION, new Date().toISOString());
    }
  }

  getDb(): Database {
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