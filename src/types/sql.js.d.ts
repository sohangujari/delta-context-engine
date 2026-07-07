/**
 * Type declarations for sql.js
 * Based on https://sql.js.org/documentation/
 */
declare module 'sql.js' {
  interface SqlJsStatic {
    Database: new (data?: ArrayLike<number> | Buffer | null) => Database;
  }

  interface QueryExecResult {
    columns: string[];
    values: unknown[][];
  }

  interface ParamsObject {
    [key: string]: unknown;
  }

  interface Database {
    run(sql: string, params?: unknown[]): Database;
    exec(sql: string, params?: unknown[]): QueryExecResult[];
    prepare(sql: string): Statement;
    getRowsModified(): number;
    close(): void;
    export(): Uint8Array;
  }

  interface Statement {
    bind(params?: unknown[]): boolean;
    step(): boolean;
    getAsObject(): Record<string, unknown>;
    free(): boolean;
    reset(): void;
    run(params?: unknown[]): void;
  }

  export type { Database, Statement, SqlJsStatic, QueryExecResult };

  function initSqlJs(config?: Record<string, unknown>): Promise<SqlJsStatic>;
  export default initSqlJs;
}
