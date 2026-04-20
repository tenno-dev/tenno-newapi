import { Pool, PoolClient } from "pg";
import type { SQLClient, PreparedStatement, BoundStatement } from "../../app/types";

// Internal interface to carry the resolved SQL/params through batch()
interface ResolvedStatement extends BoundStatement {
  readonly _sql: string;
  readonly _params: unknown[];
}

function convertPlaceholders(sql: string): string {
  let idx = 0;
  return sql.replace(/\?/g, () => `$${++idx}`);
}

function makeStatement(pool: Pool, sql: string, params: unknown[]): ResolvedStatement {
  return {
    _sql: sql,
    _params: params,

    async run(): Promise<void> {
      await pool.query(sql, params);
    },

    async all<T>(): Promise<{ results: T[] }> {
      const result = await pool.query(sql, params);
      return { results: result.rows as T[] };
    },
  };
}

async function runWithClient(client: PoolClient, stmt: ResolvedStatement): Promise<void> {
  await client.query(stmt._sql, stmt._params);
}

export function createPostgresClient(pool: Pool): SQLClient {
  return {
    prepare(rawSql: string): PreparedStatement {
      const sql = convertPlaceholders(rawSql);
      return {
        bind(...args: unknown[]): BoundStatement {
          return makeStatement(pool, sql, args);
        },
      };
    },

    async batch(stmts: BoundStatement[]): Promise<void> {
      const resolved = stmts as ResolvedStatement[];
      const client = await pool.connect();
      try {
        await client.query("BEGIN");
        for (const stmt of resolved) {
          await runWithClient(client, stmt);
        }
        await client.query("COMMIT");
      } catch (err) {
        await client.query("ROLLBACK");
        throw err;
      } finally {
        client.release();
      }
    },
  };
}
