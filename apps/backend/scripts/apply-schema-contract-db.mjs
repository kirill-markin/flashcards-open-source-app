#!/usr/bin/env node
// Apply the full db/migrations chain (then db/views) to a throwaway Postgres so
// the workspace-bootstrap schema contract test can run against the real schema.
//
// Mirrors the apply semantics of apps/backend/src/database/migrationRunner.ts
// (one transaction per migration file, recorded in schema_migrations) but stays
// dependency-light (only `pg`) and decoupled from AWS Secrets Manager so it can
// run against a CI service container or a local Postgres. It lives inside the
// backend package so the bare `pg` import resolves from apps/backend/node_modules.
//
// Connection: BOOTSTRAP_CONTRACT_DATABASE_URL, else standard PG* env vars. The
// target database must be named `flashcards` because the migration chain runs
// `GRANT ... ON DATABASE flashcards` (db/migrations/0001, 0024, 0044). Must run
// as a superuser/owner role because migrations create roles, schemas,
// extensions, and row-level-security policies.

import { promises as fs } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
const migrationsDir = path.join(repoRoot, "db", "migrations");
const viewsDir = path.join(repoRoot, "db", "views");

async function listSqlFiles(directoryPath) {
  const entries = await fs.readdir(directoryPath, { withFileTypes: true });
  return entries
    .filter((entry) => entry.isFile() && entry.name.endsWith(".sql"))
    .map((entry) => entry.name)
    .sort((left, right) => left.localeCompare(right));
}

async function ensureSchemaMigrationsTable(client) {
  await client.query(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      filename TEXT PRIMARY KEY,
      applied_at TIMESTAMPTZ NOT NULL DEFAULT now()
    )
  `);
}

async function applyMigrations(client) {
  const fileNames = await listSqlFiles(migrationsDir);
  let appliedCount = 0;
  for (const fileName of fileNames) {
    const alreadyApplied = await client.query(
      "SELECT 1 FROM schema_migrations WHERE filename = $1",
      [fileName],
    );
    if (alreadyApplied.rowCount !== 0) {
      continue;
    }

    const sql = await fs.readFile(path.join(migrationsDir, fileName), "utf8");
    try {
      await client.query("BEGIN");
      await client.query(sql);
      await client.query("INSERT INTO schema_migrations (filename) VALUES ($1)", [fileName]);
      await client.query("COMMIT");
      appliedCount += 1;
    } catch (error) {
      await client.query("ROLLBACK");
      const message = error instanceof Error ? error.message : String(error);
      throw new Error(`Failed to apply migration ${fileName}: ${message}`);
    }
  }
  return appliedCount;
}

async function applyViews(client) {
  const fileNames = await listSqlFiles(viewsDir);
  for (const fileName of fileNames) {
    const sql = await fs.readFile(path.join(viewsDir, fileName), "utf8");
    try {
      await client.query(sql);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      throw new Error(`Failed to apply view ${fileName}: ${message}`);
    }
  }
  return fileNames.length;
}

async function main() {
  const connectionString = process.env.BOOTSTRAP_CONTRACT_DATABASE_URL;
  const client = connectionString ? new pg.Client({ connectionString }) : new pg.Client();
  await client.connect();
  try {
    await ensureSchemaMigrationsTable(client);
    const appliedMigrations = await applyMigrations(client);
    const appliedViews = await applyViews(client);
    process.stdout.write(
      `Applied ${appliedMigrations} migration(s) and ${appliedViews} view(s) to the contract database.\n`,
    );
  } finally {
    await client.end();
  }
}

main().catch((error) => {
  process.stderr.write(`${error instanceof Error ? error.stack ?? error.message : String(error)}\n`);
  process.exitCode = 1;
});
