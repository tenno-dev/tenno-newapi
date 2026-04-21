import { SQL } from "bun";
import type { SQLClient, PreparedStatement, BoundStatement } from "../../app/types";

interface ResolvedStatement extends BoundStatement {
  readonly _sql: string;
  readonly _params: unknown[];
}

function convertPlaceholders(sql: string): string {
  let idx = 0;
  return sql.replace(/\?/g, () => `$${++idx}`);
}

// Bun.sql returns Date objects for timestamp columns; normalise to ISO strings
function normalizeRow(row: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(row)) {
    out[k] = v instanceof Date ? v.toISOString() : v;
  }
  return out;
}

function makeStatement(sql: SQL, query: string, params: unknown[]): ResolvedStatement {
  return {
    _sql: query,
    _params: params,

    async run(): Promise<void> {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      await sql.unsafe(query, params as any[]);
    },

    async all<T>(): Promise<{ results: T[] }> {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const rows = (await sql.unsafe(query, params as any[])) as Record<string, unknown>[];
      return { results: rows.map(normalizeRow) as T[] };
    },
  };
}

export class BunSQLClient implements SQLClient {
  constructor(private readonly sql: SQL) {}

  prepare(rawSql: string): PreparedStatement {
    const query = convertPlaceholders(rawSql);
    return {
      bind: (...args: unknown[]): BoundStatement => makeStatement(this.sql, query, args),
    };
  }

  async batch(stmts: BoundStatement[]): Promise<void> {
    const resolved = stmts as ResolvedStatement[];
    await this.sql.begin(async (tx) => {
      for (const stmt of resolved) {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        await tx.unsafe(stmt._sql, stmt._params as any[]);
      }
    });
  }
}

export function createBunSQLClient(databaseUrl: string): SQLClient {
  return new BunSQLClient(new SQL(databaseUrl));
}
