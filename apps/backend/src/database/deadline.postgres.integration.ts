import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import pg from "pg";
import {
  DatabaseDeadlineExceededError,
  DatabaseTransactionRolledBackError,
  queryWithPostgresDeadline,
  transactionWithPostgresDeadline,
} from "./deadline";
import { DatabaseCommitOutcomeUnknownError } from "./transient";

type CountRow = Readonly<{ count: number }>;

function requireTestDatabaseUrl(): string {
  const databaseUrl = process.env.TEST_DATABASE_ADMIN_URL?.trim();
  if (databaseUrl === undefined || databaseUrl === "") {
    throw new Error("TEST_DATABASE_ADMIN_URL is required for the PostgreSQL deadline integration test.");
  }
  return databaseUrl;
}

function createPool(maximumClients: number): pg.Pool {
  return new pg.Pool({
    connectionString: requireTestDatabaseUrl(),
    application_name: "database-deadline-integration",
    max: maximumClients,
  });
}

async function waitForLateCheckoutRelease(pool: pg.Pool): Promise<void> {
  const waitDeadlineAtMs = Date.now() + 5_000;
  while (pool.waitingCount !== 0 || pool.idleCount !== 1) {
    if (Date.now() >= waitDeadlineAtMs) {
      throw new Error(
        `Timed-out checkout was not released. waitingCount=${pool.waitingCount}; idleCount=${pool.idleCount}`,
      );
    }
    await new Promise<void>((resolve) => setTimeout(resolve, 10));
  }
}

function hasCode(error: unknown, code: string): boolean {
  return typeof error === "object" && error !== null && "code" in error && error.code === code;
}

test("PostgreSQL deadline boundary bounds checkout, statements, locks, rollback, and commit", async () => {
  const expiredPool = createPool(1);
  try {
    await assert.rejects(
      transactionWithPostgresDeadline(expiredPool, Date.now() - 1, async () => "unreachable"),
      (error: unknown) => error instanceof DatabaseDeadlineExceededError
        && error.phase === "pool_checkout",
    );
    assert.equal(expiredPool.totalCount, 0);
  } finally {
    await expiredPool.end();
  }

  const saturatedPool = createPool(1);
  const heldClient = await saturatedPool.connect();
  let heldClientReleased = false;
  try {
    await assert.rejects(
      transactionWithPostgresDeadline(
        saturatedPool,
        Date.now() + 1_000,
        async () => "unreachable",
      ),
      (error: unknown) => error instanceof DatabaseDeadlineExceededError
        && error.phase === "pool_checkout",
    );
    assert.equal(saturatedPool.waitingCount, 1);
    heldClient.release();
    heldClientReleased = true;
    await waitForLateCheckoutRelease(saturatedPool);
    assert.equal((await saturatedPool.query("SELECT 1 AS value")).rows[0]?.value, 1);
  } finally {
    if (!heldClientReleased) heldClient.release();
    await saturatedPool.end();
  }

  const transactionPool = createPool(1);
  try {
    const success = await transactionWithPostgresDeadline(
      transactionPool,
      Date.now() + 5_000,
      async (executor) => (await executor.query<{ value: number }>("SELECT 42 AS value", [])).rows[0]?.value,
    );
    assert.equal(success, 42);
    assert.equal(
      (await queryWithPostgresDeadline<{ value: number }>(
        transactionPool, Date.now() + 5_000, "SELECT 7 AS value", [],
      )).rows[0]?.value,
      7,
    );

    await transactionPool.query("CREATE TEMP TABLE deadline_rollback_probe (value integer)");
    await assert.rejects(
      transactionWithPostgresDeadline(transactionPool, Date.now() + 1_500, async (executor) => {
        await executor.query("INSERT INTO deadline_rollback_probe (value) VALUES (1)", []);
        await executor.query("SELECT pg_sleep(5)", []);
      }),
      (error: unknown) => hasCode(error, "57014"),
    );
    const rollbackResult = await transactionPool.query<CountRow>(
      "SELECT count(*)::int AS count FROM deadline_rollback_probe",
    );
    assert.equal(rollbackResult.rows[0]?.count, 0);

    await assert.rejects(
      transactionWithPostgresDeadline(transactionPool, Date.now() + 1_500, async (executor) => {
        await executor.query("INSERT INTO deadline_rollback_probe (value) VALUES (2)", []);
        try {
          await executor.query("SELECT pg_sleep(5)", []);
        } catch (error) {
          assert.ok(hasCode(error, "57014"));
        }
      }),
      (error: unknown) => error instanceof DatabaseTransactionRolledBackError
        && error.sqlState === "57014"
        && error.errorCode === "57014",
    );
    const swallowedStatementResult = await transactionPool.query<CountRow>(
      "SELECT count(*)::int AS count FROM deadline_rollback_probe",
    );
    assert.equal(swallowedStatementResult.rows[0]?.count, 0);
  } finally {
    await transactionPool.end();
  }

  const lockPool = createPool(2);
  const blocker = await lockPool.connect();
  const lockKey = Date.now();
  try {
    await blocker.query("SELECT pg_advisory_lock($1)", [lockKey]);
    await assert.rejects(
      transactionWithPostgresDeadline(lockPool, Date.now() + 1_500, async (executor) => {
        try {
          await executor.query("SELECT pg_advisory_xact_lock($1)", [lockKey]);
        } catch (error) {
          assert.ok(hasCode(error, "55P03"));
        }
      }),
      (error: unknown) => error instanceof DatabaseTransactionRolledBackError
        && error.sqlState === "55P03"
        && error.errorCode === "55P03",
    );
  } finally {
    await blocker.query("SELECT pg_advisory_unlock($1)", [lockKey]);
    blocker.release();
    await lockPool.end();
  }

  const commitPool = createPool(1);
  const commitProbeSuffix = randomUUID().replaceAll("-", "");
  const commitProbeTable = `deadline_commit_probe_${commitProbeSuffix}`;
  const commitFailureFunction = `fail_deadline_commit_${commitProbeSuffix}`;
  const commitFailureTrigger = `deadline_commit_failure_${commitProbeSuffix}`;
  try {
    await commitPool.query(`CREATE TABLE public.${commitProbeTable} (value integer)`);
    await commitPool.query(
      `CREATE FUNCTION public.${commitFailureFunction}() RETURNS trigger LANGUAGE plpgsql AS 'BEGIN RAISE EXCEPTION USING ERRCODE = ''57014'', MESSAGE = ''deadline commit probe''; RETURN NEW; END'`,
    );
    await commitPool.query(
      `CREATE CONSTRAINT TRIGGER ${commitFailureTrigger} AFTER INSERT ON public.${commitProbeTable} DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION public.${commitFailureFunction}()`,
    );

    await assert.rejects(
      transactionWithPostgresDeadline(commitPool, Date.now() + 5_000, async (executor) => {
        await executor.query(`INSERT INTO public.${commitProbeTable} (value) VALUES (1)`, []);
      }),
      (error: unknown) => hasCode(error, "57014")
        && !(error instanceof DatabaseCommitOutcomeUnknownError),
    );
    const commitFailureResult = await commitPool.query<CountRow>(
      `SELECT count(*)::int AS count FROM public.${commitProbeTable}`,
    );
    assert.equal(commitFailureResult.rows[0]?.count, 0);
  } finally {
    await commitPool.query(`DROP TABLE IF EXISTS public.${commitProbeTable}`);
    await commitPool.query(`DROP FUNCTION IF EXISTS public.${commitFailureFunction}()`);
    await commitPool.end();
  }
});
