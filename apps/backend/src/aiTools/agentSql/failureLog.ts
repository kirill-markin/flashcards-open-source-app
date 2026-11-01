import { randomUUID } from "node:crypto";
import {
  CloudWatchLogsClient,
  CreateLogStreamCommand,
  PutLogEventsCommand,
  ResourceAlreadyExistsException,
} from "@aws-sdk/client-cloudwatch-logs";
import {
  addBackendBreadcrumb,
  captureBackendException,
  normalizeCaughtError,
  type BackendObservationScope,
} from "../../observability/sentry";
import { createAgentSqlObservationScope } from "../../server/logging";
import { cutHeadAtCodePoint } from "../../shared/codePointCuts";
import type { AgentSqlSurface } from "./shared";

export type AgentSqlFailure = Readonly<{
  surface: AgentSqlSurface;
  caller: string | null;
  userId: string;
  workspaceId: string;
  connectionId: string;
  sqlFingerprint: string;
  errorCode: string | null;
  dialectReason: string | null;
  errorClass: string;
  sql: string;
  errorMessage: string;
}>;

type AgentSqlFailureLogOperation = "create_log_stream" | "put_log_events";

const maxCloudWatchLogsAttemptCount = 3;

// The caller's SQL error waits on this write, and on MCP it has only what the
// database time budget left of the 29 s request (`databaseTimeBudget.ts`).
const failureRecordWriteDeadlineMs = 2_000;

// CloudWatch Logs rejects an event over 1 MiB (the message's UTF-8 bytes plus 26).
const maximumRecordBytes = 900_000;
// JSON escaping and UTF-8 spend at most 6 bytes per UTF-16 code unit, so a record cut to these
// always fits under `maximumRecordBytes`.
const maximumCutSqlChars = 120_000;
const maximumCutErrorMessageChars = 20_000;

// One stream per Lambda execution environment.
const logStreamName = `${new Date().toISOString().slice(0, 10)}/${randomUUID()}`;

let cloudWatchLogsClient: CloudWatchLogsClient | null = null;
let logStreamCreation: Promise<void> | null = null;

// The caller is waiting to answer with its SQL error, so every attempt is bounded and the retry
// loop below owns all retries.
function getCloudWatchLogsClient(): CloudWatchLogsClient {
  if (cloudWatchLogsClient === null) {
    cloudWatchLogsClient = new CloudWatchLogsClient({
      maxAttempts: 1,
      requestHandler: { connectionTimeout: 1_000, requestTimeout: 1_000 },
    });
  }

  return cloudWatchLogsClient;
}

function getAgentSqlFailureLogGroupName(): string {
  const logGroupName = process.env.AGENT_SQL_FAILURE_LOG_GROUP_NAME;
  if (logGroupName === undefined || logGroupName === "") {
    throw new Error("AGENT_SQL_FAILURE_LOG_GROUP_NAME environment variable is not set");
  }

  return logGroupName;
}

function getCloudWatchLogsErrorStatusCode(error: unknown): number | null {
  if (typeof error !== "object" || error === null || !("$metadata" in error)) {
    return null;
  }

  const metadata = (error as Readonly<{
    $metadata?: Readonly<{
      httpStatusCode?: unknown;
    }>;
  }>).$metadata;

  return typeof metadata?.httpStatusCode === "number" ? metadata.httpStatusCode : null;
}

// Throttling, server faults, and attempts that got no response can succeed on retry; any other
// client fault (access denied, missing log group, invalid parameter) cannot.
function isTransientCloudWatchLogsError(error: unknown): boolean {
  if (error instanceof Error && error.name === "ThrottlingException") {
    return true;
  }

  const statusCode = getCloudWatchLogsErrorStatusCode(error);
  return statusCode === null || statusCode === 429 || statusCode >= 500;
}

async function runCloudWatchLogsOperationWithRetries<Result>(params: Readonly<{
  operation: AgentSqlFailureLogOperation;
  logGroupName: string;
  observationScope: BackendObservationScope;
  abortSignal: AbortSignal;
  run: () => Promise<Result>;
}>): Promise<Result> {
  let lastError: unknown = null;

  for (let attempt = 1; attempt <= maxCloudWatchLogsAttemptCount; attempt += 1) {
    try {
      return await params.run();
    } catch (error) {
      lastError = error;
      if (
        attempt === maxCloudWatchLogsAttemptCount
        || params.abortSignal.aborted
        || !isTransientCloudWatchLogsError(error)
      ) {
        break;
      }

      addBackendBreadcrumb({
        action: "agent_sql_failure_log_retry",
        scope: params.observationScope,
        details: {
          operation: params.operation,
          attempt,
          maxAttempts: maxCloudWatchLogsAttemptCount,
          logGroupName: params.logGroupName,
          logStreamName,
          statusCode: getCloudWatchLogsErrorStatusCode(error),
          errorClass: error instanceof Error ? error.name : "UnknownError",
          errorMessage: error instanceof Error ? error.message : String(error),
        },
      });
    }
  }

  throw lastError;
}

