import type { Database } from 'better-sqlite3';

export class GraphStore {
  constructor(private db: Database) {}

  saveEdges(fromPath: string, toPaths: string[]): void {
    const deleteStmt = this.db.prepare(
      'DELETE FROM graph_edges WHERE from_path = ?'
    );
    const insertStmt = this.db.prepare(
      'INSERT OR IGNORE INTO graph_edges (from_path, to_path) VALUES (?, ?)'
    );

    const transaction = this.db.transaction(() => {
      deleteStmt.run(fromPath);
      for (const toPath of toPaths) {
        insertStmt.run(fromPath, toPath);
      }
    });

    transaction();
  }

  getDependencies(filePath: string): string[] {
    const rows = this.db
      .prepare('SELECT to_path FROM graph_edges WHERE from_path = ?')
      .all(filePath) as Array<{ to_path: string }>;

    return rows.map((row) => row.to_path);
  }

  getDependents(filePath: string): string[] {
    const rows = this.db
      .prepare('SELECT from_path FROM graph_edges WHERE to_path = ?')
      .all(filePath) as Array<{ from_path: string }>;

    return rows.map((row) => row.from_path);
  }

  deleteEdgesFor(filePath: string): void {
    this.db
      .prepare('DELETE FROM graph_edges WHERE from_path = ? OR to_path = ?')
      .run(filePath, filePath);
  }

  getAllEdges(): Array<{ from: string; to: string }> {
    const rows = this.db
      .prepare('SELECT from_path, to_path FROM graph_edges')
      .all() as Array<{ from_path: string; to_path: string }>;

    return rows.map((row) => ({ from: row.from_path, to: row.to_path }));
  }
}