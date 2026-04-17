import pg from "pg";
import { getDatabaseCredentialsSecret } from "../secrets";

const reportingPoolMaxConnections = 4;

let reportingDatabaseUrl: string | undefined;
let reportingPool: pg.Pool | undefined;

async function getReportingDatabaseUrl(): Promise<string> {
  if (reportingDatabaseUrl !== undefined) {
    return reportingDatabaseUrl;
  }

  const secretArn = process.env.REPORTING_DB_SECRET_ARN;
  if (secretArn !== undefined && secretArn !== "") {
    const secret = await getDatabaseCredentialsSecret(secretArn);
    const host = process.env.DB_HOST;
    const dbName = process.env.DB_NAME;
    if (host === undefined || host.trim() === "" || dbName === undefined || dbName.trim() === "") {
      throw new Error("DB_HOST and DB_NAME are required when REPORTING_DB_SECRET_ARN is set");
    }

    reportingDatabaseUrl = `postgresql://${secret.username}:${encodeURIComponent(secret.password)}@${host}:5432/${dbName}`;
    return reportingDatabaseUrl;
  }

  const localDatabaseUrl = process.env.REPORTING_DATABASE_URL;
  if (localDatabaseUrl === undefined || localDatabaseUrl.trim() === "") {
    throw new Error("REPORTING_DATABASE_URL is required when REPORTING_DB_SECRET_ARN is not set");
  }

  reportingDatabaseUrl = localDatabaseUrl;
  return reportingDatabaseUrl;
}

async function getReportingPool(): Promise<pg.Pool> {
  if (reportingPool !== undefined) {
    return reportingPool;
  }

  const connectionString = await getReportingDatabaseUrl();
  const ssl = process.env.REPORTING_DB_SECRET_ARN !== undefined && process.env.REPORTING_DB_SECRET_ARN !== "";
  // Keep the pool below the reporting_readonly role connection limit.
  reportingPool = new pg.Pool({ connectionString, ssl, max: reportingPoolMaxConnections });
  return reportingPool;
}

export async function withReportingClient<Result>(
  run: (client: pg.PoolClient) => Promise<Result>,
): Promise<Result> {
  const client = await (await getReportingPool()).connect();
  try {
    return await run(client);
  } finally {
    client.release();
  }
}

export async function withReportingReadOnlyTransaction<Result>(
  run: (client: pg.PoolClient) => Promise<Result>,
): Promise<Result> {
  const client = await (await getReportingPool()).connect();
  try {
    await client.query("BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY");
    const result = await run(client);
    await client.query("COMMIT");
    return result;
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}
