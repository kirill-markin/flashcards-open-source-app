import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import pg from "pg";
import { loadAdminProfileEmail } from "./authz";

type ProfileEmailRow = Readonly<{
  email: string | null;
}>;

function requireRuntimeDatabaseUrl(): string {
  const databaseUrl = process.env.DATABASE_URL?.trim();
  if (databaseUrl === undefined || databaseUrl === "") {
    throw new Error("DATABASE_URL is required for the admin authorization PostgreSQL integration test.");
  }

  return databaseUrl;
}

function requireOwnerDatabaseUrl(): string {
  const databaseUrl = process.env.TEST_DATABASE_ADMIN_URL?.trim();
  if (databaseUrl === undefined || databaseUrl === "") {
    throw new Error(
      "TEST_DATABASE_ADMIN_URL is required for the admin authorization PostgreSQL integration test.",
    );
  }

  return databaseUrl;
}

test("admin profile email lookup applies the authenticated user scope", async () => {
  const userId = `catalog-admin-authz-${randomUUID()}`;
  const email = `catalog-admin-authz-${randomUUID()}@example.com`;
  const ownerPool = new pg.Pool({
    connectionString: requireOwnerDatabaseUrl(),
    application_name: "catalog-admin-authz-integration-owner",
  });
  const runtimePool = new pg.Pool({
    connectionString: requireRuntimeDatabaseUrl(),
    application_name: "catalog-admin-authz-integration-runtime",
  });

  try {
    await ownerPool.query(
      "INSERT INTO org.user_settings (user_id, email) VALUES ($1, $2)",
      [userId, email],
    );

    const unscopedResult = await runtimePool.query<ProfileEmailRow>(
      "SELECT email FROM org.user_settings WHERE user_id = $1",
      [userId],
    );
    assert.deepEqual(unscopedResult.rows, []);

    assert.deepEqual(await loadAdminProfileEmail(userId), { email });
  } finally {
    try {
      await ownerPool.query(
        "DELETE FROM org.user_settings WHERE user_id = $1",
        [userId],
      );
    } finally {
      await Promise.all([runtimePool.end(), ownerPool.end()]);
    }
  }
});
