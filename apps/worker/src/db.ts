/**
 * Postgres connection pool and query helper.
 *
 * Pool is created lazily on first query. In Lambda, the connection string
 * is resolved from Secrets Manager (async), so eager creation is not possible.
 */

import pg from "pg";
import { getDatabaseUrl } from "./config";

let pool: pg.Pool | undefined;

async function getPool(): Promise<pg.Pool> {
  if (!pool) {
    const connectionString = await getDatabaseUrl();
    // ssl:true enables full certificate verification. RDS certs are signed by
    // Amazon's CA (not in Node.js defaults), so NODE_EXTRA_CA_CERTS must point
    // to the RDS CA bundle (set in CDK, bundle downloaded during Lambda bundling).
    const ssl = process.env.DB_SECRET_ARN ? true : false;
    pool = new pg.Pool({ connectionString, ssl });
  }
  return pool;
}

export const query = async (text: string, params: ReadonlyArray<unknown>): Promise<pg.QueryResult> =>
  (await getPool()).query(text, params as Array<unknown>);

export const endPool = async (): Promise<void> => {
  if (pool) {
    await pool.end();
    pool = undefined;
  }
};
