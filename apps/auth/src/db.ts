import pg from "pg";
import { getDatabaseUrl } from "./config.js";

let pool: pg.Pool | undefined;

type SqlValue = string | number | boolean | Date | null | ReadonlyArray<string>;

export type DatabaseExecutor = Readonly<{
  query<Row extends pg.QueryResultRow>(
    text: string,
    params: ReadonlyArray<SqlValue>,
  ): Promise<pg.QueryResult<Row>>;
}>;

async function getPool(): Promise<pg.Pool> {
  if (pool !== undefined) {
    return pool;
  }

  const connectionString = await getDatabaseUrl();
  const ssl = process.env.DB_SECRET_ARN ? true : false;
  pool = new pg.Pool({ connectionString, ssl });
  return pool;
}

export async function query<Row extends pg.QueryResultRow>(
  text: string,
  params: ReadonlyArray<SqlValue>,
): Promise<pg.QueryResult<Row>> {
  return (await getPool()).query<Row>(text, params as Array<unknown>);
}

export async function transaction<Result>(
  callback: (executor: DatabaseExecutor) => Promise<Result>,
): Promise<Result> {
  const client = await (await getPool()).connect();
  const executor: DatabaseExecutor = {
    query<Row extends pg.QueryResultRow>(
      text: string,
      params: ReadonlyArray<SqlValue>,
    ): Promise<pg.QueryResult<Row>> {
      return client.query<Row>(text, params as Array<unknown>);
    },
  };

  try {
    await client.query("BEGIN");
    const result = await callback(executor);
    await client.query("COMMIT");
    return result;
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}
