import assert from "node:assert/strict";
import test from "node:test";
import type pg from "pg";
import { configureRuntimeRole, getManagedRuntimeRoles } from "./migrationRunner";

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
