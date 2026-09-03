import {
  DatabaseDeadlineExceededError,
  runDatabaseOperationsWithDeadline,
} from "../../database";
import { getDatabaseErrorFields } from "../../database/transient";
import { HttpError } from "../../shared/errors";

/**
 * Wall-clock budget for the database work of one agent SQL execution.
 *
 * Nothing else bounds how long an agent's statement runs: the dialect's row
 * limits bound what comes back, not the work it takes to get there. The
 * tightest surface such a statement reaches is MCP, whose Lambda is killed at
 * 30 s and whose HTTP API integration gives up at 29 s
 * (`infra/aws/lib/gateways/mcp-gateway.ts`), and a killed Lambda answers
 * nothing at all: the caller gets an opaque API Gateway 5xx, the `agent_sql`
 * record below is never written, and the invocation counts as a Lambda error.
 *
 * The 29 s is not all this budget's to spend, and what is left of it is the
 * value:
 *
 *   29 s  MCP integration timeout
 *   - 8 s post-commit analytics tail
 *   - 6 s cold start, token verification, envelope building and the response
 *   = 15 s
 *
 * The tail is the term this deadline cannot shorten. A write that commits then
 * drains the server facts it collected on the analytics pool, outside this
 * deadline and after the transaction returned, for up to the 4 s budget plus
 * one operation of up to 4 s already in flight
 * (`apps/backend/src/productAnalytics/serverFacts/postCommitBudget.ts`, which
 * sizes that ceiling against the same 29 s). Its wall time is therefore
 * additive: at 20 s this budget would leave a committing write about a second
 * of the request for everything else, which is the killed Lambda again.
 *
 * The 6 s is the rest of one MCP request: a VPC cold start that loads a secret
 * and opens a TLS connection to Postgres, OAuth token verification, SQL
 * parsing, and the envelope and JSON response after the statement. Far above
 * what a warm invocation spends, and well under the 10 s the direct image
 * ingestion route reserves for its own on-demand init
 * (`directImageIngestionMaximumOnDemandInitSeconds`), whose Lambda carries the
 * sharp bundle this one does not.
 *
 * What the value costs, stated rather than hidden. Against a median execution
 * of 80 ms, the slowest this surface has served were a five-statement batch at
 * 17.0 s and a SELECT returning four rows at 13.8 s, whose cost is the scan
 * behind the rows and not the rows. Both were measured before this deadline,
 * and the deadline is not free: publishing one moves the execution onto the
 * `deadline.ts` executor, which re-arms `statement_timeout` and `lock_timeout`
 * against the remaining budget before every statement, so each executor query
 * costs a second round trip. Their number follows rows touched rather than the
 * caller's statement count - one affected row on the mutation path is four
 * executor queries, so a full `MAX_SQL_BATCH_STATEMENT_COUNT` x
 * `MAX_SQL_RECORD_LIMIT` batch is tens of thousands of them. Less therefore
 * fits under 15 s than those two wall times suggest: the batch ends in the
 * error below instead of answering, and the SELECT is marginal at best. That is
 * the intent - both are on the same curve as the two executions that reached
 * 30 s and killed the Lambda - and raising the value to keep them is what the
 * arithmetic above forbids. Re-arming once per transaction would buy the cost
 * back and is deliberately not done: a timeout armed at transaction start with
 * the whole budget lets a late statement outlive the deadline on the server,
 * which is the runaway this exists to prevent.
 */
const AGENT_SQL_DATABASE_TIME_BUDGET_MS = 15_000;

// Bounds the cause walk below, which follows errors this process wrapped rather than any input, so
// the real chains are one or two links long. The bound only keeps a cyclic `cause` from hanging a
// request thread.
const AGENT_SQL_ERROR_CAUSE_MAX_DEPTH = 8;

function matchesDatabaseTimeBudgetExpiry(error: unknown): boolean {
  if (error instanceof DatabaseDeadlineExceededError) {
    return true;
  }

  const { sqlState } = getDatabaseErrorFields(error);
  return sqlState === "57014" || sqlState === "55P03";
}

/**
 * Recognizes every way that budget expires. One deadline becomes three bounds
 * in `apps/backend/src/database/deadline.ts`: a client-side timer, a Postgres
 * `statement_timeout`, and a `lock_timeout` derived from the same deadline. So
 * the same expiry arrives as a `DatabaseDeadlineExceededError`, as SQLSTATE
 * 57014, or as SQLSTATE 55P03, depending on which of them fired first.
 *
 * The cause chain is walked because a batch reaches this through
 * `wrapBatchExecutionError`, which reports which statement failed and keeps the
 * failure it wraps as the `cause`. Reading only the outermost error would
 * classify every batch expiry as an unexpected server error, on the very shape
 * that spends the most time.
 */
function isAgentSqlDatabaseTimeBudgetExpiry(error: unknown): boolean {
  let current: unknown = error;
  for (let depth = 0; depth < AGENT_SQL_ERROR_CAUSE_MAX_DEPTH; depth += 1) {
    if (matchesDatabaseTimeBudgetExpiry(current)) {
      return true;
    }
    if (!(current instanceof Error)) {
      return false;
    }
    current = current.cause;
  }

  return false;
}

/**
 * Keeps whatever context wrapped the expiry in front of the remedy. For a batch
 * that context is `wrapBatchExecutionError`'s `SQL batch statement N failed`,
 * the only thing that says which statement of the batch spent the budget, and
 * the locator every other batch failure on this surface already carries. It is
 * dropped when the expiry is the outermost error, where the driver's own
 * wording says nothing the remedy does not.
 *
 * That context can quote the caller's own SQL back to them, which is fine here
 * and is why the `agent_sql` record deliberately carries no message at all.
 */
function buildDatabaseTimeBudgetExpiryMessage(error: unknown): string {
  const remedy = `The statement exceeded the ${AGENT_SQL_DATABASE_TIME_BUDGET_MS} ms database time budget and was cancelled, so it changed nothing. Narrow the work and retry: add or lower LIMIT, add WHERE filters to touch fewer rows, or split a batch into fewer statements.`;
  if (matchesDatabaseTimeBudgetExpiry(error)) {
    return remedy;
  }

  const context = error instanceof Error ? error.message : String(error);
  return `${context} ${remedy}`;
}

/**
 * Runs one execution's database work under the budget above and reports an
 * expired budget the way the result-size budget reports an oversized payload:
 * an actionable 400 naming the limit, rather than the opaque INTERNAL_ERROR
 * that an unmapped driver error becomes on both the MCP and the REST surface.
 * Nothing survives the cancellation, since the statement takes its transaction
 * down with it, so the caller is told to narrow the work rather than to go and
 * check what landed.
 */
export async function executeWithinAgentSqlDatabaseTimeBudget<Result>(
  execute: () => Promise<Result>,
): Promise<Result> {
  try {
    return await runDatabaseOperationsWithDeadline(
      Date.now() + AGENT_SQL_DATABASE_TIME_BUDGET_MS,
      execute,
    );
  } catch (error) {
    if (!isAgentSqlDatabaseTimeBudgetExpiry(error)) {
      throw error;
    }

    throw new HttpError(
      400,
      buildDatabaseTimeBudgetExpiryMessage(error),
      "QUERY_TIME_LIMIT_EXCEEDED",
    );
  }
}
