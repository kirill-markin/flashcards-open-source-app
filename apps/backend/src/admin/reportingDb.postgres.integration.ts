import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import pg from "pg";
import { withReportingClient, withReportingReadOnlyTransaction } from "./reportingDb";
import { TransientDatabaseHttpError } from "../database/transient";

type ConnectionCountRow = Readonly<{ count: number }>;
type ReportingProbeRow = Readonly<{ pid: number; role: string; read_only: string }>;

function requireOwnerDatabaseUrl(): string {
  const databaseUrl = process.env.TEST_DATABASE_ADMIN_URL?.trim();
  if (databaseUrl === undefined || databaseUrl === "") {
    throw new Error("TEST_DATABASE_ADMIN_URL is required for the reporting lifecycle PostgreSQL integration.");
  }
  return databaseUrl;
}

async function assertReportingConnectionsClosed(observer: pg.Pool, applicationName: string): Promise<void> {
  const deadlineAtMs = Date.now() + 5_000;
  while (true) {
    const result = await observer.query<ConnectionCountRow>(
      "SELECT count(*)::int AS count FROM pg_catalog.pg_stat_activity WHERE application_name = $1",
      [applicationName],
    );
    const count = result.rows[0]?.count;
    assert.ok(count !== undefined);
    if (count === 0) return;
    if (Date.now() >= deadlineAtMs) {
      assert.fail(`Completed reporting work retained PostgreSQL connections. count=${count}`);
    }
    await new Promise<void>((resolve) => setTimeout(resolve, 10));
  }
}

test("reporting callbacks and concurrent read-only transactions close their real PostgreSQL connections", async () => {
  const ownerDatabaseUrl = requireOwnerDatabaseUrl();
  const applicationName = `reporting-lifecycle-${randomUUID()}`;
  const reportingUrl = new URL(ownerDatabaseUrl);
  reportingUrl.searchParams.set("application_name", applicationName);
  const originalReportingDatabaseUrl = process.env.REPORTING_DATABASE_URL;
  const originalReportingSecretArn = process.env.REPORTING_DB_SECRET_ARN;
  process.env.REPORTING_DATABASE_URL = reportingUrl.toString();
  delete process.env.REPORTING_DB_SECRET_ARN;
  const observer = new pg.Pool({
    connectionString: ownerDatabaseUrl,
    application_name: "reporting-lifecycle-observer",
    connectionTimeoutMillis: 5_000,
    max: 1,
  });

  try {
    assert.equal(await withReportingClient(async (client) => {
      await client.query("SET ROLE reporting_readonly");
      return (await client.query<{ value: number }>("SELECT 42 AS value")).rows[0]?.value;
    }), 42);
    await assertReportingConnectionsClosed(observer, applicationName);

    const originalError = new TransientDatabaseHttpError(new Error("Reporting callback failure"));
    let callbackAttempts = 0;
    await assert.rejects(withReportingClient(async (client) => {
      callbackAttempts += 1;
      await client.query("SELECT 1");
      throw originalError;
    }), (error: unknown) => error === originalError);
    assert.equal(callbackAttempts, 1);
    await assertReportingConnectionsClosed(observer, applicationName);

    let acquiredTransactions = 0;
    let resolveBothAcquired!: () => void;
    let rejectBothAcquired!: (error: Error) => void;
    const bothAcquired = new Promise<void>((resolve, reject) => {
      resolveBothAcquired = resolve;
      rejectBothAcquired = reject;
    });
    const acquisitionTimer = setTimeout(() => {
      rejectBothAcquired(new Error("Two reporting transactions could not acquire clients concurrently."));
    }, 5_000);
    try {
      const results = await Promise.allSettled([1, 2].map(() => (
        withReportingReadOnlyTransaction(async (client) => {
          acquiredTransactions += 1;
          if (acquiredTransactions === 2) resolveBothAcquired();
          await bothAcquired;
          await client.query("SET LOCAL ROLE reporting_readonly");
          const result = await client.query<ReportingProbeRow>(
            "SELECT pg_backend_pid() AS pid, current_user AS role, current_setting('transaction_read_only') AS read_only",
          );
          const row = result.rows[0];
          assert.ok(row !== undefined);
          assert.equal(row.role, "reporting_readonly");
          assert.equal(row.read_only, "on");
          return row.pid;
        })
      )));
      const pids = results.map((result) => {
        if (result.status === "rejected") throw result.reason;
        return result.value;
      });
      assert.equal(new Set(pids).size, 2);
    } finally {
      clearTimeout(acquisitionTimer);
    }
    await assertReportingConnectionsClosed(observer, applicationName);

    callbackAttempts = 0;
    await assert.rejects(withReportingReadOnlyTransaction(async (client) => {
      callbackAttempts += 1;
      await client.query("SELECT 1");
      throw originalError;
    }), (error: unknown) => error === originalError);
    assert.equal(callbackAttempts, 1);
    await assertReportingConnectionsClosed(observer, applicationName);

    callbackAttempts = 0;
    await assert.rejects(withReportingReadOnlyTransaction(async (client) => {
      callbackAttempts += 1;
      await client.query("SELECT 1 / 0");
    }), (error: unknown) => typeof error === "object" && error !== null
      && "code" in error && error.code === "22012");
    assert.equal(callbackAttempts, 1);
    await assertReportingConnectionsClosed(observer, applicationName);
  } finally {
    if (originalReportingDatabaseUrl === undefined) {
      delete process.env.REPORTING_DATABASE_URL;
    } else {
      process.env.REPORTING_DATABASE_URL = originalReportingDatabaseUrl;
    }
    if (originalReportingSecretArn === undefined) {
      delete process.env.REPORTING_DB_SECRET_ARN;
    } else {
      process.env.REPORTING_DB_SECRET_ARN = originalReportingSecretArn;
    }
    await observer.end();
  }
});
