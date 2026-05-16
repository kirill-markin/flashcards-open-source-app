import pg from "pg";
import {
  getDatabaseErrorFields,
  logDatabasePoolError,
  toDatabaseBoundaryError,
} from "../dbTransient";
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
  reportingPool.on("error", (error: Error): void => {
    logDatabasePoolError("reporting", error);
  });
  return reportingPool;
}

async function connectReportingClient(): Promise<pg.PoolClient> {
  try {
    return await (await getReportingPool()).connect();
  } catch (error) {
    throw toDatabaseBoundaryError(error);
  }
}

async function executeReportingTransactionCommand(
  client: pg.PoolClient,
  command: string,
): Promise<void> {
  try {
    await client.query(command);
  } catch (error) {
    throw toDatabaseBoundaryError(error);
  }
}

function logReportingRollbackFailure(originalError: unknown, rollbackError: unknown): void {
  const originalFields = getDatabaseErrorFields(originalError);
  const rollbackFields = getDatabaseErrorFields(rollbackError);
  console.warn(JSON.stringify({
    domain: "backend",
    action: "reporting_read_only_transaction_rollback_failed",
    originalSqlState: originalFields.sqlState,
    originalErrorCode: originalFields.errorCode,
    originalErrorClass: originalFields.errorClass,
    originalErrorMessage: originalFields.errorMessage,
    rollbackSqlState: rollbackFields.sqlState,
    rollbackErrorCode: rollbackFields.errorCode,
    rollbackErrorClass: rollbackFields.errorClass,
    rollbackErrorMessage: rollbackFields.errorMessage,
  }));
}

async function rollbackReportingTransaction(client: pg.PoolClient): Promise<unknown | null> {
  try {
    await client.query("ROLLBACK");
    return null;
  } catch (rollbackError) {
    return rollbackError;
  }
}

function toClientReleaseError(error: unknown): Error {
  if (error instanceof Error) {
    return error;
  }

  return new Error(String(error));
}

export async function withReportingClient<Result>(
  run: (client: pg.PoolClient) => Promise<Result>,
): Promise<Result> {
  const client = await connectReportingClient();
  try {
    return await run(client);
  } catch (error) {
    throw toDatabaseBoundaryError(error);
  } finally {
    client.release();
  }
}

export async function withReportingReadOnlyTransaction<Result>(
  run: (client: pg.PoolClient) => Promise<Result>,
): Promise<Result> {
  const client = await connectReportingClient();
  let releaseError: Error | undefined;
  try {
    await executeReportingTransactionCommand(client, "BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY");
    const result = await run(client);
    await executeReportingTransactionCommand(client, "COMMIT");
    return result;
  } catch (error) {
    const rollbackError = await rollbackReportingTransaction(client);
    if (rollbackError !== null) {
      logReportingRollbackFailure(error, rollbackError);
      releaseError = toClientReleaseError(rollbackError);
      throw toDatabaseBoundaryError(error);
    }

    throw toDatabaseBoundaryError(error);
  } finally {
    if (releaseError === undefined) {
      client.release();
    } else {
      client.release(releaseError);
    }
  }
}
