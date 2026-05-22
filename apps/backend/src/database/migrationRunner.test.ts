import assert from "node:assert/strict";
import test from "node:test";
import type pg from "pg";
import {
  configureRuntimeRole,
  getManagedRuntimeRoles,
  parseBootstrapAdminEmails,
  planBootstrapAdminGrantSync,
} from "./migrationRunner";

type QueryRowValue = string | number | boolean | null;

type QueryRow = Readonly<Record<string, QueryRowValue>>;

type QueryResponse = Readonly<{
  rowCount: number;
  rows: ReadonlyArray<QueryRow>;
}>;

type QueryCall = Readonly<{
  sql: string;
  params: ReadonlyArray<string> | undefined;
}>;

function createStubClient(
  responses: ReadonlyArray<QueryResponse>,
): Readonly<{
  calls: Array<QueryCall>;
  client: Pick<pg.Client, "query">;
}> {
  const calls: Array<QueryCall> = [];
  const queuedResponses = [...responses];
  const client = {
    query: async (
      sql: string,
      params?: ReadonlyArray<string>,
    ): Promise<pg.QueryResult<pg.QueryResultRow>> => {
      calls.push({ sql, params });
      const nextResponse = queuedResponses.shift() ?? { rowCount: 0, rows: [] };
      return nextResponse as pg.QueryResult<pg.QueryResultRow>;
    },
  } as Pick<pg.Client, "query">;

  return {
    calls,
    client,
  };
}

test("reporting_readonly runtime role applies password only", async () => {
  const reportingRole = getManagedRuntimeRoles({
    backendAppPassword: "backend-pass",
    authAppPassword: "auth-pass",
    reportingReadonlyPassword: "reporting-pass",
  }).find((managedRuntimeRole) => managedRuntimeRole.roleName === "reporting_readonly");

  if (reportingRole === undefined) {
    throw new Error("reporting_readonly must be present in managed runtime roles");
  }

  const { calls, client } = createStubClient([
    { rowCount: 1, rows: [{ exists: 1 }] },
  ]);

  const configured = await configureRuntimeRole(client, reportingRole);

  assert.equal(configured, true);
  assert.deepEqual(calls, [
    {
      sql: "SELECT 1 AS exists FROM pg_roles WHERE rolname = $1",
      params: ["reporting_readonly"],
    },
    {
      sql: 'ALTER ROLE "reporting_readonly" WITH PASSWORD \'reporting-pass\'',
      params: undefined,
    },
  ]);
});

test("managed runtime roles always include reporting_readonly", () => {
  const managedRuntimeRoles = getManagedRuntimeRoles({
    backendAppPassword: "backend-pass",
    authAppPassword: "auth-pass",
    reportingReadonlyPassword: "reporting-pass",
  });

  assert.deepEqual(
    managedRuntimeRoles.map((managedRuntimeRole) => managedRuntimeRole.roleName),
    ["backend_app", "auth_app", "reporting_readonly"],
  );
});

test("parseBootstrapAdminEmails normalizes, deduplicates, and sorts emails", () => {
  assert.deepEqual(
    parseBootstrapAdminEmails("  Admin@example.com,admin@example.com,second@example.com "),
    ["admin@example.com", "second@example.com"],
  );
});

test("parseBootstrapAdminEmails ignores a trailing comma", () => {
  assert.deepEqual(
    parseBootstrapAdminEmails("admin@example.com,"),
    ["admin@example.com"],
  );
});

test("parseBootstrapAdminEmails ignores blank segments before validation", () => {
  assert.deepEqual(
    parseBootstrapAdminEmails(" admin@example.com, ,second@example.com,, "),
    ["admin@example.com", "second@example.com"],
  );
});

test("planBootstrapAdminGrantSync activates new and previously revoked bootstrap grants", () => {
  const plan = planBootstrapAdminGrantSync(
    [
      { email: "active@example.com", source: "bootstrap", revoked_at: null },
      { email: "revoked@example.com", source: "bootstrap", revoked_at: "2026-04-01T00:00:00Z" },
    ],
    ["active@example.com", "revoked@example.com", "new@example.com"],
  );

  assert.deepEqual(plan, {
    emailsToActivate: ["revoked@example.com", "new@example.com"],
    emailsToRevoke: [],
  });
});

test("planBootstrapAdminGrantSync revokes removed bootstrap grants only", () => {
  const plan = planBootstrapAdminGrantSync(
    [
      { email: "removed@example.com", source: "bootstrap", revoked_at: null },
      { email: "manual@example.com", source: "manual", revoked_at: null },
      { email: "already-revoked@example.com", source: "bootstrap", revoked_at: "2026-04-01T00:00:00Z" },
    ],
    ["manual@example.com"],
  );

  assert.deepEqual(plan, {
    emailsToActivate: [],
    emailsToRevoke: ["removed@example.com"],
  });
});

test("planBootstrapAdminGrantSync never overwrites manual grants", () => {
  const plan = planBootstrapAdminGrantSync(
    [
      { email: "manual@example.com", source: "manual", revoked_at: null },
    ],
    ["manual@example.com"],
  );

  assert.deepEqual(plan, {
    emailsToActivate: [],
    emailsToRevoke: [],
  });
});