async function createLogStream(
  client: CloudWatchLogsClient,
  logGroupName: string,
  observationScope: BackendObservationScope,
  abortSignal: AbortSignal,
): Promise<void> {
  await runCloudWatchLogsOperationWithRetries({
    operation: "create_log_stream",
    logGroupName,
    observationScope,
    abortSignal,
    run: async () => {
      try {
        await client.send(new CreateLogStreamCommand({ logGroupName, logStreamName }), { abortSignal });
      } catch (error) {
        // A retried attempt whose first try created the stream lands here.
        if (!(error instanceof ResourceAlreadyExistsException)) {
          throw error;
        }
      }
    },
  });
}

// Shared by concurrent first writes, under the first writer's deadline; a failed or aborted
// creation is retried by the next write.
function ensureLogStream(
  client: CloudWatchLogsClient,
  logGroupName: string,
  observationScope: BackendObservationScope,
  abortSignal: AbortSignal,
): Promise<void> {
  if (logStreamCreation === null) {
    logStreamCreation = createLogStream(client, logGroupName, observationScope, abortSignal).catch((error: unknown) => {
      logStreamCreation = null;
      throw error;
    });
  }

  return logStreamCreation;
}

// A record always lands: an oversized one keeps the head of `sql` and `errorMessage`, and
// `sqlChars`, `errorMessageChars`, and `truncated` show the cut.
function serializeAgentSqlFailureRecord(
  failure: AgentSqlFailure,
  timestamp: Date,
  requestId: BackendObservationScope["requestId"],
): string {
  const record = {
    timestamp: timestamp.toISOString(),
    requestId,
    ...failure,
    sqlChars: failure.sql.length,
    errorMessageChars: failure.errorMessage.length,
    truncated: false,
  };
  const serialized = JSON.stringify(record);
  if (Buffer.byteLength(serialized, "utf8") <= maximumRecordBytes) {
    return serialized;
  }

  return JSON.stringify({
    ...record,
    sql: cutHeadAtCodePoint(failure.sql, maximumCutSqlChars),
    errorMessage: cutHeadAtCodePoint(failure.errorMessage, maximumCutErrorMessageChars),
    truncated: true,
  });
}

async function putAgentSqlFailureRecord(
  failure: AgentSqlFailure,
  logGroupName: string,
  observationScope: BackendObservationScope,
  abortSignal: AbortSignal,
): Promise<void> {
  const client = getCloudWatchLogsClient();
  await ensureLogStream(client, logGroupName, observationScope, abortSignal);
  const timestamp = new Date();
  const message = serializeAgentSqlFailureRecord(failure, timestamp, observationScope.requestId);
  const response = await runCloudWatchLogsOperationWithRetries({
    operation: "put_log_events",
    logGroupName,
    observationScope,
    abortSignal,
    run: async () => client.send(new PutLogEventsCommand({
      logGroupName,
      logStreamName,
      logEvents: [{ timestamp: timestamp.getTime(), message }],
    }), { abortSignal }),
  });

  if (response.rejectedLogEventsInfo !== undefined) {
    throw new Error(
      `CloudWatch Logs rejected the agent SQL failure record: ${JSON.stringify(response.rejectedLogEventsInfo)}`,
    );
  }
}

/**
 * Writes one failed agent SQL execution, with its full SQL and error message, to the dedicated
 * 30-day log group. Never throws: a lost record is reported without the SQL or the message, which
 * must stay out of the never-expiring Lambda log groups, and the caller's own SQL error is what
 * the client still receives.
 */
export async function writeAgentSqlFailureRecord(failure: AgentSqlFailure): Promise<void> {
  const observationScope = createAgentSqlObservationScope(failure.surface, failure.userId, failure.workspaceId);

  try {
    await putAgentSqlFailureRecord(
      failure,
      getAgentSqlFailureLogGroupName(),
      observationScope,
      AbortSignal.timeout(failureRecordWriteDeadlineMs),
    );
  } catch (error) {
    captureBackendException({
      action: "agent_sql_failure_log_write_failed",
      error: normalizeCaughtError(error),
      scope: observationScope,
      details: {
        surface: failure.surface,
        sqlFingerprint: failure.sqlFingerprint,
      },
    });
  }
}
