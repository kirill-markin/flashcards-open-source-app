import { promises as fs } from "node:fs";
import path from "node:path";
import pg from "pg";
import { getDatabaseCredentialsSecret } from "./secrets";

interface MigrationRunResult {
  appliedMigrations: ReadonlyArray<string>;
  appliedViews: ReadonlyArray<string>;
  configuredRuntimeRoles: ReadonlyArray<RuntimeRoleConfigurationResult>;
}

interface RuntimeRoleConfigurationResult {
  roleName: string;
  configured: boolean;
}

interface AdminGrantRow {
  email: string;
  source: string;
  revoked_at: Date | string | null;
}

interface BootstrapAdminGrantPlan {
  emailsToActivate: ReadonlyArray<string>;
  emailsToRevoke: ReadonlyArray<string>;
}

export interface ManagedRuntimeRole {
  roleName: string;
  rolePassword: string;
}

export interface RuntimeRolePasswords {
  backendAppPassword: string;
  authAppPassword: string;
  reportingReadonlyPassword: string;
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

function normalizeAdminEmail(email: string): string {
  const normalizedEmail = email.trim().toLowerCase();
  if (normalizedEmail === "") {
    throw new Error("ADMIN_EMAILS must not contain an empty email value");
  }

  if (!normalizedEmail.includes("@")) {
    throw new Error(`ADMIN_EMAILS contains an invalid email value: ${email}`);
  }

  return normalizedEmail;
}

export function parseBootstrapAdminEmails(rawValue: string | undefined): ReadonlyArray<string> {
  if (rawValue === undefined || rawValue.trim() === "") {
    return [];
  }

  return Array.from(new Set(
    rawValue
      .split(",")
      .map((value) => value.trim())
      .filter((value) => value !== "")
      .map((value) => normalizeAdminEmail(value)),
  )).sort((left, right) => left.localeCompare(right));
}

export function planBootstrapAdminGrantSync(
  existingRows: ReadonlyArray<AdminGrantRow>,
  bootstrapAdminEmails: ReadonlyArray<string>,
): BootstrapAdminGrantPlan {
  const bootstrapEmails = new Set(bootstrapAdminEmails);
  const emailsToActivate: Array<string> = [];
  const emailsToRevoke: Array<string> = [];

  for (const email of bootstrapAdminEmails) {
    const existingRow = existingRows.find((row) => row.email === email);
    if (existingRow === undefined) {
      emailsToActivate.push(email);
      continue;
    }

    if (existingRow.source === "manual") {
      continue;
    }

    if (existingRow.revoked_at !== null) {
      emailsToActivate.push(email);
    }
  }

  for (const existingRow of existingRows) {
    if (existingRow.source !== "bootstrap") {
      continue;
    }

    if (!bootstrapEmails.has(existingRow.email) && existingRow.revoked_at === null) {
      emailsToRevoke.push(existingRow.email);
    }
  }

  return {
    emailsToActivate,
    emailsToRevoke,
  };
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
      await client.query("BEGIN");
      await client.query(sql);
      await client.query("INSERT INTO schema_migrations (filename) VALUES ($1)", [fileName]);
      await client.query("COMMIT");
      appliedMigrations.push(fileName);
    } catch (error) {
      try {
        await client.query("ROLLBACK");
      } catch (rollbackError) {
        const rollbackMessage =
          rollbackError instanceof Error ? rollbackError.message : String(rollbackError);
        throw new Error(
          `Failed to rollback migration ${fileName}: ${rollbackMessage}`,
        );
      }
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

export function getManagedRuntimeRoles(
  runtimeRolePasswords: RuntimeRolePasswords,
): ReadonlyArray<ManagedRuntimeRole> {
  return [
    {
      roleName: "backend_app",
      rolePassword: runtimeRolePasswords.backendAppPassword,
    },
    {
      roleName: "auth_app",
      rolePassword: runtimeRolePasswords.authAppPassword,
    },
    {
      roleName: "reporting_readonly",
      rolePassword: runtimeRolePasswords.reportingReadonlyPassword,
    },
  ];
}

function getRuntimeRolePasswordSql(roleName: string, rolePassword: string): string {
  return `ALTER ROLE ${pg.escapeIdentifier(roleName)} WITH PASSWORD ${getSqlLiteral(rolePassword)}`;
}

export async function configureRuntimeRole(
  client: Pick<pg.Client, "query">,
  managedRuntimeRole: ManagedRuntimeRole,
): Promise<boolean> {
  const roleExists = await client.query<{ exists: number }>(
    "SELECT 1 AS exists FROM pg_roles WHERE rolname = $1",
    [managedRuntimeRole.roleName],
  );
  if (roleExists.rowCount === 0) {
    return false;
  }

  await client.query(getRuntimeRolePasswordSql(managedRuntimeRole.roleName, managedRuntimeRole.rolePassword));
  return true;
}

function getMigrationsDirectoryPath(): string {
  return path.join(__dirname, "db", "migrations");
}

function getViewsDirectoryPath(): string {
  return path.join(__dirname, "db", "views");
}

async function loadExistingAdminGrantRows(client: pg.Client): Promise<ReadonlyArray<AdminGrantRow>> {
  const result = await client.query<AdminGrantRow>(
    [
      "SELECT email, source, revoked_at",
      "FROM auth.admin_users",
    ].join(" "),
  );

  return result.rows;
}

async function syncBootstrapAdminGrants(
  client: pg.Client,
  rawBootstrapAdminEmails: string | undefined,
): Promise<void> {
  const bootstrapAdminEmails = parseBootstrapAdminEmails(rawBootstrapAdminEmails);
  const existingRows = await loadExistingAdminGrantRows(client);
  const plan = planBootstrapAdminGrantSync(existingRows, bootstrapAdminEmails);

  for (const email of plan.emailsToActivate) {
    await client.query(
      [
        "INSERT INTO auth.admin_users (email, granted_at, granted_by, revoked_at, note, source)",
        "VALUES ($1, now(), $2, NULL, NULL, 'bootstrap')",
        "ON CONFLICT (email) DO UPDATE",
        "SET granted_at = now(),",
        "    granted_by = EXCLUDED.granted_by,",
        "    revoked_at = NULL,",
        "    note = NULL,",
        "    source = 'bootstrap'",
        "WHERE auth.admin_users.source = 'bootstrap'",
      ].join(" "),
      [email, "bootstrap:ADMIN_EMAILS"],
    );
  }

  for (const email of plan.emailsToRevoke) {
    await client.query(
      [
        "UPDATE auth.admin_users",
        "SET revoked_at = now()",
        "WHERE email = $1",
        "  AND source = 'bootstrap'",
        "  AND revoked_at IS NULL",
      ].join(" "),
      [email],
    );
  }
}

export async function runMigrations(): Promise<MigrationRunResult> {
  const ownerSecretArn = getRequiredEnv("DB_OWNER_SECRET_ARN");
  const backendSecretArn = getRequiredEnv("DB_BACKEND_SECRET_ARN");
  const authSecretArn = getRequiredEnv("DB_AUTH_SECRET_ARN");
  const reportingSecretArn = getRequiredEnv("DB_REPORTING_SECRET_ARN");
  const host = getRequiredEnv("DB_HOST");
  const dbName = getRequiredEnv("DB_NAME");

  const ownerCredentials = await getDatabaseCredentialsSecret(ownerSecretArn);
  const backendCredentials = await getDatabaseCredentialsSecret(backendSecretArn);
  const authCredentials = await getDatabaseCredentialsSecret(authSecretArn);
  const reportingCredentials = await getDatabaseCredentialsSecret(reportingSecretArn);
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
    await syncBootstrapAdminGrants(client, process.env.ADMIN_EMAILS);
    const managedRuntimeRoles = getManagedRuntimeRoles({
      backendAppPassword: backendCredentials.password,
      authAppPassword: authCredentials.password,
      reportingReadonlyPassword: reportingCredentials.password,
    });
    const configuredRuntimeRoles: Array<RuntimeRoleConfigurationResult> = [];

    for (const managedRuntimeRole of managedRuntimeRoles) {
      configuredRuntimeRoles.push({
        roleName: managedRuntimeRole.roleName,
        configured: await configureRuntimeRole(client, managedRuntimeRole),
      });
    }

    return {
      appliedMigrations,
      appliedViews,
      configuredRuntimeRoles,
    };
  } finally {
    await client.end();
  }
}
