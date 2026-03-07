import { promises as fs } from "node:fs";
import path from "node:path";
import pg from "pg";
import { getDatabaseCredentialsSecret } from "./secrets";

interface MigrationRunResult {
  appliedMigrations: ReadonlyArray<string>;
  appliedViews: ReadonlyArray<string>;
  appRoleConfigured: boolean;
}

function getRequiredEnv(name: string): string {
  const value = process.env[name];
  if (!value || value.trim() === "") {
    throw new Error(`${name} is required`);
  }
  return value;
}

function getSqlLiteral(value: string): string {
  return `'${value.replace(/'/g, "''")}'`;
}

async function listSqlFiles(directoryPath: string): Promise<ReadonlyArray<string>> {
  const entries = await fs.readdir(directoryPath, { withFileTypes: true });
  return entries
    .filter((entry) => entry.isFile() && entry.name.endsWith(".sql"))
    .map((entry) => entry.name)
    .sort((left, right) => left.localeCompare(right));
}

async function readSqlFile(directoryPath: string, fileName: string): Promise<string> {
  const filePath = path.join(directoryPath, fileName);
  return fs.readFile(filePath, "utf8");
}

async function ensureSchemaMigrationsTable(client: pg.Client): Promise<void> {
  await client.query(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      filename TEXT PRIMARY KEY,
      applied_at TIMESTAMPTZ NOT NULL DEFAULT now()
    )
  `);
}

async function applyPendingMigrations(
  client: pg.Client,
  directoryPath: string,
): Promise<ReadonlyArray<string>> {
  const appliedMigrations: Array<string> = [];
  const migrationFiles = await listSqlFiles(directoryPath);

  for (const fileName of migrationFiles) {
    const alreadyApplied = await client.query<{ exists: number }>(
      "SELECT 1 AS exists FROM schema_migrations WHERE filename = $1",
      [fileName],
    );
    if (alreadyApplied.rowCount !== 0) {
      continue;
    }

    const sql = await readSqlFile(directoryPath, fileName);
    try {
      await client.query(sql);
      await client.query("INSERT INTO schema_migrations (filename) VALUES ($1)", [fileName]);
      appliedMigrations.push(fileName);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      throw new Error(`Failed to apply migration ${fileName}: ${message}`);
    }
  }

  return appliedMigrations;
}

async function applyViews(client: pg.Client, directoryPath: string): Promise<ReadonlyArray<string>> {
  const appliedViews: Array<string> = [];
  const viewFiles = await listSqlFiles(directoryPath);

  for (const fileName of viewFiles) {
    const sql = await readSqlFile(directoryPath, fileName);
    try {
      await client.query(sql);
      appliedViews.push(fileName);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      throw new Error(`Failed to apply view ${fileName}: ${message}`);
    }
  }

  return appliedViews;
}

async function configureAppRole(client: pg.Client, appPassword: string): Promise<boolean> {
  const roleExists = await client.query<{ exists: number }>(
    "SELECT 1 AS exists FROM pg_roles WHERE rolname = 'app'",
    [],
  );
  if (roleExists.rowCount === 0) {
    return false;
  }

  await client.query(`ALTER ROLE app WITH PASSWORD ${getSqlLiteral(appPassword)}`);
  return true;
}

function getMigrationsDirectoryPath(): string {
  return path.join(__dirname, "db", "migrations");
}

function getViewsDirectoryPath(): string {
  return path.join(__dirname, "db", "views");
}

export async function runMigrations(): Promise<MigrationRunResult> {
  const ownerSecretArn = getRequiredEnv("DB_OWNER_SECRET_ARN");
  const appSecretArn = getRequiredEnv("DB_APP_SECRET_ARN");
  const host = getRequiredEnv("DB_HOST");
  const dbName = getRequiredEnv("DB_NAME");

  const ownerCredentials = await getDatabaseCredentialsSecret(ownerSecretArn);
  const appCredentials = await getDatabaseCredentialsSecret(appSecretArn);
  const connectionString = `postgresql://${ownerCredentials.username}:${encodeURIComponent(ownerCredentials.password)}@${host}:5432/${dbName}`;

  const client = new pg.Client({
    connectionString,
    ssl: true,
  });

  await client.connect();
  try {
    await ensureSchemaMigrationsTable(client);
    const appliedMigrations = await applyPendingMigrations(client, getMigrationsDirectoryPath());
    const appliedViews = await applyViews(client, getViewsDirectoryPath());
    const appRoleConfigured = await configureAppRole(client, appCredentials.password);

    return {
      appliedMigrations,
      appliedViews,
      appRoleConfigured,
    };
  } finally {
    await client.end();
  }
}
