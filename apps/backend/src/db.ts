import pg from "pg";
import { getDatabaseUrl } from "./config";

let pool: pg.Pool | undefined;

async function getPool(): Promise<pg.Pool> {
  if (!pool) {
    const connectionString = await getDatabaseUrl();
    const ssl = process.env.DB_SECRET_ARN ? true : false;
    pool = new pg.Pool({ connectionString, ssl });
  }
  return pool;
}

export async function query(text: string, params: ReadonlyArray<unknown>): Promise<pg.QueryResult> {
  return (await getPool()).query(text, params as unknown[]);
}
