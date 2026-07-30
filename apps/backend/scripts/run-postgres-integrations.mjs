import { spawn } from "node:child_process";
import { randomBytes } from "node:crypto";
import { readdir, readFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { performance } from "node:perf_hooks";
import { setTimeout as delay } from "node:timers/promises";
import { fileURLToPath, pathToFileURL } from "node:url";
import PgClient from "pg/lib/client.js";
import pgUtils from "pg/lib/utils.js";

const { escapeIdentifier, escapeLiteral } = pgUtils;

const scriptDirectory = dirname(fileURLToPath(import.meta.url));
const backendRoot = dirname(scriptDirectory);
const repositoryRoot = resolve(backendRoot, "..", "..");
const migrationsDirectory = join(repositoryRoot, "db", "migrations");
const administrativeDatabaseName = "postgres";
const disposableDatabaseName = "flashcards";
const lifecycleLockKeys = Object.freeze([1196572995, 1886546277]);
const lifecycleCleanupMaximumAttempts = 2;
const lifecycleCleanupTimeoutMilliseconds = 5_000;
const lifecycleRecoveryPollMilliseconds = 100;
const mutableWorkShutdownPollMilliseconds = 50;
const databaseTerminationPollMilliseconds = 100;
const cleanupClientTeardownReserveMilliseconds = 1_000;
const emergencyClientTeardownReserveMilliseconds = 50;
const databaseOidMinimum = 16_384;
const databaseOidSelectionMaximumAttempts = 64;
const postgresConnectionTimeoutMilliseconds = 5_000;
const postgresStartupOptions =
  "-c standard_conforming_strings=on -c client_encoding=UTF8";
const integrationChildDatabaseEnvironmentVariableNames = Object.freeze([
  "DATABASE_URL",
  "DB_AUTH_SECRET_ARN",
  "DB_BACKEND_SECRET_ARN",
  "DB_HOST",
  "DB_NAME",
  "DB_OWNER_SECRET_ARN",
  "DB_REPORTING_SECRET_ARN",
  "DB_SECRET_ARN",
  "NODE_PG_FORCE_NATIVE",
  "PGCLIENT_ENCODING",
  "PGCLIENTENCODING",
  "PGCONNECT_TIMEOUT",
  "PGDATABASE",
  "PGHOST",
  "PGHOSTADDR",
  "PGOPTIONS",
  "PGPASSFILE",
  "PGPASSWORD",
  "PGPORT",
  "PGREPLICATION",
  "PGREQUIRESSL",
  "PGSERVICE",
  "PGSERVICEFILE",
  "PGSSLCRL",
  "PGSSLCRLDIR",
  "PGSSLCERT",
  "PGSSLKEY",
  "PGSSLMODE",
  "PGSSLNEGOTIATION",
  "PGSSLROOTCERT",
  "PGTARGETSESSIONATTRS",
  "PGUSER",
  "POSTGRES_INTEGRATION_ADMIN_URL",
  "POSTGRES_INTEGRATION_EXPECTED_CLIENT_ENCODING",
  "POSTGRES_INTEGRATION_EXPECTED_DATABASE_NAME",
  "POSTGRES_INTEGRATION_EXPECTED_DATABASE_OID",
  "POSTGRES_INTEGRATION_EXPECTED_OWNER_USERNAME",
  "POSTGRES_INTEGRATION_EXPECTED_RUNTIME_USERNAME",
  "REPORTING_DATABASE_URL",
  "REPORTING_DB_SECRET_ARN",
  "TEST_DATABASE_ADMIN_URL",
]);
const managedRoleNames = Object.freeze([
  "app",
  "backend_app",
  "auth_app",
  "reporting_readonly",
]);
const createdRolesByMigration = new Map([
  ["0001_initial_schema.sql", Object.freeze(["app"])],
  ["0024_auth_runtime_roles.sql", Object.freeze(["backend_app", "auth_app"])],
  ["0044_reporting_readonly_role.sql", Object.freeze(["reporting_readonly"])],
]);
const boundaryDefinitions = Object.freeze([
  Object.freeze({
    migrationFileName: "0103_ai_chat_initiating_auth_classification.sql",
    expectedMigrationCount: 105,
    testFiles: Object.freeze([
      "src/cards/generatedImageAppend.postgres.integration.ts",
      "src/chat/cardImages/operation.postgres.integration.ts",
      "src/chat/cardImages/promotionJobs.postgres.integration.ts",
      "src/chat/runs/generatedImageAttemptBudget.postgres.integration.ts",
      "src/database/aiChatInitiatingAuthClassification.postgres.integration.ts",
    ]),
  }),
  Object.freeze({
    migrationFileName: "0102_media_blob_cleanup_reconciler.sql",
    expectedMigrationCount: 104,
    testFiles: Object.freeze([
      "src/mediaAssets/mediaBlobCleanup.postgres.integration.ts",
    ]),
  }),
  Object.freeze({
    migrationFileName: "0101_multipart_foreground_completion_fencing.sql",
    expectedMigrationCount: 103,
    testFiles: Object.freeze([
      "src/mediaAssets/atomicMultipartWriter.postgres.integration.ts",
      "src/mediaAssets/multipartForegroundFencing.postgres.integration.ts",
    ]),
  }),
  Object.freeze({
    migrationFileName: "0100_multipart_replacement_creation_claim.sql",
    expectedMigrationCount: 102,
    testFiles: Object.freeze([
      "src/mediaAssets/multipartReplacementCreationClaim.postgres.integration.ts",
      "src/mediaAssets/multipartUploadSessionCreation.postgres.integration.ts",
    ]),
  }),
  Object.freeze({
    migrationFileName: "0099_durable_multipart_completion_reconciliation.sql",
    expectedMigrationCount: 101,
    testFiles: Object.freeze([
      "src/database/deadline.postgres.integration.ts",
      "src/mediaAssets/blobLifecycle.postgres.integration.ts",
      "src/mediaAssets/directIngestionApply.postgres.integration.ts",
      "src/mediaAssets/multipartCompletionReconciliation.postgres.integration.ts",
      "src/mediaAssets/multipartWriterAbortReplay.postgres.integration.ts",
    ]),
  }),
  Object.freeze({
    migrationFileName: "0098_multipart_writer_abort_and_terminal_replay.sql",
    expectedMigrationCount: 100,
    testFiles: Object.freeze([
      "src/database/deadline.postgres.integration.ts",
      "src/mediaAssets/blobLifecycle.postgres.integration.ts",
      "src/mediaAssets/directIngestionApply.postgres.integration.ts",
      "src/mediaAssets/multipartWriterAbortReplay.postgres.integration.ts",
    ]),
  }),
  Object.freeze({
    migrationFileName: "0097_direct_multipart_writer_attempt_fencing.sql",
    expectedMigrationCount: 99,
    testFiles: Object.freeze([
      "src/mediaAssets/multipartWriterAbortReplay.postgres.integration.ts",
    ]),
  }),
  Object.freeze({
    migrationFileName: "0096_atomic_multipart_completion_resolution.sql",
    expectedMigrationCount: 98,
    testFiles: Object.freeze([
      "src/mediaAssets/mediaBlobWriterAttempts.postgres.integration.ts",
    ]),
  }),
]);
const backendRolePassword =
  `postgres-integration-${randomBytes(18).toString("hex")}`;

function asError(error) {
  return error instanceof Error ? error : new Error(String(error));
}

function contextualError(message, error) {
  const cause = asError(error);
  return new Error(`${message} cause=${cause.message}`, { cause });
}

function rootError(error) {
  let current = asError(error);
  const visited = new Set();
  while (
    current.cause instanceof Error
    && !visited.has(current.cause)
  ) {
    visited.add(current);
    current = current.cause;
  }
  return current;
}

function combineErrors(errors, message) {
  const seenRootErrors = new Set();
  const uniqueErrors = errors.filter((error) => {
    const root = rootError(error);
    if (seenRootErrors.has(root)) return false;
    seenRootErrors.add(root);
    return true;
  });
  if (uniqueErrors.length === 0) return null;
  if (uniqueErrors.length === 1) return uniqueErrors[0];
  return new AggregateError(uniqueErrors, message);
}

function createCleanupDeadline(phase) {
  return Object.freeze({
    expiresAt: performance.now() + lifecycleCleanupTimeoutMilliseconds,
    phase,
    timeoutMilliseconds: lifecycleCleanupTimeoutMilliseconds,
  });
}

function createTerminalCleanupController() {
  let activeDeadline = null;
  return Object.freeze({
    begin(phase) {
      if (activeDeadline === null) {
        activeDeadline = createCleanupDeadline(phase);
      }
      return activeDeadline;
    },
    clearCompletedBoundary(cleanupDeadline) {
      if (activeDeadline !== cleanupDeadline) {
        throw new Error(
          "PostgreSQL integration terminal cleanup deadline changed unexpectedly while completing a boundary.",
        );
      }
      activeDeadline = null;
    },
  });
}

function cleanupRemainingMilliseconds(cleanupDeadline, phase) {
  const remainingMilliseconds = Math.ceil(
    cleanupDeadline.expiresAt - performance.now(),
  );
  if (remainingMilliseconds <= 0) {
    const error = new Error(
      `PostgreSQL integration cleanup deadline expired before starting an operation. cleanupPhase=${cleanupDeadline.phase} operationPhase=${phase} timeoutMilliseconds=${cleanupDeadline.timeoutMilliseconds}`,
    );
    error.name = "PostgresIntegrationCleanupTimeoutError";
    throw error;
  }
  return remainingMilliseconds;
}

function cleanupOperationTimeoutError(cleanupDeadline, phase) {
  const error = new Error(
    `PostgreSQL integration cleanup operation exceeded the shared deadline and its client connection was forcibly terminated. cleanupPhase=${cleanupDeadline.phase} operationPhase=${phase} timeoutMilliseconds=${cleanupDeadline.timeoutMilliseconds}`,
  );
  error.name = "PostgresIntegrationCleanupTimeoutError";
  return error;
}

function decodeUrlAuthorityComponent(value, componentName) {
  try {
    return decodeURIComponent(value);
  } catch (error) {
    throw contextualError(
      `POSTGRES_INTEGRATION_ADMIN_URL contains an invalid percent-encoded authority component. component=${componentName}`,
      error,
    );
  }
}

function assertDisabledSslQuery(url, sourceName) {
  const parameterNames = [...new Set(url.searchParams.keys())];
  const unsupportedParameterNames = parameterNames
    .filter((parameterName) => parameterName !== "sslmode");
  if (unsupportedParameterNames.length > 0) {
    throw new Error(
      `${sourceName} contains unsupported PostgreSQL query parameters. supportedParameters=["sslmode"] actualUnsupportedParameters=${JSON.stringify(unsupportedParameterNames)}`,
    );
  }
  const sslModes = url.searchParams.getAll("sslmode");
  if (sslModes.length !== 1 || sslModes[0] !== "disable") {
    throw new Error(
      `${sourceName} must contain exactly one explicit sslmode=disable query parameter for the isolated local PostgreSQL service.`,
    );
  }
}

function requireAdminDatabaseConnection() {
  const value = process.env.POSTGRES_INTEGRATION_ADMIN_URL?.trim();
  if (value === undefined || value === "") {
    throw new Error(
      `POSTGRES_INTEGRATION_ADMIN_URL is required and must target the isolated PostgreSQL 18 ${administrativeDatabaseName} administrative database.`,
    );
  }

  let url;
  try {
    url = new URL(value);
  } catch {
    throw new Error(
      "POSTGRES_INTEGRATION_ADMIN_URL is not a valid URL. Provide a PostgreSQL URL with percent-encoded authority credentials, an explicit IPv4 or DNS hostname and port, the postgres database, and sslmode=disable.",
    );
  }
  if (url.protocol !== "postgres:" && url.protocol !== "postgresql:") {
    throw new Error(
      "POSTGRES_INTEGRATION_ADMIN_URL must use the postgres or postgresql URL scheme.",
    );
  }
  if (url.hostname === "") {
    throw new Error(
      "POSTGRES_INTEGRATION_ADMIN_URL must include an explicit hostname.",
    );
  }
  if (url.hostname.startsWith("[") || url.hostname.endsWith("]")) {
    throw new Error(
      "POSTGRES_INTEGRATION_ADMIN_URL does not support IPv6 literal hosts because the installed PostgreSQL child URL parser does not preserve parent/child host parity. Use an IPv4 address or DNS hostname.",
    );
  }
  if (url.port === "") {
    throw new Error(
      "POSTGRES_INTEGRATION_ADMIN_URL must include an explicit numeric port.",
    );
  }
  const port = Number(url.port);
  if (!Number.isInteger(port) || port < 1 || port > 65_535) {
    throw new Error(
      `POSTGRES_INTEGRATION_ADMIN_URL contains an invalid port. port=${url.port}`,
    );
  }
  const urlDatabaseName = url.pathname.replace(/^\/+/u, "");
  if (urlDatabaseName !== administrativeDatabaseName) {
    throw new Error(
      `POSTGRES_INTEGRATION_ADMIN_URL must target the canonical ${administrativeDatabaseName} administrative database so every runner instance uses the same lifecycle lock. actualDatabase=${urlDatabaseName || "(empty)"}`,
    );
  }
  if (url.username === "" || url.password === "") {
    throw new Error(
      "POSTGRES_INTEGRATION_ADMIN_URL must include administrative username and password credentials in the URL authority.",
    );
  }
  if (url.hash !== "") {
    throw new Error(
      "POSTGRES_INTEGRATION_ADMIN_URL must not contain a URL fragment.",
    );
  }
  assertDisabledSslQuery(url, "POSTGRES_INTEGRATION_ADMIN_URL");
  const username = decodeUrlAuthorityComponent(url.username, "username");
  const password = decodeUrlAuthorityComponent(url.password, "password");
  return Object.freeze({
    database: administrativeDatabaseName,
    host: url.hostname,
    password,
    port,
    ssl: false,
    username,
  });
}

function createDatabaseUrl(
  adminConnection,
  databaseName,
  username,
  password,
) {
  const url = new URL("postgresql://localhost");
  url.hostname = adminConnection.host.includes(":")
    ? `[${adminConnection.host}]`
    : adminConnection.host;
  url.port = String(adminConnection.port);
  url.pathname = `/${databaseName}`;
  url.username = encodeURIComponent(username);
  url.password = encodeURIComponent(password);
  url.searchParams.set("sslmode", "disable");
  return url.toString();
}

function createPostgresClientOptions(
  adminConnection,
  databaseName,
  username,
  password,
  applicationName,
) {
  return {
    application_name: applicationName,
    client_encoding: "UTF8",
    connectionTimeoutMillis: postgresConnectionTimeoutMilliseconds,
    database: databaseName,
    host: adminConnection.host,
    options: postgresStartupOptions,
    password,
    port: adminConnection.port,
    replication: "false",
    ssl: false,
    sslnegotiation: "postgres",
    user: username,
  };
}

function assertDisposableDatabaseUrl(databaseUrl, environmentVariableName) {
  const url = new URL(databaseUrl);
  if (url.protocol !== "postgresql:") {
    throw new Error(
      `PostgreSQL integration child URL must use the canonical postgresql scheme. environmentVariable=${environmentVariableName} actualProtocol=${url.protocol}`,
    );
  }
  if (url.hostname === "" || url.port === "") {
    throw new Error(
      `PostgreSQL integration child URL must contain an explicit host and port. environmentVariable=${environmentVariableName}`,
    );
  }
  const databaseName = url.pathname.replace(/^\/+/u, "");
  if (databaseName !== disposableDatabaseName) {
    throw new Error(
      `PostgreSQL integration child URL must target the disposable database. environmentVariable=${environmentVariableName} expectedDatabase=${disposableDatabaseName} actualDatabase=${databaseName || "(empty)"}`,
    );
  }
  if (url.username === "" || url.password === "") {
    throw new Error(
      `PostgreSQL integration child URL must contain authority credentials. environmentVariable=${environmentVariableName}`,
    );
  }
  if (url.hash !== "") {
    throw new Error(
      `PostgreSQL integration child URL must not contain a URL fragment. environmentVariable=${environmentVariableName}`,
    );
  }
  assertDisabledSslQuery(
    url,
    `PostgreSQL integration child URL environmentVariable=${environmentVariableName}`,
  );
  return url;
}

function createIntegrationChildEnvironment(
  parentEnvironment,
  runtimeDatabaseUrl,
  ownerDatabaseUrl,
  expectedDatabaseOid,
) {
  const runtimeUrl = assertDisposableDatabaseUrl(
    runtimeDatabaseUrl,
    "DATABASE_URL",
  );
  const ownerUrl = assertDisposableDatabaseUrl(
    ownerDatabaseUrl,
    "TEST_DATABASE_ADMIN_URL",
  );
  const runtimeUsername = decodeURIComponent(runtimeUrl.username);
  const ownerUsername = decodeURIComponent(ownerUrl.username);
  if (runtimeUsername !== "backend_app") {
    throw new Error(
      `PostgreSQL integration runtime URL must authenticate as backend_app. actualUsername=${runtimeUsername}`,
    );
  }
  if (
    runtimeUrl.protocol !== ownerUrl.protocol
    || runtimeUrl.host !== ownerUrl.host
  ) {
    throw new Error(
      "PostgreSQL integration runtime and owner URLs must target the same PostgreSQL server.",
    );
  }
  if (!/^[0-9]+$/u.test(expectedDatabaseOid)) {
    throw new Error(
      `PostgreSQL integration child environment requires an exact numeric database OID. actualOid=${expectedDatabaseOid}`,
    );
  }

  const sanitizedEnvironment = Object.fromEntries(
    Object.entries(parentEnvironment)
      .filter(([variableName]) => (
        !integrationChildDatabaseEnvironmentVariableNames.includes(variableName)
      )),
  );
  return {
    ...sanitizedEnvironment,
    DATABASE_URL: runtimeDatabaseUrl,
    PGCLIENT_ENCODING: "UTF8",
    PGOPTIONS: postgresStartupOptions,
    POSTGRES_INTEGRATION_EXPECTED_CLIENT_ENCODING: "UTF8",
    POSTGRES_INTEGRATION_EXPECTED_DATABASE_NAME: disposableDatabaseName,
    POSTGRES_INTEGRATION_EXPECTED_DATABASE_OID: expectedDatabaseOid,
    POSTGRES_INTEGRATION_EXPECTED_OWNER_USERNAME: ownerUsername,
    POSTGRES_INTEGRATION_EXPECTED_RUNTIME_USERNAME: runtimeUsername,
    TEST_DATABASE_ADMIN_URL: ownerDatabaseUrl,
  };
}

const postgresSessionContractSql = `
  SELECT
    current_database() AS database_name,
    current_setting('client_encoding') AS client_encoding,
    current_setting('standard_conforming_strings') AS standard_conforming_strings
`;

function assertPostgresSessionContractState(
  state,
  expectedDatabaseName,
  phase,
) {
  if (
    state?.database_name !== expectedDatabaseName
    || state.client_encoding !== "UTF8"
    || state.standard_conforming_strings !== "on"
  ) {
    throw new Error(
      `PostgreSQL session contract is invalid. phase=${phase} expectedDatabase=${expectedDatabaseName} actualDatabase=${state?.database_name ?? "missing"} expectedClientEncoding=UTF8 actualClientEncoding=${state?.client_encoding ?? "missing"} expectedStandardConformingStrings=on actualStandardConformingStrings=${state?.standard_conforming_strings ?? "missing"}`,
    );
  }
}

async function requirePostgresSessionContract(
  client,
  expectedDatabaseName,
  phase,
) {
  const result = await client.query(postgresSessionContractSql);
  assertPostgresSessionContractState(
    result.rows[0],
    expectedDatabaseName,
    phase,
  );
}

function createSupervisedPostgresClient(
  clientOptions,
  phase,
  onBackgroundFailure,
) {
  const client = new PgClient(clientOptions);
  let backgroundFailure = null;
  let closePromise = null;
  const handleError = (error) => {
    if (backgroundFailure !== null) return;
    backgroundFailure = contextualError(
      `PostgreSQL client emitted a background connection error. phase=${phase}`,
      error,
    );
    if (onBackgroundFailure !== null) {
      onBackgroundFailure(backgroundFailure);
    }
  };
  client.on("error", handleError);
  const beginClose = () => {
    if (closePromise !== null) return closePromise;
    try {
      closePromise = Promise.resolve(client.end());
    } catch (error) {
      closePromise = Promise.reject(error);
    }
    return closePromise;
  };
  return Object.freeze({
    abort() {
      const closing = beginClose();
      client.connection.stream.destroy();
      return closing;
    },
    backgroundFailure() {
      return backgroundFailure;
    },
    client,
    close() {
      return beginClose();
    },
    detach() {
      client.off("error", handleError);
    },
  });
}

async function finishTimedOutPostgresOperation(
  cleanupDeadline,
  phase,
  timeoutError,
  terminateTimedOutOperation,
) {
  const teardownPromise = Promise.resolve()
    .then(terminateTimedOutOperation);
  const teardownMilliseconds = Math.max(
    0,
    Math.floor(cleanupDeadline.expiresAt - performance.now()),
  );
  let teardownTimeoutHandle;
  const teardownTimeout = new Promise((resolve, reject) => {
    teardownTimeoutHandle = setTimeout(() => {
      reject(new Error(
        `Timed out awaiting forced PostgreSQL client/backend teardown. cleanupPhase=${cleanupDeadline.phase} operationPhase=${phase} timeoutMilliseconds=${cleanupDeadline.timeoutMilliseconds}`,
      ));
    }, teardownMilliseconds);
  });
  try {
    await Promise.race([teardownPromise, teardownTimeout]);
  } catch (teardownError) {
    throw new AggregateError(
      [timeoutError, asError(teardownError)],
      `PostgreSQL operation and forced client/backend teardown exceeded the shared deadline. cleanupPhase=${cleanupDeadline.phase} operationPhase=${phase}`,
    );
  } finally {
    clearTimeout(teardownTimeoutHandle);
  }
  throw timeoutError;
}

async function runDeadlineBoundPostgresOperation(
  cleanupDeadline,
  phase,
  teardownReserveMilliseconds,
  operation,
  terminateTimedOutOperation,
) {
  const remainingMilliseconds = cleanupRemainingMilliseconds(
    cleanupDeadline,
    phase,
  );
  if (remainingMilliseconds <= teardownReserveMilliseconds) {
    await finishTimedOutPostgresOperation(
      cleanupDeadline,
      phase,
      cleanupOperationTimeoutError(cleanupDeadline, phase),
      terminateTimedOutOperation,
    );
  }
  const operationTimeoutMilliseconds =
    remainingMilliseconds - teardownReserveMilliseconds;
  const neverSettles = new Promise(() => {});
  let timedOut = false;
  let timeoutHandle;
  const operationPromise = Promise.resolve()
    .then(operation)
    .then(
      (result) => (timedOut ? neverSettles : result),
      (error) => {
        if (timedOut) return neverSettles;
        throw error;
      },
    );
  const timeoutPromise = new Promise((resolve, reject) => {
    timeoutHandle = setTimeout(() => {
      timedOut = true;
      const timeoutError = cleanupOperationTimeoutError(
        cleanupDeadline,
        phase,
      );
      finishTimedOutPostgresOperation(
        cleanupDeadline,
        phase,
        timeoutError,
        terminateTimedOutOperation,
      ).catch(reject);
    }, operationTimeoutMilliseconds);
  });
  try {
    return await Promise.race([operationPromise, timeoutPromise]);
  } finally {
    clearTimeout(timeoutHandle);
  }
}

function runCleanupClientOperation(
  cleanupSession,
  cleanupDeadline,
  phase,
  operation,
) {
  return runDeadlineBoundPostgresOperation(
    cleanupDeadline,
    phase,
    cleanupClientTeardownReserveMilliseconds,
    operation,
    () => {
      cleanupSession.connected = false;
      cleanupSession.lockHeld = false;
      return cleanupSession.terminateTimedOutOperation(
        cleanupDeadline,
        phase,
      );
    },
  );
}

async function runEmergencyClientOperation(
  supervisedClient,
  cleanupDeadline,
  phase,
  operation,
) {
  return runDeadlineBoundPostgresOperation(
    cleanupDeadline,
    phase,
    emergencyClientTeardownReserveMilliseconds,
    operation,
    () => supervisedClient.abort(),
  );
}

function runCleanupQuery(
  cleanupSession,
  cleanupDeadline,
  phase,
  text,
  values,
) {
  return runCleanupClientOperation(
    cleanupSession,
    cleanupDeadline,
    phase,
    () => cleanupSession.supervisedClient.client.query(text, values),
  );
}

async function requireCleanupSessionContract(
  cleanupSession,
  cleanupDeadline,
  expectedDatabaseName,
  phase,
) {
  const result = await runCleanupQuery(
    cleanupSession,
    cleanupDeadline,
    phase,
    postgresSessionContractSql,
    [],
  );
  assertPostgresSessionContractState(
    result.rows[0],
    expectedDatabaseName,
    phase,
  );
}

function createMutableWorkSupervisor() {
  let firstShutdownFailure = null;
  let nextWorkId = 1;
  const activeWork = new Map();
  const shutdownErrors = [];
  let resolveShutdown;
  const shutdown = new Promise((resolveStartedShutdown) => {
    resolveShutdown = resolveStartedShutdown;
  });

  const finishEntry = (entry) => {
    if (
      !entry.completed
      || entry.rawOperations.size > 0
      || (entry.stopPromise !== null && !entry.stopSettled)
    ) {
      return;
    }
    activeWork.delete(entry.workId);
    entry.resolveSettlement();
  };

  const requestStop = (entry) => {
    if (entry.stopPromise !== null) return;
    entry.stopPromise = Promise.resolve()
      .then(entry.stop)
      .catch((error) => {
        shutdownErrors.push(contextualError(
          `Failed to stop mutable PostgreSQL integration work during terminal shutdown. phase=${entry.phase}`,
          error,
        ));
      })
      .finally(() => {
        entry.stopSettled = true;
        finishEntry(entry);
      });
  };

  const awaitTrackedOperation = (entry, operation, operationPhase) => {
    const rawOperation = Promise.resolve(operation);
    const operationState = {
      callerInterrupted: false,
      callerSettled: false,
      operationPhase,
      rawOperation,
    };
    entry.rawOperations.add(operationState);
    rawOperation.then(
      () => {
        entry.rawOperations.delete(operationState);
        finishEntry(entry);
      },
      (error) => {
        if (operationState.callerInterrupted) {
          shutdownErrors.push(contextualError(
            `Mutable PostgreSQL integration operation failed after terminal shutdown interrupted its caller. phase=${entry.phase} operationPhase=${operationPhase}`,
            error,
          ));
        }
        entry.rawOperations.delete(operationState);
        finishEntry(entry);
      },
    );

    const operationForCaller = rawOperation.then(
      (result) => {
        operationState.callerSettled = true;
        return result;
      },
      (error) => {
        operationState.callerSettled = true;
        throw error;
      },
    );
    const shutdownForCaller = shutdown.then((failure) => {
      if (!operationState.callerSettled) {
        operationState.callerInterrupted = true;
        operationState.callerSettled = true;
      }
      throw contextualError(
        `PostgreSQL integration work was interrupted by terminal shutdown. phase=${operationPhase}`,
        failure,
      );
    });
    return Promise.race([operationForCaller, shutdownForCaller]);
  };

  return Object.freeze({
    assertCanStart(phase) {
      if (firstShutdownFailure === null) return;
      throw contextualError(
        `Refusing to start mutable PostgreSQL integration work after terminal shutdown began. phase=${phase}`,
        firstShutdownFailure,
      );
    },
    async awaitOperation(operation, phase) {
      if (firstShutdownFailure !== null) {
        throw contextualError(
          `Refusing to await mutable PostgreSQL integration work after terminal shutdown began. phase=${phase}`,
          firstShutdownFailure,
        );
      }
      return Promise.race([
        Promise.resolve(operation),
        shutdown.then((failure) => {
          throw contextualError(
            `PostgreSQL integration work was interrupted by terminal shutdown. phase=${phase}`,
            failure,
          );
        }),
      ]);
    },
    errors() {
      return [...shutdownErrors];
    },
    register(phase, stop) {
      let resolveSettlement;
      const settlement = new Promise((resolveRegisteredWork) => {
        resolveSettlement = resolveRegisteredWork;
      });
      const workId = nextWorkId;
      nextWorkId += 1;
      const entry = {
        completed: false,
        phase,
        rawOperations: new Set(),
        resolveSettlement,
        settlement,
        stop,
        stopPromise: null,
        stopSettled: false,
        workId,
      };
      activeWork.set(workId, entry);
      if (firstShutdownFailure !== null) requestStop(entry);

      return Object.freeze({
        assertCanStart() {
          if (firstShutdownFailure === null) return;
          throw contextualError(
            `Refusing to start mutable PostgreSQL integration work after terminal shutdown began. phase=${phase}`,
            firstShutdownFailure,
          );
        },
        awaitOperation(operation, operationPhase) {
          return awaitTrackedOperation(
            entry,
            operation,
            operationPhase,
          );
        },
        complete() {
          if (entry.completed) return;
          entry.completed = true;
          finishEntry(entry);
        },
      });
    },
    stopAll(failure) {
      if (firstShutdownFailure === null) {
        firstShutdownFailure = failure;
        resolveShutdown(failure);
      }
      for (const entry of activeWork.values()) {
        requestStop(entry);
      }
    },
    async waitForStopped(cleanupDeadline) {
      if (activeWork.size === 0) return;
      while (activeWork.size > 0) {
        const entries = [...activeWork.values()];
        if (firstShutdownFailure !== null) {
          for (const entry of entries) requestStop(entry);
        }
        const remainingMilliseconds = cleanupRemainingMilliseconds(
          cleanupDeadline,
          `mutable work shutdown activePhases=${JSON.stringify(entries.map((entry) => entry.phase))}`,
        );
        await Promise.race([
          Promise.all(entries.map((entry) => entry.settlement)),
          delay(Math.min(
            mutableWorkShutdownPollMilliseconds,
            remainingMilliseconds,
          )),
        ]);
      }
    },
  });
}

async function withPostgresClient(
  clientOptions,
  phase,
  callback,
  mutableWorkSupervisor,
) {
  const supervisedClient = createSupervisedPostgresClient(
    clientOptions,
    phase,
    null,
  );
  const { client } = supervisedClient;
  const mutableWork = mutableWorkSupervisor.register(
    phase,
    () => supervisedClient.abort(),
  );
  let result;
  let primaryError = null;
  try {
    mutableWork.assertCanStart();
    await mutableWork.awaitOperation(
      client.connect(),
      `${phase} connection establishment`,
    );
    mutableWork.assertCanStart();
    await mutableWork.awaitOperation(
      requirePostgresSessionContract(
        client,
        clientOptions.database,
        `${phase} session contract verification`,
      ),
      `${phase} session contract verification`,
    );
    mutableWork.assertCanStart();
    result = await mutableWork.awaitOperation(
      callback(client),
      phase,
    );
  } catch (error) {
    primaryError = contextualError(
      `PostgreSQL integration client operation failed. phase=${phase}`,
      error,
    );
  }

  let closeError = null;
  try {
    await mutableWork.awaitOperation(
      supervisedClient.close(),
      `${phase} client close`,
    );
  } catch (error) {
    closeError = contextualError(
      `PostgreSQL integration client close failed. phase=${phase}`,
      error,
    );
  }
  const backgroundFailure = supervisedClient.backgroundFailure();
  supervisedClient.detach();
  mutableWork.complete();
  const failure = combineErrors(
    [
      ...(primaryError === null ? [] : [primaryError]),
      ...(backgroundFailure === null ? [] : [backgroundFailure]),
      ...(closeError === null ? [] : [closeError]),
    ],
    `PostgreSQL integration operation and client close failed. phase=${phase}`,
  );
  if (failure !== null) throw failure;
  return result;
}

async function acquireLifecycleLock(adminClient) {
  const result = await adminClient.query(
    `SELECT pg_catalog.pg_try_advisory_lock($1::integer, $2::integer) AS acquired`,
    lifecycleLockKeys,
  );
  if (result.rows[0]?.acquired !== true) {
    throw new Error(
      "Another PostgreSQL integration runner already owns the cluster lifecycle lock. Use a separate isolated PostgreSQL 18 cluster or wait for that runner to finish.",
    );
  }
}

async function reacquireLifecycleLockForCleanup(
  cleanupSession,
  cleanupDeadline,
) {
  while (true) {
    const result = await runCleanupQuery(
      cleanupSession,
      cleanupDeadline,
      "lifecycle lock reacquisition",
      `SELECT pg_catalog.pg_try_advisory_lock($1::integer, $2::integer) AS acquired`,
      lifecycleLockKeys,
    );
    if (result.rows[0]?.acquired === true) return;
    const remainingMilliseconds = cleanupRemainingMilliseconds(
      cleanupDeadline,
      "lifecycle lock reacquisition wait",
    );
    await delay(Math.min(
      lifecycleRecoveryPollMilliseconds,
      remainingMilliseconds,
    ));
  }
}

async function terminateDatabaseSessionsByOid(
  cleanupSession,
  cleanupDeadline,
  databaseOid,
  phase,
) {
  const terminationResult = await runCleanupQuery(
    cleanupSession,
    cleanupDeadline,
    `${phase} termination signals`,
    `SELECT
       pid,
       pg_catalog.pg_terminate_backend(
         pid,
         0
       ) AS terminated
     FROM pg_catalog.pg_stat_activity
     WHERE datid = $1::oid AND pid <> pg_catalog.pg_backend_pid()
     ORDER BY pid`,
    [databaseOid],
  );
  const unsignaledSessions = terminationResult.rows
    .filter((row) => row.terminated !== true)
    .map((row) => Object.freeze({
      pid: row.pid,
      signalAccepted: row.terminated,
    }));

  let remainingPids = [];
  while (true) {
    const sessionsResult = await runCleanupQuery(
      cleanupSession,
      cleanupDeadline,
      `${phase} termination polling`,
      `SELECT pid
       FROM pg_catalog.pg_stat_activity
       WHERE datid = $1::oid AND pid <> pg_catalog.pg_backend_pid()
       ORDER BY pid`,
      [databaseOid],
    );
    remainingPids = sessionsResult.rows.map((row) => row.pid);
    if (remainingPids.length === 0) break;
    const remainingMilliseconds = Math.floor(
      cleanupDeadline.expiresAt - performance.now(),
    );
    if (remainingMilliseconds <= cleanupClientTeardownReserveMilliseconds) {
      break;
    }
    await delay(Math.min(
      databaseTerminationPollMilliseconds,
      remainingMilliseconds - cleanupClientTeardownReserveMilliseconds,
    ));
  }

  if (unsignaledSessions.length > 0 || remainingPids.length > 0) {
    throw new Error(
      `PostgreSQL could not terminate every session on the exact runner-owned database OID within one shared deadline. databaseOid=${databaseOid} phase=${phase} timeoutMilliseconds=${cleanupDeadline.timeoutMilliseconds} unsignaledSessions=${JSON.stringify(unsignaledSessions)} remainingPids=${JSON.stringify(remainingPids)}`,
    );
  }
}

function getDatabaseOwnershipEvidence(boundaryState) {
  if (
    boundaryState.pendingDatabaseOid !== null
    && boundaryState.ownedDatabaseOid !== null
  ) {
    throw new Error(
      `PostgreSQL integration database ownership state contains both pending and promoted identities. database=${disposableDatabaseName} pendingOid=${boundaryState.pendingDatabaseOid} ownedOid=${boundaryState.ownedDatabaseOid}`,
    );
  }
  if (boundaryState.ownedDatabaseOid !== null) {
    return Object.freeze({
      databaseOid: boundaryState.ownedDatabaseOid,
      ownershipState: "owned",
    });
  }
  if (boundaryState.pendingDatabaseOid !== null) {
    return Object.freeze({
      databaseOid: boundaryState.pendingDatabaseOid,
      ownershipState: "pending",
    });
  }
  return null;
}

function classifyDatabaseIdentityRows(rows, expectedDatabaseOid) {
  const namedDatabase = rows.find(
    (row) => row.datname === disposableDatabaseName,
  );
  const oidDatabase = rows.find(
    (row) => row.database_oid === expectedDatabaseOid,
  );
  const nameMatch = namedDatabase === undefined
    ? null
    : Object.freeze({
      databaseName: namedDatabase.datname,
      databaseOid: namedDatabase.database_oid,
    });
  const oidMatch = oidDatabase === undefined
    ? null
    : Object.freeze({
      databaseName: oidDatabase.datname,
      databaseOid: oidDatabase.database_oid,
    });

  let classification;
  if (nameMatch === null && oidMatch === null) {
    classification = "absent";
  } else if (
    nameMatch?.databaseOid === expectedDatabaseOid
    && oidMatch?.databaseName === disposableDatabaseName
  ) {
    classification = "exact";
  } else if (nameMatch !== null && oidMatch !== null) {
    classification = "name-and-oid-conflict";
  } else if (nameMatch !== null) {
    classification = "name-conflict";
  } else {
    classification = "oid-conflict";
  }

  return Object.freeze({
    classification,
    expectedDatabaseOid,
    nameMatch,
    oidMatch,
  });
}

async function inspectDatabaseIdentity(adminClient, expectedDatabaseOid) {
  const result = await adminClient.query(
    `SELECT datname, oid::text AS database_oid
     FROM pg_catalog.pg_database
     WHERE datname = $1 OR oid = $2::oid
     ORDER BY datname`,
    [disposableDatabaseName, expectedDatabaseOid],
  );
  return classifyDatabaseIdentityRows(result.rows, expectedDatabaseOid);
}

async function inspectDatabaseIdentityForCleanup(
  cleanupSession,
  cleanupDeadline,
  expectedDatabaseOid,
  phase,
) {
  const result = await runCleanupQuery(
    cleanupSession,
    cleanupDeadline,
    phase,
    `SELECT datname, oid::text AS database_oid
     FROM pg_catalog.pg_database
     WHERE datname = $1 OR oid = $2::oid
     ORDER BY datname`,
    [disposableDatabaseName, expectedDatabaseOid],
  );
  return classifyDatabaseIdentityRows(result.rows, expectedDatabaseOid);
}

function databaseIdentityInterferenceError(identity, phase) {
  return new Error(
    `Refusing to claim or clean a PostgreSQL database after name/OID ownership interference. phase=${phase} expectedDatabase=${disposableDatabaseName} expectedOid=${identity.expectedDatabaseOid} classification=${identity.classification} nameMatchDatabase=${identity.nameMatch?.databaseName ?? "missing"} nameMatchOid=${identity.nameMatch?.databaseOid ?? "missing"} oidMatchDatabase=${identity.oidMatch?.databaseName ?? "missing"} oidMatchOid=${identity.oidMatch?.databaseOid ?? "missing"}`,
  );
}

async function inspectOwnedRoleIdentities(
  cleanupSession,
  cleanupDeadline,
  boundaryState,
  phase,
) {
  const ownedRoles = [...boundaryState.ownedRoleOids.entries()];
  if (ownedRoles.length === 0) return Object.freeze([]);

  const result = await runCleanupQuery(
    cleanupSession,
    cleanupDeadline,
    phase,
    `SELECT rolname, oid::text AS role_oid
     FROM pg_catalog.pg_roles
     WHERE rolname = ANY($1::text[]) OR oid = ANY($2::oid[])
     ORDER BY rolname`,
    [
      ownedRoles.map(([roleName]) => roleName),
      ownedRoles.map(([, roleOid]) => roleOid),
    ],
  );
  return Object.freeze(ownedRoles.map(([roleName, expectedRoleOid]) => {
    const namedRole = result.rows.find((row) => row.rolname === roleName);
    const oidRole = result.rows.find(
      (row) => row.role_oid === expectedRoleOid,
    );
    const nameMatch = namedRole === undefined
      ? null
      : Object.freeze({
        roleName: namedRole.rolname,
        roleOid: namedRole.role_oid,
      });
    const oidMatch = oidRole === undefined
      ? null
      : Object.freeze({
        roleName: oidRole.rolname,
        roleOid: oidRole.role_oid,
      });

    let classification;
    if (nameMatch === null && oidMatch === null) {
      classification = "absent";
    } else if (
      nameMatch?.roleOid === expectedRoleOid
      && oidMatch?.roleName === roleName
    ) {
      classification = "exact";
    } else if (nameMatch !== null && oidMatch !== null) {
      classification = "name-and-oid-conflict";
    } else if (nameMatch !== null) {
      classification = "name-conflict";
    } else {
      classification = "oid-conflict";
    }

    return Object.freeze({
      classification,
      expectedRoleOid,
      nameMatch,
      oidMatch,
      roleName,
    });
  }));
}

function roleIdentityInterferenceError(identity, phase) {
  return new Error(
    `Refusing to clean a PostgreSQL role after name/OID ownership interference. phase=${phase} expectedRole=${identity.roleName} expectedOid=${identity.expectedRoleOid} classification=${identity.classification} nameMatchRole=${identity.nameMatch?.roleName ?? "missing"} nameMatchOid=${identity.nameMatch?.roleOid ?? "missing"} oidMatchRole=${identity.oidMatch?.roleName ?? "missing"} oidMatchOid=${identity.oidMatch?.roleOid ?? "missing"}`,
  );
}

async function inspectBoundaryCleanupIdentities(
  cleanupSession,
  cleanupDeadline,
  boundaryState,
) {
  const databaseOwnership = getDatabaseOwnershipEvidence(boundaryState);
  const databaseIdentity = databaseOwnership === null
    ? null
    : await inspectDatabaseIdentityForCleanup(
      cleanupSession,
      cleanupDeadline,
      databaseOwnership.databaseOid,
      "whole-boundary database identity classification",
    );
  const roleIdentities = await inspectOwnedRoleIdentities(
    cleanupSession,
    cleanupDeadline,
    boundaryState,
    "whole-boundary role identity classification",
  );
  return Object.freeze({
    databaseIdentity,
    databaseOwnership,
    roleIdentities,
  });
}

function cleanupIdentityConflictErrors(cleanupIdentities) {
  const conflicts = [];
  if (
    cleanupIdentities.databaseIdentity !== null
    && cleanupIdentities.databaseIdentity.classification !== "exact"
    && cleanupIdentities.databaseIdentity.classification !== "absent"
  ) {
    conflicts.push(databaseIdentityInterferenceError(
      cleanupIdentities.databaseIdentity,
      "whole-boundary cleanup classification",
    ));
  }
  for (const roleIdentity of cleanupIdentities.roleIdentities) {
    if (
      roleIdentity.classification === "exact"
      || roleIdentity.classification === "absent"
    ) {
      continue;
    }
    conflicts.push(roleIdentityInterferenceError(
      roleIdentity,
      "whole-boundary cleanup classification",
    ));
  }
  return conflicts;
}

async function releaseLifecycleLock(cleanupSession, cleanupDeadline) {
  const result = await runCleanupQuery(
    cleanupSession,
    cleanupDeadline,
    "lifecycle lock release",
    `SELECT pg_catalog.pg_advisory_unlock($1::integer, $2::integer) AS released`,
    lifecycleLockKeys,
  );
  if (result.rows[0]?.released !== true) {
    throw new Error(
      "PostgreSQL integration lifecycle lock was not held by the administrative session during release.",
    );
  }
}

async function assertLifecycleLockHeld(cleanupSession, cleanupDeadline) {
  const result = await runCleanupQuery(
    cleanupSession,
    cleanupDeadline,
    "lifecycle lock verification",
    `SELECT EXISTS (
       SELECT 1
       FROM pg_catalog.pg_locks
       WHERE
         locktype = 'advisory'
         AND pid = pg_catalog.pg_backend_pid()
         AND classid = $1::oid
         AND objid = $2::oid
         AND objsubid = 2
         AND granted
     ) AS held`,
    lifecycleLockKeys,
  );
  if (result.rows[0]?.held !== true) {
    throw new Error(
      "PostgreSQL integration administrative session no longer owns the lifecycle advisory lock.",
    );
  }
}

function createSignalInterruptionError(signal, phase) {
  const error = new Error(
    `PostgreSQL integration interrupted by signal. signal=${signal} phase=${phase}`,
  );
  error.name = "PostgresIntegrationSignalError";
  return error;
}

function createSignalSupervisor(handleFirstSignal) {
  let firstSignal = null;
  let activeChild = null;
  let installed = false;

  const terminateActiveChild = (signal) => {
    if (
      activeChild !== null
      && activeChild.exitCode === null
      && activeChild.signalCode === null
    ) {
      activeChild.kill(signal);
    }
  };
  const handleSignal = (signal) => {
    if (firstSignal === null) {
      firstSignal = signal;
      handleFirstSignal(
        signal,
        createSignalInterruptionError(signal, "signal handler"),
      );
    }
    terminateActiveChild(firstSignal);
  };
  const handleSigint = () => handleSignal("SIGINT");
  const handleSigterm = () => handleSignal("SIGTERM");

  return Object.freeze({
    install() {
      if (installed) {
        throw new Error("PostgreSQL integration signal handlers are already installed.");
      }
      process.on("SIGINT", handleSigint);
      process.on("SIGTERM", handleSigterm);
      installed = true;
    },
    uninstall() {
      if (!installed) return;
      process.off("SIGINT", handleSigint);
      process.off("SIGTERM", handleSigterm);
      installed = false;
    },
    firstSignal() {
      return firstSignal;
    },
    throwIfSignaled(phase) {
      if (firstSignal === null) return;
      throw createSignalInterruptionError(firstSignal, phase);
    },
    setActiveChild(child) {
      if (activeChild !== null) {
        throw new Error("A PostgreSQL integration child process is already active.");
      }
      activeChild = child;
      if (
        firstSignal !== null
        && child.exitCode === null
        && child.signalCode === null
      ) {
        child.kill(firstSignal);
      }
    },
    clearActiveChild(child) {
      if (activeChild === child) activeChild = null;
    },
  });
}

function createLifecycleAdminSession(
  adminConnection,
  mutableWorkSupervisor,
) {
  let activeSession = null;
  let fatalBackgroundFailure = null;
  let terminalInterruptionPromise = null;
  const administrativeErrors = [];

  const recordBackgroundFailure = (session, failure) => {
    session.connected = false;
    session.lockHeld = false;
    if (session.closed) return;
    administrativeErrors.push(failure);
    if (fatalBackgroundFailure === null) {
      fatalBackgroundFailure = failure;
    }
    mutableWorkSupervisor.stopAll(failure);
  };

  const terminateTimedOutOperation = async (
    session,
    cleanupDeadline,
    phase,
  ) => {
    const targetClient = session.supervisedClient.client;
    const targetBackendPid = targetClient.processID;
    const targetClosePromise = session.supervisedClient.abort();
    targetClosePromise.catch(() => {});
    if (!Number.isInteger(targetBackendPid)) {
      await runEmergencyClientOperation(
        session.supervisedClient,
        cleanupDeadline,
        `${phase} client teardown before backend identity was available`,
        () => targetClosePromise,
      );
      return;
    }

    const remainingMilliseconds = cleanupRemainingMilliseconds(
      cleanupDeadline,
      `${phase} timed-out backend termination connection creation`,
    );
    if (remainingMilliseconds <= emergencyClientTeardownReserveMilliseconds) {
      throw cleanupOperationTimeoutError(
        cleanupDeadline,
        `${phase} timed-out backend termination connection creation`,
      );
    }
    const emergencyClient = createSupervisedPostgresClient(
      {
        ...createPostgresClientOptions(
          adminConnection,
          adminConnection.database,
          adminConnection.username,
          adminConnection.password,
          "postgres-integration-timeout-terminator",
        ),
        connectionTimeoutMillis:
          remainingMilliseconds - emergencyClientTeardownReserveMilliseconds,
        statement_timeout:
          remainingMilliseconds - emergencyClientTeardownReserveMilliseconds,
      },
      `${phase} timed-out backend termination`,
      null,
    );
    let primaryError = null;
    const finalizationErrors = [];
    try {
      await runEmergencyClientOperation(
        emergencyClient,
        cleanupDeadline,
        `${phase} timed-out backend termination connection establishment`,
        () => emergencyClient.client.connect(),
      );
      const sessionContractResult = await runEmergencyClientOperation(
        emergencyClient,
        cleanupDeadline,
        `${phase} timeout terminator session contract verification`,
        () => emergencyClient.client.query(postgresSessionContractSql),
      );
      assertPostgresSessionContractState(
        sessionContractResult.rows[0],
        adminConnection.database,
        `${phase} timeout terminator session contract verification`,
      );
      await runEmergencyClientOperation(
        emergencyClient,
        cleanupDeadline,
        `${phase} timed-out backend termination signal`,
        () => emergencyClient.client.query(
          "SELECT pg_catalog.pg_terminate_backend($1::integer, 0) AS terminated",
          [targetBackendPid],
        ),
      );

      while (true) {
        const targetResult = await runEmergencyClientOperation(
          emergencyClient,
          cleanupDeadline,
          `${phase} timed-out backend termination polling`,
          () => emergencyClient.client.query(
            `SELECT EXISTS (
               SELECT 1
               FROM pg_catalog.pg_stat_activity
               WHERE pid = $1::integer
             ) AS target_exists`,
            [targetBackendPid],
          ),
        );
        if (targetResult.rows[0]?.target_exists !== true) break;
        const pollRemainingMilliseconds = Math.floor(
          cleanupDeadline.expiresAt - performance.now(),
        );
        if (
          pollRemainingMilliseconds
          <= emergencyClientTeardownReserveMilliseconds
        ) {
          throw cleanupOperationTimeoutError(
            cleanupDeadline,
            `${phase} timed-out backend termination polling`,
          );
        }
        await delay(Math.min(
          databaseTerminationPollMilliseconds,
          pollRemainingMilliseconds
            - emergencyClientTeardownReserveMilliseconds,
        ));
      }
      await runEmergencyClientOperation(
        emergencyClient,
        cleanupDeadline,
        `${phase} timed-out client teardown completion`,
        () => targetClosePromise,
      );
    } catch (error) {
      primaryError = contextualError(
        `Failed to terminate and await a timed-out PostgreSQL cleanup backend. operationPhase=${phase} backendPid=${targetBackendPid}`,
        error,
      );
    }

    try {
      await runEmergencyClientOperation(
        emergencyClient,
        cleanupDeadline,
        `${phase} timeout terminator client close`,
        () => emergencyClient.close(),
      );
    } catch (error) {
      finalizationErrors.push(contextualError(
        `Failed to close the PostgreSQL timeout terminator client. operationPhase=${phase}`,
        error,
      ));
    }
    const backgroundFailure = emergencyClient.backgroundFailure();
    emergencyClient.detach();
    const failure = combineErrors(
      [
        ...(primaryError === null ? [] : [primaryError]),
        ...(backgroundFailure === null ? [] : [backgroundFailure]),
        ...finalizationErrors,
      ],
      `PostgreSQL timed-out cleanup backend termination and emergency client finalization failed. operationPhase=${phase} backendPid=${targetBackendPid}`,
    );
    if (failure !== null) throw failure;
  };

  const createSession = (phase, connectionTimeoutMilliseconds) => {
    const session = {
      closed: false,
      connectAttempted: false,
      connected: false,
      lockHeld: false,
      supervisedClient: null,
      terminateTimedOutOperation: null,
    };
    session.supervisedClient = createSupervisedPostgresClient(
      {
        ...createPostgresClientOptions(
          adminConnection,
          adminConnection.database,
          adminConnection.username,
          adminConnection.password,
          "postgres-integration-database-supervisor",
        ),
        connectionTimeoutMillis: connectionTimeoutMilliseconds,
      },
      phase,
      (failure) => recordBackgroundFailure(session, failure),
    );
    session.terminateTimedOutOperation = (
      cleanupDeadline,
      operationPhase,
    ) => terminateTimedOutOperation(
      session,
      cleanupDeadline,
      operationPhase,
    );
    activeSession = session;
    return session;
  };

  const connectSession = async (session) => {
    session.connectAttempted = true;
    await session.supervisedClient.client.connect();
    session.connected = true;
  };

  const closeSessionForCleanup = async (
    session,
    cleanupDeadline,
    phase,
  ) => {
    if (session.closed) return;
    let closeError = null;
    try {
      if (session.connectAttempted) {
        await runCleanupClientOperation(
          session,
          cleanupDeadline,
          phase,
          () => session.supervisedClient.close(),
        );
      }
    } catch (error) {
      closeError = contextualError(
        `Failed to close a supervised PostgreSQL administrative client. phase=${phase}`,
        error,
      );
    } finally {
      if (closeError !== null) {
        const abortPromise = session.supervisedClient.abort();
        abortPromise.catch((error) => {
          administrativeErrors.push(contextualError(
            `Failed to force-close a supervised PostgreSQL administrative client. phase=${phase}`,
            error,
          ));
        });
      }
      session.supervisedClient.detach();
      session.closed = true;
      session.connected = false;
      session.lockHeld = false;
    }
    if (closeError !== null) throw closeError;
  };

  const isSessionHealthy = (session) => (
    session !== null
    && !session.closed
    && session.connected
    && session.lockHeld
    && session.supervisedClient.backgroundFailure() === null
  );

  const startTerminalInterruption = (cleanupDeadline, failure) => {
    if (fatalBackgroundFailure === null) {
      fatalBackgroundFailure = failure;
    }
    mutableWorkSupervisor.stopAll(failure);
    const session = activeSession;
    if (
      terminalInterruptionPromise !== null
      || session === null
      || session.closed
      || !session.connectAttempted
    ) {
      return;
    }
    session.connected = false;
    session.lockHeld = false;
    terminalInterruptionPromise = terminateTimedOutOperation(
      session,
      cleanupDeadline,
      "signal-driven lifecycle administrative interruption",
    ).catch((error) => {
      administrativeErrors.push(contextualError(
        "Failed to terminate and await the lifecycle administrative backend after a signal.",
        error,
      ));
    });
  };

  const awaitTerminalInterruption = async () => {
    if (terminalInterruptionPromise === null) return;
    await terminalInterruptionPromise;
  };

  const requireClientForWork = (phase) => {
    if (fatalBackgroundFailure !== null) {
      throw contextualError(
        `Refusing to continue mutable PostgreSQL integration work after losing the lifecycle-lock session. phase=${phase}`,
        fatalBackgroundFailure,
      );
    }
    if (!isSessionHealthy(activeSession)) {
      throw new Error(
        `PostgreSQL integration lifecycle-lock session is not healthy. phase=${phase}`,
      );
    }
    return activeSession.supervisedClient.client;
  };

  return Object.freeze({
    async connectAndAcquire() {
      if (activeSession !== null) {
        throw new Error(
          "PostgreSQL integration lifecycle administrative session is already initialized.",
        );
      }
      const session = createSession(
        "lifecycle lock session",
        postgresConnectionTimeoutMilliseconds,
      );
      await mutableWorkSupervisor.awaitOperation(
        connectSession(session),
        "lifecycle lock connection establishment",
      );
      await mutableWorkSupervisor.awaitOperation(
        requirePostgresSessionContract(
          session.supervisedClient.client,
          adminConnection.database,
          "lifecycle lock session contract verification",
        ),
        "lifecycle lock session contract verification",
      );
      await mutableWorkSupervisor.awaitOperation(
        acquireLifecycleLock(session.supervisedClient.client),
        "lifecycle lock acquisition",
      );
      session.lockHeld = true;
    },
    errors() {
      return [
        ...administrativeErrors,
        ...mutableWorkSupervisor.errors(),
      ];
    },
    async finalize(cleanupDeadline) {
      await awaitTerminalInterruption();
      try {
        await mutableWorkSupervisor.waitForStopped(cleanupDeadline);
      } catch (error) {
        administrativeErrors.push(contextualError(
          "Failed to await mutable PostgreSQL integration work during lifecycle finalization.",
          error,
        ));
      }
      const session = activeSession;
      if (session === null) return;
      if (isSessionHealthy(session)) {
        try {
          await releaseLifecycleLock(session, cleanupDeadline);
          session.lockHeld = false;
        } catch (error) {
          administrativeErrors.push(contextualError(
            "Failed to release the PostgreSQL integration lifecycle lock.",
            error,
          ));
        }
      }
      try {
        await closeSessionForCleanup(
          session,
          cleanupDeadline,
          "lifecycle finalization",
        );
      } catch (error) {
        administrativeErrors.push(error);
      }
    },
    async getClientForCleanup(databaseOwnership, cleanupDeadline) {
      await awaitTerminalInterruption();
      await mutableWorkSupervisor.waitForStopped(cleanupDeadline);
      if (isSessionHealthy(activeSession)) {
        try {
          await assertLifecycleLockHeld(
            activeSession,
            cleanupDeadline,
          );
          return activeSession;
        } catch (error) {
          recordBackgroundFailure(
            activeSession,
            contextualError(
              "Failed to verify the PostgreSQL integration lifecycle lock before cleanup.",
              error,
            ),
          );
        }
      }
      if (activeSession !== null) {
        await closeSessionForCleanup(
          activeSession,
          cleanupDeadline,
          "before lifecycle cleanup recovery",
        );
      }
      const remainingMilliseconds = cleanupRemainingMilliseconds(
        cleanupDeadline,
        "lifecycle cleanup recovery connection creation",
      );
      if (remainingMilliseconds <= cleanupClientTeardownReserveMilliseconds) {
        throw cleanupOperationTimeoutError(
          cleanupDeadline,
          "lifecycle cleanup recovery connection creation",
        );
      }
      const recoverySession = createSession(
        "lifecycle cleanup recovery session",
        remainingMilliseconds - cleanupClientTeardownReserveMilliseconds,
      );
      try {
        await runCleanupClientOperation(
          recoverySession,
          cleanupDeadline,
          "lifecycle cleanup recovery connection establishment",
          () => connectSession(recoverySession),
        );
        await requireCleanupSessionContract(
          recoverySession,
          cleanupDeadline,
          adminConnection.database,
          "lifecycle cleanup recovery session contract verification",
        );
        if (databaseOwnership !== null) {
          const databaseIdentity = await inspectDatabaseIdentityForCleanup(
            recoverySession,
            cleanupDeadline,
            databaseOwnership.databaseOid,
            "pre-lock recovery database identity classification",
          );
          if (databaseIdentity.oidMatch !== null) {
            await terminateDatabaseSessionsByOid(
              recoverySession,
              cleanupDeadline,
              databaseOwnership.databaseOid,
              `before lifecycle-lock cleanup recovery ownershipState=${databaseOwnership.ownershipState} classification=${databaseIdentity.classification}`,
            );
          }
        }
        await reacquireLifecycleLockForCleanup(
          recoverySession,
          cleanupDeadline,
        );
        recoverySession.lockHeld = true;
        return recoverySession;
      } catch (error) {
        const recoveryError = contextualError(
          "Failed to establish an advisory-locked PostgreSQL administrative session for safe cleanup.",
          error,
        );
        administrativeErrors.push(recoveryError);
        let closeError = null;
        try {
          await closeSessionForCleanup(
            recoverySession,
            cleanupDeadline,
            "failed lifecycle cleanup recovery",
          );
        } catch (error) {
          closeError = error;
          administrativeErrors.push(error);
        }
        throw combineErrors(
          [
            recoveryError,
            ...(closeError === null ? [] : [closeError]),
          ],
          "PostgreSQL lifecycle cleanup recovery and client teardown failed.",
        );
      }
    },
    async runWork(phase, callback) {
      const client = requireClientForWork(phase);
      return mutableWorkSupervisor.awaitOperation(
        callback(client),
        phase,
      );
    },
    isCleanupClientHealthy() {
      return isSessionHealthy(activeSession);
    },
    startTerminalInterruption(cleanupDeadline, failure) {
      startTerminalInterruption(cleanupDeadline, failure);
    },
  });
}

async function listMigrationFiles(boundaryFileName, expectedMigrationCount) {
  const migrationFiles = (await readdir(migrationsDirectory))
    .filter((fileName) => fileName.endsWith(".sql"))
    .sort();
  const boundaryIndex = migrationFiles.indexOf(boundaryFileName);
  if (boundaryIndex < 0) {
    throw new Error(
      `PostgreSQL integration migration boundary is missing. boundary=${boundaryFileName}`,
    );
  }
  const boundaryFiles = migrationFiles.slice(0, boundaryIndex + 1);
  if (boundaryFiles.length !== expectedMigrationCount) {
    throw new Error(
      `PostgreSQL integration migration file boundary is invalid. boundary=${boundaryFileName} expectedCount=${expectedMigrationCount} actualCount=${boundaryFiles.length}`,
    );
  }
  return boundaryFiles;
}

async function inspectManagedClusterState(adminClient) {
  const result = await adminClient.query(
    `SELECT
       EXISTS (
         SELECT 1 FROM pg_catalog.pg_database WHERE datname = $1
       ) AS database_exists,
       COALESCE(
         array_agg(roles.rolname::text ORDER BY roles.rolname)
           FILTER (WHERE roles.rolname IS NOT NULL),
         ARRAY[]::text[]
       ) AS existing_roles
     FROM (SELECT 1) AS singleton
     LEFT JOIN pg_catalog.pg_roles AS roles
       ON roles.rolname = ANY($2::text[])`,
    [disposableDatabaseName, managedRoleNames],
  );
  const state = result.rows[0];
  if (state === undefined) {
    throw new Error(
      "PostgreSQL integration could not inspect disposable database and managed role state.",
    );
  }
  return state;
}

async function assertManagedClusterStateAbsent(adminClient, phase) {
  const state = await inspectManagedClusterState(adminClient);
  if (state.database_exists === true || state.existing_roles.length > 0) {
    throw new Error(
      `Refusing to mutate a non-isolated PostgreSQL cluster. phase=${phase} database=${disposableDatabaseName} databaseExists=${state.database_exists} existingManagedRoles=${JSON.stringify(state.existing_roles)}`,
    );
  }
}

async function preflightAdministrativeCluster(
  adminClient,
  adminConnection,
  signalSupervisor,
) {
  const capabilities = await adminClient.query(`
    SELECT
      current_setting('server_version_num')::int / 10000 AS major,
      current_database() AS database_name,
      current_user AS role_name,
      roles.rolsuper
    FROM pg_catalog.pg_roles AS roles
    WHERE roles.rolname = current_user
  `);
  const capability = capabilities.rows[0];
  if (capability === undefined) {
    throw new Error(
      "PostgreSQL integration could not inspect the administrative role capabilities.",
    );
  }
  if (capability.major !== 18) {
    throw new Error(
      `PostgreSQL integration gate requires PostgreSQL 18. actualMajor=${capability.major}`,
    );
  }
  if (capability.database_name === disposableDatabaseName) {
    throw new Error(
      `PostgreSQL integration administrative connection targets the disposable database. database=${capability.database_name}`,
    );
  }
  if (capability.rolsuper !== true) {
    throw new Error(
      `PostgreSQL integration administrative role must be a superuser for deterministic isolated-cluster cleanup. role=${capability.role_name} requiredAttribute=SUPERUSER`,
    );
  }
  if (capability.database_name !== adminConnection.database) {
    throw new Error(
      `POSTGRES_INTEGRATION_ADMIN_URL resolved to an unexpected database. configuredDatabase=${adminConnection.database} actualDatabase=${capability.database_name}`,
    );
  }

  await assertManagedClusterStateAbsent(
    adminClient,
    "administrative preflight",
  );
  signalSupervisor.throwIfSignaled("administrative preflight");
  return new Set(managedRoleNames);
}

async function assertHistoricalSeedBoundary(client) {
  const result = await client.query(`
    SELECT
      (SELECT count(*)::int FROM org.user_settings) AS users,
      (SELECT count(*)::int FROM org.user_settings WHERE user_id = 'local') AS local_users,
      (SELECT count(*)::int FROM org.workspaces) AS workspaces,
      (SELECT count(*)::int FROM org.workspace_memberships) AS memberships,
      (SELECT count(*)::int FROM sync.devices) AS devices
  `);
  const state = result.rows[0];
  if (
    state?.users !== 1
    || state.local_users !== 1
    || state.workspaces !== 0
    || state.memberships !== 0
    || state.devices !== 0
  ) {
    throw new Error(
      `Historical migration 0018 test boundary has unexpected scratch data. state=${JSON.stringify(state)}`,
    );
  }
  await client.query(
    "DELETE FROM org.user_settings WHERE user_id = 'local'",
  );
}

async function seedMigration0099LegacyInvalidMediaAsset(client) {
  const userId = "migration-0099-legacy-invalid-media-asset";
  const workspaceId = "09900000-0000-4000-8000-000000000001";
  const replicaId = "09900000-0000-4000-8000-000000000002";
  const mediaBlobId = "09900000-0000-4000-8000-000000000003";
  const mediaAssetId = "09900000-0000-4000-8000-000000000004";
  const sha256 = "9".repeat(64);
  const timestamp = "2026-07-29T00:00:00.000Z";

  await client.query(
    "INSERT INTO org.user_settings (user_id) VALUES ($1)",
    [userId],
  );
  await client.query(
    `INSERT INTO org.workspaces (
       workspace_id, name, fsrs_client_updated_at,
       fsrs_last_modified_by_replica_id, fsrs_last_operation_id
     ) VALUES ($1, $2, $3, $4, $5)`,
    [
      workspaceId,
      "Migration 0099 legacy media asset",
      timestamp,
      replicaId,
      "migration-0099-legacy-workspace",
    ],
  );
  await client.query(
    `INSERT INTO org.workspace_memberships (
       workspace_id, user_id, role
     ) VALUES ($1, $2, 'owner')`,
    [workspaceId, userId],
  );
  await client.query(
    `INSERT INTO sync.workspace_replicas (
       replica_id, workspace_id, user_id, actor_kind, installation_id,
       actor_key, platform, app_version
     ) VALUES ($1, $2, $3, 'ai_chat', NULL, $4, 'system', $5)`,
    [
      replicaId,
      workspaceId,
      userId,
      "migration-0099-legacy-replica",
      "postgres-integration",
    ],
  );
  await client.query(
    `INSERT INTO content.media_blobs (
       media_blob_id, sha256, mime_type, size_bytes, storage_key,
       normalization_version
     ) VALUES ($1, $2, 'image/png', 1, $3, 'passthrough-v1')`,
    [
      mediaBlobId,
      sha256,
      `media/blobs/sha256/${sha256.slice(0, 2)}/${sha256.slice(2, 4)}/${sha256}`,
    ],
  );
  await client.query(
    `INSERT INTO content.media_assets (
       media_asset_id, workspace_id, media_blob_id, source_url, created_at,
       client_updated_at, last_modified_by_replica_id, last_operation_id
     ) VALUES ($1, $2, $3, NULL, $4, $4, $5, $6)`,
    [
      mediaAssetId,
      workspaceId,
      mediaBlobId,
      timestamp,
      replicaId,
      "migration-0099-legacy-\u00a0operation",
    ],
  );

  const legacyActiveSessionId =
    "09940000-0000-4000-8000-000000000001";
  const legacyActiveMediaAssetId =
    "09940000-0000-4000-8000-000000000002";
  const legacyActiveSha256 = "d".repeat(64);
  await client.query(
    `INSERT INTO content.media_upload_sessions (
       media_upload_session_id, workspace_id, media_asset_id,
       media_blob_sha256, staging_storage_key, blob_storage_key,
       s3_upload_id, mime_type, size_bytes, part_size_bytes, part_count,
       state, source_url, asset_created_at, client_updated_at,
       last_modified_by_replica_id, last_operation_id, expires_at
     ) VALUES (
       $1, $2, $3, $4, $5, $6, 'migration-0099-legacy-active-upload',
       'application/octet-stream', 1, 1, 1, 'active', NULL, $7, $7, $8,
       'migration-0099-legacy-\u00a0active', '2099-07-29T00:00:00.000Z'
     )`,
    [
      legacyActiveSessionId,
      workspaceId,
      legacyActiveMediaAssetId,
      legacyActiveSha256,
      `media/uploads/workspaces/${workspaceId}/assets/${legacyActiveMediaAssetId}/sessions/${legacyActiveSessionId}`,
      `media/blobs/sha256/${legacyActiveSha256.slice(0, 2)}/${legacyActiveSha256.slice(2, 4)}/${legacyActiveSha256}`,
      timestamp,
      replicaId,
    ],
  );

  const legacyAttemptFixtures = [
    {
      kind: "replay",
      sessionId: "09910000-0000-4000-8000-000000000001",
      mediaAssetId: "09910000-0000-4000-8000-000000000002",
      attemptToken: "09910000-0000-4000-8000-000000000003",
      sha256: "a".repeat(64),
      lastOperationId: "migration-0099-legacy-\u00a0replay",
      partsFingerprint: "1".repeat(64),
    },
    {
      kind: "cleanup",
      sessionId: "09920000-0000-4000-8000-000000000001",
      mediaAssetId: "09920000-0000-4000-8000-000000000002",
      attemptToken: "09920000-0000-4000-8000-000000000003",
      sha256: "b".repeat(64),
      lastOperationId: "migration-0099-legacy-\u00a0cleanup",
      partsFingerprint: "2".repeat(64),
    },
    {
      kind: "handoff",
      sessionId: "09930000-0000-4000-8000-000000000001",
      mediaAssetId: "09930000-0000-4000-8000-000000000002",
      attemptToken: "09930000-0000-4000-8000-000000000003",
      sha256: "c".repeat(64),
      lastOperationId: "migration-0099-legacy-\u00a0handoff",
      partsFingerprint: "3".repeat(64),
    },
  ];
  const sessionExpiresAt = "2099-07-29T00:00:00.000Z";
  await client.query(
    "SELECT set_config('app.user_id',$1,true),set_config('app.workspace_id',$2,true)",
    [userId, workspaceId],
  );
  for (const fixture of legacyAttemptFixtures) {
    const stagingStorageKey =
      `media/uploads/workspaces/${workspaceId}/assets/${fixture.mediaAssetId}/sessions/${fixture.sessionId}`;
    const blobStorageKey =
      `media/blobs/sha256/${fixture.sha256.slice(0, 2)}/${fixture.sha256.slice(2, 4)}/${fixture.sha256}`;
    const uploadId = `migration-0099-${fixture.kind}-upload`;
    await client.query(
      `INSERT INTO content.media_upload_sessions (
         media_upload_session_id, workspace_id, media_asset_id,
         media_blob_sha256, staging_storage_key, blob_storage_key,
         s3_upload_id, mime_type, size_bytes, part_size_bytes, part_count,
         state, source_url, asset_created_at, client_updated_at,
         last_modified_by_replica_id, last_operation_id, expires_at
       ) VALUES (
         $1, $2, $3, $4, $5, $6, $7, 'application/octet-stream',
         1, 1, 1, 'completing', NULL, $8, $8, $9, $10, $11
       )`,
      [
        fixture.sessionId,
        workspaceId,
        fixture.mediaAssetId,
        fixture.sha256,
        stagingStorageKey,
        blobStorageKey,
        uploadId,
        timestamp,
        replicaId,
        fixture.lastOperationId,
        sessionExpiresAt,
      ],
    );
    const begun = await client.query(
      `SELECT attempt_status, reservation_token
       FROM content.begin_media_upload_session_completion_attempt_with_owner(
         $1,
         3600000,
         ROW(
           $2,$3,$4,$5,$6,$7,$8,$9,$10,$11,
           'application/octet-stream',1,1,1,NULL,$12,$12,$13,
           'passthrough-v1',$14
         )::content.multipart_media_blob_writer_attempt_payload
       )`,
      [
        fixture.attemptToken,
        userId,
        workspaceId,
        fixture.sessionId,
        fixture.mediaAssetId,
        replicaId,
        fixture.lastOperationId,
        fixture.sha256,
        stagingStorageKey,
        blobStorageKey,
        uploadId,
        timestamp,
        sessionExpiresAt,
        fixture.partsFingerprint,
      ],
    );
    if (
      begun.rows[0]?.attempt_status !== "acquired"
      || typeof begun.rows[0]?.reservation_token !== "string"
    ) {
      throw new Error(
        `Migration 0099 legacy multipart attempt seed failed. kind=${fixture.kind} result=${JSON.stringify(begun.rows[0])}`,
      );
    }
  }
  await client.query(
    `UPDATE content.media_blob_writer_attempts
     SET state='cancelled', outcome='aborted', terminal_at=$2
     WHERE attempt_token=$1`,
    [legacyAttemptFixtures[0].attemptToken, timestamp],
  );
  await client.query(
    `UPDATE content.media_upload_sessions
     SET state='aborted', aborted_at=$2
     WHERE media_upload_session_id=$1`,
    [legacyAttemptFixtures[0].sessionId, timestamp],
  );
  await client.query(
    `UPDATE content.media_upload_sessions
     SET state='aborting'
     WHERE media_upload_session_id=$1`,
    [legacyAttemptFixtures[1].sessionId],
  );
}

async function seedMigration0103LegacyChatRun(client) {
  const userId = "migration-0103-legacy-chat-user";
  const workspaceId = "10300000-0000-4000-8000-000000000001";
  const replicaId = "10300000-0000-4000-8000-000000000002";
  const sessionId = "10300000-0000-4000-8000-000000000003";
  const assistantItemId = "10300000-0000-4000-8000-000000000004";
  const runId = "10300000-0000-4000-8000-000000000005";
  const timestamp = "2026-07-30T00:00:00.000Z";

  await client.query(
    "INSERT INTO org.user_settings (user_id) VALUES ($1)",
    [userId],
  );
  await client.query(
    `INSERT INTO org.workspaces (
       workspace_id, name, fsrs_client_updated_at,
       fsrs_last_modified_by_replica_id, fsrs_last_operation_id
     ) VALUES ($1, $2, $3, $4, $5)`,
    [
      workspaceId,
      "Migration 0103 legacy chat run",
      timestamp,
      replicaId,
      "migration-0103-legacy-workspace",
    ],
  );
  await client.query(
    `INSERT INTO org.workspace_memberships (
       workspace_id, user_id, role
     ) VALUES ($1, $2, 'owner')`,
    [workspaceId, userId],
  );
  await client.query(
    `INSERT INTO sync.workspace_replicas (
       replica_id, workspace_id, user_id, actor_kind, installation_id,
       actor_key, platform, app_version
     ) VALUES ($1, $2, $3, 'ai_chat', NULL, $4, 'system', $5)`,
    [
      replicaId,
      workspaceId,
      userId,
      "migration-0103-legacy-replica",
      "postgres-integration",
    ],
  );
  await client.query(
    `INSERT INTO ai.chat_sessions (
       session_id, user_id, workspace_id, status, active_run_id
     ) VALUES ($1, $2, $3, 'running', $4)`,
    [sessionId, userId, workspaceId, runId],
  );
  await client.query(
    `INSERT INTO ai.chat_items (
       item_id, session_id, item_kind, state, payload
     ) VALUES (
       $1, $2, 'message', 'in_progress',
       '{"role":"assistant","content":[]}'::jsonb
     )`,
    [assistantItemId, sessionId],
  );
  await client.query(
    `INSERT INTO ai.chat_runs (
       run_id, session_id, assistant_item_id, status, request_id, model_id,
       reasoning_effort, timezone, turn_input
     ) VALUES (
       $1, $2, $3, 'queued', $4, 'gpt-5.4', 'medium', 'Europe/Madrid',
       '[]'::jsonb
     )`,
    [
      runId,
      sessionId,
      assistantItemId,
      "migration-0103-legacy-request",
    ],
  );
}

async function createExpectedMigrationRoles(
  client,
  fileName,
  boundaryState,
) {
  const expectedCreatedRoles = createdRolesByMigration.get(fileName) ?? [];
  for (const roleName of expectedCreatedRoles) {
    if (!boundaryState.initiallyAbsentRoleNames.has(roleName)) {
      throw new Error(
        `Refusing to create a PostgreSQL role that was not absent during the locked preflight. role=${roleName} migration=${fileName}`,
      );
    }
    if (boundaryState.ownedRoleOids.has(roleName)) {
      throw new Error(
        `PostgreSQL integration role is already marked as runner-owned before its creation migration. role=${roleName} migration=${fileName}`,
      );
    }
    await client.query(
      `CREATE ROLE ${escapeIdentifier(roleName)} LOGIN`,
    );
    const result = await client.query(
      "SELECT oid::text AS role_oid FROM pg_catalog.pg_roles WHERE rolname = $1",
      [roleName],
    );
    const roleOid = result.rows[0]?.role_oid;
    if (roleOid === undefined) {
      throw new Error(
        `PostgreSQL integration could not prove ownership of a role it created. role=${roleName} migration=${fileName}`,
      );
    }
    boundaryState.ownedRoleOids.set(roleName, roleOid);
  }
}

async function trackMigrationRoleOwnership(client, fileName, boundaryState) {
  const result = await client.query(
    `SELECT rolname, oid::text AS role_oid
     FROM pg_catalog.pg_roles
     WHERE rolname = ANY($1::text[])
     ORDER BY rolname`,
    [managedRoleNames],
  );
  const currentRoles = new Map(
    result.rows.map((row) => [row.rolname, row.role_oid]),
  );
  for (const [roleName, ownedRoleOid] of boundaryState.ownedRoleOids) {
    const currentRoleOid = currentRoles.get(roleName);
    if (currentRoleOid !== undefined && currentRoleOid !== ownedRoleOid) {
      throw new Error(
        `Managed PostgreSQL role identity changed during the integration run. role=${roleName} expectedOid=${ownedRoleOid} actualOid=${currentRoleOid}`,
      );
    }
  }

  const expectedCreatedRoles = new Set(createdRolesByMigration.get(fileName) ?? []);
  for (const roleName of currentRoles.keys()) {
    if (boundaryState.ownedRoleOids.has(roleName)) continue;
    throw new Error(
      `An unowned managed PostgreSQL role appeared during migrations. role=${roleName} migration=${fileName}`,
    );
  }
  for (const roleName of expectedCreatedRoles) {
    if (!boundaryState.ownedRoleOids.has(roleName)) {
      throw new Error(
        `Migration did not create its expected managed PostgreSQL role. role=${roleName} migration=${fileName}`,
      );
    }
  }
}

async function applySingleMigration(
  adminConnection,
  fileName,
  boundaryState,
  signalSupervisor,
  mutableWorkSupervisor,
) {
  const phase = `migration ${fileName}`;
  const clientOptions = createPostgresClientOptions(
    adminConnection,
    disposableDatabaseName,
    adminConnection.username,
    adminConnection.password,
    `postgres-integration-${fileName.slice(0, 4)}`,
  );
  const supervisedClient = createSupervisedPostgresClient(
    clientOptions,
    phase,
    null,
  );
  const { client } = supervisedClient;
  const mutableWork = mutableWorkSupervisor.register(
    phase,
    () => supervisedClient.abort(),
  );
  let transactionStarted = false;
  let primaryError = null;
  const finalizationErrors = [];
  try {
    mutableWork.assertCanStart();
    await mutableWork.awaitOperation(
      client.connect(),
      `${phase} connection establishment`,
    );
    mutableWork.assertCanStart();
    await mutableWork.awaitOperation(
      requirePostgresSessionContract(
        client,
        disposableDatabaseName,
        `${phase} session contract verification`,
      ),
      `${phase} session contract verification`,
    );
    await mutableWork.awaitOperation(
      requireConnectedDatabaseIdentityForWork(
        client,
        boundaryState,
        `${phase} connected database identity verification`,
      ),
      `${phase} connected database identity verification`,
    );
    mutableWork.assertCanStart();
    signalSupervisor.throwIfSignaled(`before migration ${fileName}`);
    await mutableWork.awaitOperation(
      (async () => {
        const sql = await readFile(
          join(migrationsDirectory, fileName),
          "utf8",
        );
        if (
          fileName
          === "0099_durable_multipart_completion_reconciliation.sql"
        ) {
          await client.query("BEGIN");
          transactionStarted = true;
          await seedMigration0099LegacyInvalidMediaAsset(client);
          await client.query("COMMIT");
          transactionStarted = false;
        }
        if (
          fileName
          === "0103_ai_chat_initiating_auth_classification.sql"
        ) {
          await client.query("BEGIN");
          transactionStarted = true;
          await seedMigration0103LegacyChatRun(client);
          await client.query("COMMIT");
          transactionStarted = false;
        }
        await client.query("BEGIN");
        transactionStarted = true;
        if (
          fileName
          === "0018_auto_provision_workspaces_and_scheduler_seed.sql"
        ) {
          // The historical 0001 scratch seed has no device. Migration 0018
          // inserts its workspace before its device and cannot satisfy that old
          // fixture's FK. Production data never used this scratch seed.
          await assertHistoricalSeedBoundary(client);
        }
        // Every migration gets its own production-like session and transaction.
        // This preserves migration 0035's ON COMMIT DROP temporary tables.
        await createExpectedMigrationRoles(
          client,
          fileName,
          boundaryState,
        );
        await client.query(sql);
        await trackMigrationRoleOwnership(client, fileName, boundaryState);
        signalSupervisor.throwIfSignaled(`migration ${fileName}`);
        await client.query(
          "INSERT INTO public.schema_migrations(filename) VALUES ($1)",
          [fileName],
        );
        await client.query("COMMIT");
        transactionStarted = false;
      })(),
      `${phase} transaction`,
    );
  } catch (error) {
    primaryError = contextualError(
      `PostgreSQL migration integration setup failed. file=${fileName}`,
      error,
    );
  }

  if (transactionStarted) {
    try {
      await mutableWork.awaitOperation(
        client.query("ROLLBACK"),
        `${phase} rollback`,
      );
    } catch (error) {
      finalizationErrors.push(contextualError(
        `PostgreSQL migration rollback failed. file=${fileName}`,
        error,
      ));
    }
  }
  try {
    await mutableWork.awaitOperation(
      supervisedClient.close(),
      `${phase} client close`,
    );
  } catch (error) {
    finalizationErrors.push(contextualError(
      `PostgreSQL migration client close failed. file=${fileName}`,
      error,
    ));
  }
  const backgroundFailure = supervisedClient.backgroundFailure();
  supervisedClient.detach();
  mutableWork.complete();

  const failure = combineErrors(
    [
      ...(primaryError === null ? [] : [primaryError]),
      ...(backgroundFailure === null ? [] : [backgroundFailure]),
      ...finalizationErrors,
    ],
    `PostgreSQL migration and session finalization failed. file=${fileName}`,
  );
  if (failure !== null) throw failure;
}

async function assertOwnedRole(client, roleName, boundaryState) {
  const expectedRoleOid = boundaryState.ownedRoleOids.get(roleName);
  if (expectedRoleOid === undefined) {
    throw new Error(
      `Refusing to configure an unowned PostgreSQL role. role=${roleName}`,
    );
  }
  const result = await client.query(
    "SELECT oid::text AS role_oid FROM pg_catalog.pg_roles WHERE rolname = $1",
    [roleName],
  );
  const actualRoleOid = result.rows[0]?.role_oid;
  if (actualRoleOid !== expectedRoleOid) {
    throw new Error(
      `Refusing to configure a PostgreSQL role with an unverified identity. role=${roleName} expectedOid=${expectedRoleOid} actualOid=${actualRoleOid ?? "missing"}`,
    );
  }
}

async function applyMigrationBoundary(
  adminConnection,
  migrationFiles,
  boundaryDefinition,
  boundaryState,
  lifecycleAdminSession,
  signalSupervisor,
  mutableWorkSupervisor,
) {
  const requireLifecycleDatabaseIdentity = (phase) => (
    lifecycleAdminSession.runWork(
      phase,
      (adminClient) => requireOwnedDatabaseIdentityForWork(
        adminClient,
        boundaryState,
        phase,
      ),
    )
  );
  await requireLifecycleDatabaseIdentity(
    `before schema_migrations setup for ${boundaryDefinition.migrationFileName}`,
  );
  await withPostgresClient(
    createPostgresClientOptions(
      adminConnection,
      disposableDatabaseName,
      adminConnection.username,
      adminConnection.password,
      "postgres-integration-migration-runner",
    ),
    `schema_migrations setup for ${boundaryDefinition.migrationFileName}`,
    async (setupClient) => {
      await requireConnectedDatabaseIdentityForWork(
        setupClient,
        boundaryState,
        `schema_migrations setup for ${boundaryDefinition.migrationFileName}`,
      );
      const server = await setupClient.query(
        "SELECT current_setting('server_version_num')::int / 10000 AS major",
      );
      if (server.rows[0]?.major !== 18) {
        throw new Error(
          `PostgreSQL integration disposable database requires PostgreSQL 18. actualMajor=${server.rows[0]?.major}`,
        );
      }
      await setupClient.query(`
        CREATE TABLE public.schema_migrations (
          filename TEXT PRIMARY KEY,
          applied_at TIMESTAMPTZ NOT NULL DEFAULT now()
        )
      `);
    },
    mutableWorkSupervisor,
  );
  await requireLifecycleDatabaseIdentity(
    `after schema_migrations setup for ${boundaryDefinition.migrationFileName}`,
  );

  for (const fileName of migrationFiles) {
    await requireLifecycleDatabaseIdentity(
      `before migration ${fileName}`,
    );
    await applySingleMigration(
      adminConnection,
      fileName,
      boundaryState,
      signalSupervisor,
      mutableWorkSupervisor,
    );
    await requireLifecycleDatabaseIdentity(
      `after migration ${fileName}`,
    );
  }

  await requireLifecycleDatabaseIdentity(
    `before boundary verification for ${boundaryDefinition.migrationFileName}`,
  );
  await withPostgresClient(
    createPostgresClientOptions(
      adminConnection,
      disposableDatabaseName,
      adminConnection.username,
      adminConnection.password,
      "postgres-integration-boundary-verifier",
    ),
    `boundary verification for ${boundaryDefinition.migrationFileName}`,
    async (verificationClient) => {
      await requireConnectedDatabaseIdentityForWork(
        verificationClient,
        boundaryState,
        `boundary verification for ${boundaryDefinition.migrationFileName}`,
      );
      const state = await verificationClient.query(
        "SELECT count(*)::int AS migrations, max(filename) AS latest FROM public.schema_migrations",
      );
      if (
        state.rows[0]?.migrations !== boundaryDefinition.expectedMigrationCount
        || state.rows[0]?.latest !== boundaryDefinition.migrationFileName
      ) {
        throw new Error(
          `PostgreSQL integration schema_migrations boundary is invalid. expectedCount=${boundaryDefinition.expectedMigrationCount} expectedLatest=${boundaryDefinition.migrationFileName} actual=${JSON.stringify(state.rows[0])}`,
        );
      }
      await assertOwnedRole(
        verificationClient,
        "backend_app",
        boundaryState,
      );
      signalSupervisor.throwIfSignaled(
        `before backend_app configuration at ${boundaryDefinition.migrationFileName}`,
      );
      await verificationClient.query(
        `ALTER ROLE ${escapeIdentifier("backend_app")} WITH LOGIN PASSWORD ${escapeLiteral(backendRolePassword)}`,
      );
    },
    mutableWorkSupervisor,
  );
  await requireLifecycleDatabaseIdentity(
    `after boundary verification for ${boundaryDefinition.migrationFileName}`,
  );
}

async function runSupervisedNodeChild(
  childArguments,
  childEnvironment,
  phase,
  signalSupervisor,
  mutableWorkSupervisor,
) {
  signalSupervisor.throwIfSignaled(`before ${phase}`);
  mutableWorkSupervisor.assertCanStart(`before ${phase}`);
  let child = null;
  const mutableWork = mutableWorkSupervisor.register(
    phase,
    () => {
      if (
        child !== null
        && child.exitCode === null
        && child.signalCode === null
      ) {
        child.kill(signalSupervisor.firstSignal() ?? "SIGTERM");
      }
    },
  );
  try {
    mutableWork.assertCanStart();
    const childOperation = new Promise((resolveRun, rejectRun) => {
      child = spawn(
        process.execPath,
        childArguments,
        {
          cwd: backendRoot,
          env: childEnvironment,
          stdio: "inherit",
          shell: false,
        },
      );
      signalSupervisor.setActiveChild(child);
      let settled = false;
      const settle = (callback) => {
        if (settled) return;
        settled = true;
        signalSupervisor.clearActiveChild(child);
        callback();
      };
      child.once("error", (error) => {
        settle(() => rejectRun(contextualError(
          `Failed to start a PostgreSQL integration child process. phase=${phase}`,
          error,
        )));
      });
      child.once("exit", (code, signal) => {
        settle(() => {
          if (signal !== null) {
            rejectRun(
              new Error(
                `PostgreSQL integration child terminated by signal. phase=${phase} signal=${signal}`,
              ),
            );
            return;
          }
          if (code !== 0) {
            rejectRun(
              new Error(
                `PostgreSQL integration child failed. phase=${phase} exitCode=${code}`,
              ),
            );
            return;
          }
          resolveRun();
        });
      });
    });
    await mutableWork.awaitOperation(childOperation, phase);
  } finally {
    mutableWork.complete();
  }
}

const childDatabasePreflightSource = `
import PgClient from "pg/lib/client.js";

const expectedDatabaseOid =
  process.env.POSTGRES_INTEGRATION_EXPECTED_DATABASE_OID;
const targets = [
  {
    environmentVariableName: "DATABASE_URL",
    expectedUsername: "backend_app",
  },
  {
    environmentVariableName: "TEST_DATABASE_ADMIN_URL",
    expectedUsername: decodeURIComponent(
      new URL(process.env.TEST_DATABASE_ADMIN_URL).username,
    ),
  },
];

for (const target of targets) {
  const connectionString = process.env[target.environmentVariableName];
  const client = new PgClient({
    application_name: "postgres-integration-child-preflight",
    connectionString,
  });
  let backgroundFailure = null;
  client.on("error", (error) => {
    if (backgroundFailure === null) backgroundFailure = error;
  });
  try {
    await client.connect();
    const result = await client.query(\`
      SELECT
        current_database() AS database_name,
        current_user AS username,
        database.oid::text AS database_oid,
        current_setting('client_encoding') AS client_encoding,
        current_setting('standard_conforming_strings')
          AS standard_conforming_strings
      FROM pg_catalog.pg_database AS database
      WHERE database.datname = current_database()
    \`);
    const state = result.rows[0];
    if (
      state?.database_name !== "flashcards"
      || state.username !== target.expectedUsername
      || state.database_oid !== expectedDatabaseOid
      || state.client_encoding !== "UTF8"
      || state.standard_conforming_strings !== "on"
    ) {
      throw new Error(
        "PostgreSQL child connection contract is invalid. "
        + "environmentVariable=" + target.environmentVariableName
        + " expectedDatabase=flashcards"
        + " expectedDatabaseOid=" + expectedDatabaseOid
        + " expectedUsername=" + target.expectedUsername
        + " actualState=" + JSON.stringify(state),
      );
    }
  } finally {
    await client.end();
  }
  if (backgroundFailure !== null) throw backgroundFailure;
}
`;

function createTestConnectionGuardImport() {
  const pgClientModuleUrl = pathToFileURL(
    join(backendRoot, "node_modules", "pg", "lib", "client.js"),
  ).href;
  const pgModuleUrl = pathToFileURL(
    join(backendRoot, "node_modules", "pg", "lib", "index.js"),
  ).href;
  const source = `
import PgClient from ${JSON.stringify(pgClientModuleUrl)};
import pg from ${JSON.stringify(pgModuleUrl)};

const expectedDatabaseName =
  process.env.POSTGRES_INTEGRATION_EXPECTED_DATABASE_NAME;
const expectedDatabaseOid =
  process.env.POSTGRES_INTEGRATION_EXPECTED_DATABASE_OID;
const expectedRuntimeUsername =
  process.env.POSTGRES_INTEGRATION_EXPECTED_RUNTIME_USERNAME;
const expectedOwnerUsername =
  process.env.POSTGRES_INTEGRATION_EXPECTED_OWNER_USERNAME;
const expectedClientEncoding =
  process.env.POSTGRES_INTEGRATION_EXPECTED_CLIENT_ENCODING;

if (
  expectedDatabaseName !== "flashcards"
  || !/^[0-9]+$/u.test(expectedDatabaseOid ?? "")
  || expectedRuntimeUsername !== "backend_app"
  || expectedOwnerUsername === undefined
  || expectedOwnerUsername === ""
  || expectedClientEncoding !== "UTF8"
) {
  throw new Error(
    "PostgreSQL integration test connection guard received an invalid runner-authored contract.",
  );
}
if (pg.Client !== PgClient) {
  throw new Error(
    "PostgreSQL integration test connection guard did not load the JavaScript Client class used by pg.",
  );
}

const originalConnect = PgClient.prototype.connect;
const originalQuery = PgClient.prototype.query;
const validationStates = new WeakMap();

function createValidationState(client) {
  const existingState = validationStates.get(client);
  if (existingState !== undefined) return existingState;
  let resolveValidation;
  let rejectValidation;
  const promise = new Promise((resolve, reject) => {
    resolveValidation = resolve;
    rejectValidation = reject;
  });
  promise.catch(() => {});
  const state = {
    error: null,
    promise,
    reject(error) {
      if (state.status !== "pending") return;
      state.error = error;
      state.status = "rejected";
      rejectValidation(error);
    },
    resolve() {
      if (state.status !== "pending") return;
      state.status = "fulfilled";
      resolveValidation();
    },
    status: "pending",
  };
  validationStates.set(client, state);
  return state;
}

function expectedUsernameForClient(client) {
  const configuredUsername = client.connectionParameters?.user;
  if (configuredUsername === expectedRuntimeUsername) {
    return expectedRuntimeUsername;
  }
  if (configuredUsername === expectedOwnerUsername) {
    return expectedOwnerUsername;
  }
  throw new Error(
    "PostgreSQL integration test connection uses an unexpected database username. "
    + "configuredUsername=" + (configuredUsername ?? "missing"),
  );
}

async function validateConnection(client) {
  let backgroundFailure = null;
  const recordBackgroundFailure = (error) => {
    if (backgroundFailure === null) backgroundFailure = error;
  };
  client.on("error", recordBackgroundFailure);
  try {
    const expectedUsername = expectedUsernameForClient(client);
    const result = await originalQuery.call(client, \`
      SELECT
        current_database() AS database_name,
        current_user AS username,
        database.oid::text AS database_oid,
        current_setting('client_encoding') AS client_encoding
      FROM pg_catalog.pg_database AS database
      WHERE database.datname = current_database()
    \`);
    if (backgroundFailure !== null) throw backgroundFailure;
    const state = result.rows[0];
    if (
      state?.database_name !== expectedDatabaseName
      || state.database_oid !== expectedDatabaseOid
      || state.username !== expectedUsername
      || state.client_encoding !== expectedClientEncoding
    ) {
      throw new Error(
        "PostgreSQL integration test connection contract is invalid. "
        + "expectedDatabase=" + expectedDatabaseName
        + " expectedDatabaseOid=" + expectedDatabaseOid
        + " expectedUsername=" + expectedUsername
        + " expectedClientEncoding=" + expectedClientEncoding
        + " actualDatabase=" + (state?.database_name ?? "missing")
        + " actualDatabaseOid=" + (state?.database_oid ?? "missing")
        + " actualUsername=" + (state?.username ?? "missing")
        + " actualClientEncoding=" + (state?.client_encoding ?? "missing"),
      );
    }
  } finally {
    client.off("error", recordBackgroundFailure);
  }
}

async function closeInvalidConnection(client, validationError) {
  try {
    await client.end();
  } catch (closeError) {
    throw new AggregateError(
      [validationError, closeError],
      "PostgreSQL integration test connection validation and close failed.",
    );
  }
  throw validationError;
}

function startConnectionValidation(client, state) {
  const validation = validateConnection(client).catch(
    (validationError) => closeInvalidConnection(
      client,
      validationError,
    ),
  );
  validation.then(
    () => state.resolve(),
    (error) => state.reject(error),
  );
  return validation;
}

function queryCallbackFromArguments(queryArguments) {
  if (typeof queryArguments[2] === "function") {
    return queryArguments[2];
  }
  if (typeof queryArguments[1] === "function") {
    return queryArguments[1];
  }
  const config = queryArguments[0];
  if (
    config !== null
    && typeof config === "object"
    && typeof config.callback === "function"
  ) {
    return config.callback;
  }
  return null;
}

function deliverQueryValidationError(callback, error) {
  process.nextTick(() => callback(error));
}

PgClient.prototype.query = function guardedQuery(...queryArguments) {
  const state = createValidationState(this);
  if (state.status === "fulfilled") {
    return originalQuery.apply(this, queryArguments);
  }
  const callback = queryCallbackFromArguments(queryArguments);
  if (state.status === "rejected") {
    if (callback !== null) {
      deliverQueryValidationError(callback, state.error);
      return undefined;
    }
    return Promise.reject(state.error);
  }
  if (callback !== null) {
    state.promise.then(
      () => {
        try {
          originalQuery.apply(this, queryArguments);
        } catch (error) {
          deliverQueryValidationError(callback, error);
        }
      },
      (error) => deliverQueryValidationError(callback, error),
    );
    return undefined;
  }
  return state.promise.then(
    () => originalQuery.apply(this, queryArguments),
  );
};

PgClient.prototype.connect = function guardedConnect(callback) {
  const state = createValidationState(this);
  if (typeof callback === "function") {
    return originalConnect.call(this, (connectError, connectedClient) => {
      if (connectError !== null && connectError !== undefined) {
        state.reject(connectError);
        callback(connectError, connectedClient);
        return;
      }
      startConnectionValidation(this, state).then(
        () => callback(null, connectedClient ?? this),
        (error) => callback(error),
      );
    });
  }

  return originalConnect.call(this).then(
    async (connectedClient) => {
      await startConnectionValidation(this, state);
      return connectedClient;
    },
    (error) => {
      state.reject(error);
      throw error;
    },
  );
};
`;
  return `data:text/javascript,${encodeURIComponent(source)}`;
}

function createTestConnectionGuardVerificationImport() {
  const pgModuleUrl = pathToFileURL(
    join(backendRoot, "node_modules", "pg", "lib", "index.js"),
  ).href;
  const source = `
import pg from ${JSON.stringify(pgModuleUrl)};

const connectionString = process.env.DATABASE_URL;

async function verifyDirectPromiseConnection() {
  const client = new pg.Client({
    application_name: "postgres-integration-guard-direct-promise",
    connectionString,
  });
  const connectPromise = client.connect();
  const queryPromise = client.query({
    text: "SELECT $1::integer",
    values: [1],
  });
  try {
    await Promise.all([connectPromise, queryPromise]);
  } finally {
    await client.end();
  }
}

async function verifyDirectCallbackConnection() {
  const client = new pg.Client({
    application_name: "postgres-integration-guard-direct-callback",
    connectionString,
  });
  const connectPromise = new Promise((resolve, reject) => {
    client.connect((error) => {
      if (error) {
        reject(error);
        return;
      }
      resolve();
    });
  });
  const queryPromise = new Promise((resolve, reject) => {
    client.query("SELECT $1::integer", [1], (error, result) => {
      if (error) {
        reject(error);
        return;
      }
      resolve(result);
    });
  });
  try {
    await Promise.all([connectPromise, queryPromise]);
  } finally {
    await client.end();
  }
}

async function verifyPoolPromiseConnection() {
  const pool = new pg.Pool({
    application_name: "postgres-integration-guard-pool-promise",
    connectionString,
  });
  try {
    await pool.query({
      text: "SELECT $1::integer",
      values: [1],
    });
  } finally {
    await pool.end();
  }
}

async function verifyPoolCallbackConnection() {
  const pool = new pg.Pool({
    application_name: "postgres-integration-guard-pool-callback",
    connectionString,
  });
  try {
    await new Promise((resolve, reject) => {
      pool.query("SELECT $1::integer", [1], (error, result) => {
        if (error) {
          reject(error);
          return;
        }
        resolve(result);
      });
    });
  } finally {
    await pool.end();
  }
}

const verificationResults = await Promise.allSettled([
  verifyDirectPromiseConnection(),
  verifyDirectCallbackConnection(),
  verifyPoolPromiseConnection(),
  verifyPoolCallbackConnection(),
]);
const verificationErrors = verificationResults.flatMap((result) => (
  result.status === "rejected" ? [result.reason] : []
));
if (verificationErrors.length > 0) {
  throw new AggregateError(
    verificationErrors,
    "PostgreSQL integration test connection guard verification failed. "
      + "failures=" + verificationErrors.length,
  );
}
`;
  return `data:text/javascript,${encodeURIComponent(source)}`;
}

async function runNodeTests(
  testFiles,
  runtimeDatabaseUrl,
  ownerDatabaseUrl,
  expectedDatabaseOid,
  signalSupervisor,
  mutableWorkSupervisor,
) {
  const childEnvironment = createIntegrationChildEnvironment(
    process.env,
    runtimeDatabaseUrl,
    ownerDatabaseUrl,
    expectedDatabaseOid,
  );
  await runSupervisedNodeChild(
    [
      "--input-type=module",
      "--eval",
      childDatabasePreflightSource,
    ],
    childEnvironment,
    "PostgreSQL integration child connection preflight",
    signalSupervisor,
    mutableWorkSupervisor,
  );
  await runSupervisedNodeChild(
    [
      "--test",
      "--test-concurrency=1",
      "--test-isolation=none",
      "--import",
      createTestConnectionGuardImport(),
      "--import",
      createTestConnectionGuardVerificationImport(),
      "--import",
      "tsx",
      ...testFiles,
    ],
    childEnvironment,
    "PostgreSQL integration test child",
    signalSupervisor,
    mutableWorkSupervisor,
  );
}

async function selectUnusedDatabaseOid(adminClient) {
  for (
    let attempt = 1;
    attempt <= databaseOidSelectionMaximumAttempts;
    attempt += 1
  ) {
    const candidate = randomBytes(4).readUInt32BE(0);
    if (candidate < databaseOidMinimum) continue;
    const candidateOid = String(candidate);
    const result = await adminClient.query(
      `SELECT NOT EXISTS (
         SELECT 1
         FROM pg_catalog.pg_database
         WHERE oid = $1::oid
       ) AS available`,
      [candidateOid],
    );
    if (result.rows[0]?.available === true) return candidateOid;
  }
  throw new Error(
    `PostgreSQL integration could not select an unused database OID after bounded catalog checks. attempts=${databaseOidSelectionMaximumAttempts}`,
  );
}

async function createDisposableDatabase(adminClient, boundaryState) {
  if (
    boundaryState.pendingDatabaseOid !== null
    || boundaryState.ownedDatabaseOid !== null
  ) {
    throw new Error(
      `PostgreSQL integration database ownership state is not empty before creation. database=${disposableDatabaseName} pendingOid=${boundaryState.pendingDatabaseOid ?? "none"} ownedOid=${boundaryState.ownedDatabaseOid ?? "none"}`,
    );
  }
  const databaseOid = await selectUnusedDatabaseOid(adminClient);
  boundaryState.pendingDatabaseOid = databaseOid;
  await adminClient.query(
    `CREATE DATABASE ${escapeIdentifier(disposableDatabaseName)} WITH OID = ${databaseOid}`,
  );
  boundaryState.ownedDatabaseOid = databaseOid;
  boundaryState.pendingDatabaseOid = null;
}

function requireOwnedDatabaseOidForWork(boundaryState, phase) {
  if (
    boundaryState.pendingDatabaseOid !== null
    || boundaryState.ownedDatabaseOid === null
  ) {
    throw new Error(
      `PostgreSQL integration cannot start database work without one promoted exact database identity. phase=${phase} pendingDatabaseOid=${boundaryState.pendingDatabaseOid ?? "missing"} ownedDatabaseOid=${boundaryState.ownedDatabaseOid ?? "missing"}`,
    );
  }
  return boundaryState.ownedDatabaseOid;
}

async function requireOwnedDatabaseIdentityForWork(
  adminClient,
  boundaryState,
  phase,
) {
  const expectedDatabaseOid = requireOwnedDatabaseOidForWork(
    boundaryState,
    phase,
  );
  const identity = await inspectDatabaseIdentity(
    adminClient,
    expectedDatabaseOid,
  );
  if (identity.classification !== "exact") {
    throw databaseIdentityInterferenceError(
      identity,
      phase,
    );
  }
}

async function requireConnectedDatabaseIdentityForWork(
  client,
  boundaryState,
  phase,
) {
  const expectedDatabaseOid = requireOwnedDatabaseOidForWork(
    boundaryState,
    phase,
  );
  const result = await client.query(
    `SELECT
       current_database() AS database_name,
       database.oid::text AS database_oid
     FROM pg_catalog.pg_database AS database
     WHERE database.datname = current_database()`,
  );
  const actualDatabase = result.rows[0];
  if (
    actualDatabase?.database_name !== disposableDatabaseName
    || actualDatabase.database_oid !== expectedDatabaseOid
  ) {
    throw new Error(
      `Refusing PostgreSQL integration work on a database connection without the exact runner-owned identity. phase=${phase} expectedDatabase=${disposableDatabaseName} expectedOid=${expectedDatabaseOid} actualDatabase=${actualDatabase?.database_name ?? "missing"} actualOid=${actualDatabase?.database_oid ?? "missing"}`,
    );
  }
}

function clearDatabaseOwnershipEvidence(boundaryState, databaseOwnership) {
  if (databaseOwnership.ownershipState === "pending") {
    if (boundaryState.pendingDatabaseOid !== databaseOwnership.databaseOid) {
      throw new Error(
        `PostgreSQL integration pending database ownership changed during cleanup. expectedOid=${databaseOwnership.databaseOid} actualOid=${boundaryState.pendingDatabaseOid ?? "missing"}`,
      );
    }
    boundaryState.pendingDatabaseOid = null;
    return;
  }
  if (databaseOwnership.ownershipState === "owned") {
    if (boundaryState.ownedDatabaseOid !== databaseOwnership.databaseOid) {
      throw new Error(
        `PostgreSQL integration promoted database ownership changed during cleanup. expectedOid=${databaseOwnership.databaseOid} actualOid=${boundaryState.ownedDatabaseOid ?? "missing"}`,
      );
    }
    boundaryState.ownedDatabaseOid = null;
    return;
  }
  throw new Error(
    `PostgreSQL integration database ownership state is unsupported during cleanup. ownershipState=${databaseOwnership.ownershipState}`,
  );
}

async function cleanupDisposableDatabase(
  cleanupSession,
  cleanupDeadline,
  boundaryState,
  cleanupIdentities,
) {
  const errors = [];
  const { databaseIdentity, databaseOwnership } = cleanupIdentities;
  if (databaseIdentity === null || databaseOwnership === null) return errors;
  if (databaseIdentity.classification === "absent") {
    clearDatabaseOwnershipEvidence(boundaryState, databaseOwnership);
    return errors;
  }
  if (databaseIdentity.classification !== "exact") {
    throw new Error(
      `PostgreSQL integration reached database cleanup with an unapproved identity classification. classification=${databaseIdentity.classification} databaseOid=${databaseOwnership.databaseOid}`,
    );
  }

  let sessionsClosed = false;
  try {
    await terminateDatabaseSessionsByOid(
      cleanupSession,
      cleanupDeadline,
      databaseOwnership.databaseOid,
      "runner-owned database cleanup",
    );
    sessionsClosed = true;
  } catch (error) {
    errors.push(contextualError(
      `Failed to terminate and await connections to the runner-owned PostgreSQL database. database=${disposableDatabaseName}`,
      error,
    ));
  }

  if (!sessionsClosed) return errors;
  try {
    const currentIdentity = await inspectDatabaseIdentityForCleanup(
      cleanupSession,
      cleanupDeadline,
      databaseOwnership.databaseOid,
      "final database cleanup identity verification",
    );
    if (currentIdentity.classification === "absent") {
      clearDatabaseOwnershipEvidence(boundaryState, databaseOwnership);
      return errors;
    }
    if (currentIdentity.classification !== "exact") {
      throw databaseIdentityInterferenceError(
        currentIdentity,
        "final database cleanup verification",
      );
    }
    await runCleanupQuery(
      cleanupSession,
      cleanupDeadline,
      "runner-owned database drop",
      `DROP DATABASE ${escapeIdentifier(disposableDatabaseName)} WITH (FORCE)`,
      [],
    );
    clearDatabaseOwnershipEvidence(boundaryState, databaseOwnership);
  } catch (error) {
    errors.push(contextualError(
      `Failed to drop the runner-owned PostgreSQL database. database=${disposableDatabaseName} databaseOid=${databaseOwnership.databaseOid} exact ownership evidence was retained because a DDL timeout or connection loss can make the outcome ambiguous; reclassify the exact name/OID before manual follow-up`,
      error,
    ));
  }
  return errors;
}

async function cleanupOwnedRoles(
  cleanupSession,
  cleanupDeadline,
  boundaryState,
  classifiedRoleIdentities,
) {
  if (classifiedRoleIdentities.length === 0) return [];

  let transactionStarted = false;
  let primaryError = null;
  const finalizationErrors = [];
  let currentRoleIdentities = [];
  try {
    await runCleanupQuery(
      cleanupSession,
      cleanupDeadline,
      "runner-owned role cleanup transaction begin",
      "BEGIN",
      [],
    );
    transactionStarted = true;
    currentRoleIdentities = await inspectOwnedRoleIdentities(
      cleanupSession,
      cleanupDeadline,
      boundaryState,
      "transactional role cleanup identity verification",
    );
    const conflicts = currentRoleIdentities
      .filter((identity) => (
        identity.classification !== "exact"
        && identity.classification !== "absent"
      ))
      .map((identity) => roleIdentityInterferenceError(
        identity,
        "transactional role cleanup verification",
      ));
    if (conflicts.length > 0) {
      throw new AggregateError(
        conflicts,
        "Refusing to mutate any tracked PostgreSQL role because cleanup identity verification found conflicts.",
      );
    }
    const exactRoles = currentRoleIdentities
      .filter((identity) => identity.classification === "exact")
      .reverse();
    for (const roleIdentity of exactRoles) {
      await runCleanupQuery(
        cleanupSession,
        cleanupDeadline,
        `runner-owned role drop role=${roleIdentity.roleName} roleOid=${roleIdentity.expectedRoleOid}`,
        `DROP ROLE ${escapeIdentifier(roleIdentity.roleName)}`,
        [],
      );
    }
    await runCleanupQuery(
      cleanupSession,
      cleanupDeadline,
      "runner-owned role cleanup transaction commit",
      "COMMIT",
      [],
    );
    transactionStarted = false;
  } catch (error) {
    primaryError = contextualError(
      `Failed to transactionally clean runner-owned PostgreSQL roles. exact ownership evidence was retained because a DDL or commit timeout can make the outcome ambiguous; reclassify every exact name/OID before manual follow-up. trackedRoles=${JSON.stringify([...boundaryState.ownedRoleOids.entries()])}`,
      error,
    );
  }

  if (transactionStarted) {
    try {
      await runCleanupQuery(
        cleanupSession,
        cleanupDeadline,
        "runner-owned role cleanup transaction rollback",
        "ROLLBACK",
        [],
      );
    } catch (error) {
      finalizationErrors.push(contextualError(
        "Failed to roll back transactional PostgreSQL role cleanup.",
        error,
      ));
    }
  }
  const failure = combineErrors(
    [
      ...(primaryError === null ? [] : [primaryError]),
      ...finalizationErrors,
    ],
    "PostgreSQL role cleanup and rollback failed.",
  );
  if (failure !== null) return [failure];

  for (const roleIdentity of currentRoleIdentities) {
    boundaryState.ownedRoleOids.delete(roleIdentity.roleName);
  }
  return [];
}

async function cleanupBoundaryState(
  cleanupSession,
  cleanupDeadline,
  boundaryState,
  boundaryFileName,
) {
  let cleanupIdentities;
  try {
    cleanupIdentities = await inspectBoundaryCleanupIdentities(
      cleanupSession,
      cleanupDeadline,
      boundaryState,
    );
  } catch (error) {
    return [contextualError(
      `Failed to classify all tracked PostgreSQL identities before cleanup. boundary=${boundaryFileName}`,
      error,
    )];
  }
  const identityConflicts = cleanupIdentityConflictErrors(cleanupIdentities);
  if (identityConflicts.length > 0) {
    return [new AggregateError(
      identityConflicts,
      `Refusing to mutate any runner-tracked PostgreSQL object because whole-boundary cleanup classification found conflicts. boundary=${boundaryFileName} pendingDatabaseOid=${boundaryState.pendingDatabaseOid ?? "missing"} ownedDatabaseOid=${boundaryState.ownedDatabaseOid ?? "missing"} ownedRoles=${JSON.stringify([...boundaryState.ownedRoleOids.entries()])}`,
    )];
  }

  const errors = await cleanupDisposableDatabase(
    cleanupSession,
    cleanupDeadline,
    boundaryState,
    cleanupIdentities,
  );
  if (errors.length === 0) {
    errors.push(...await cleanupOwnedRoles(
      cleanupSession,
      cleanupDeadline,
      boundaryState,
      cleanupIdentities.roleIdentities,
    ));
  }
  const remainingState = [];
  if (boundaryState.pendingDatabaseOid !== null) {
    remainingState.push(
      `pendingDatabase=${disposableDatabaseName} databaseOid=${boundaryState.pendingDatabaseOid}`,
    );
  }
  if (boundaryState.ownedDatabaseOid !== null) {
    remainingState.push(
      `database=${disposableDatabaseName} databaseOid=${boundaryState.ownedDatabaseOid}`,
    );
  }
  if (boundaryState.ownedRoleOids.size > 0) {
    remainingState.push(
      `roles=${JSON.stringify([...boundaryState.ownedRoleOids.keys()])}`,
    );
  }
  if (remainingState.length > 0) {
    errors.push(new Error(
      `PostgreSQL integration cleanup retained runner-owned state. boundary=${boundaryFileName} ${remainingState.join(" ")}`,
    ));
  }
  return errors;
}

function boundaryStateHasOwnedObjects(boundaryState) {
  return (
    boundaryState.pendingDatabaseOid !== null
    || boundaryState.ownedDatabaseOid !== null
    || boundaryState.ownedRoleOids.size > 0
  );
}

async function cleanupBoundaryStateWithRecovery(
  lifecycleAdminSession,
  boundaryState,
  boundaryFileName,
  cleanupDeadline,
) {
  const errors = [];
  for (
    let attempt = 1;
    attempt <= lifecycleCleanupMaximumAttempts;
    attempt += 1
  ) {
    let cleanupSession;
    try {
      const databaseOwnership = getDatabaseOwnershipEvidence(boundaryState);
      cleanupSession = await lifecycleAdminSession.getClientForCleanup(
        databaseOwnership,
        cleanupDeadline,
      );
    } catch (error) {
      errors.push(contextualError(
        `PostgreSQL integration could not obtain a serialized administrative session for cleanup. boundary=${boundaryFileName} attempt=${attempt}`,
        error,
      ));
      if (
        attempt < lifecycleCleanupMaximumAttempts
        && cleanupDeadline.expiresAt - performance.now()
          > cleanupClientTeardownReserveMilliseconds
      ) {
        continue;
      }
      break;
    }
    errors.push(...await cleanupBoundaryState(
      cleanupSession,
      cleanupDeadline,
      boundaryState,
      boundaryFileName,
    ));
    if (!boundaryStateHasOwnedObjects(boundaryState)) break;
    if (lifecycleAdminSession.isCleanupClientHealthy()) break;
    if (
      cleanupDeadline.expiresAt - performance.now()
      <= cleanupClientTeardownReserveMilliseconds
    ) {
      break;
    }
  }
  return errors;
}

async function runBoundary(
  lifecycleAdminSession,
  adminConnection,
  boundaryDefinition,
  initiallyAbsentRoleNames,
  signalSupervisor,
  mutableWorkSupervisor,
  terminalCleanupController,
  isFinalBoundary,
) {
  const migrationFiles = await listMigrationFiles(
    boundaryDefinition.migrationFileName,
    boundaryDefinition.expectedMigrationCount,
  );
  const boundaryState = {
    initiallyAbsentRoleNames,
    ownedDatabaseOid: null,
    ownedRoleOids: new Map(),
    pendingDatabaseOid: null,
  };
  let primaryError = null;
  let phase = "database creation";
  try {
    signalSupervisor.throwIfSignaled(
      `before boundary ${boundaryDefinition.migrationFileName}`,
    );
    const isolationPhase =
      `before boundary ${boundaryDefinition.migrationFileName}`;
    await lifecycleAdminSession.runWork(
      isolationPhase,
      (adminClient) => assertManagedClusterStateAbsent(
        adminClient,
        isolationPhase,
      ),
    );
    signalSupervisor.throwIfSignaled(
      `after isolation check for ${boundaryDefinition.migrationFileName}`,
    );
    const databaseCreationPhase =
      `database creation for ${boundaryDefinition.migrationFileName}`;
    await lifecycleAdminSession.runWork(
      databaseCreationPhase,
      (adminClient) => createDisposableDatabase(
        adminClient,
        boundaryState,
      ),
    );
    const databaseCreationVerificationPhase =
      `after database creation for ${boundaryDefinition.migrationFileName}`;
    await lifecycleAdminSession.runWork(
      databaseCreationVerificationPhase,
      (adminClient) => requireOwnedDatabaseIdentityForWork(
        adminClient,
        boundaryState,
        databaseCreationVerificationPhase,
      ),
    );
    signalSupervisor.throwIfSignaled(
      `after database creation for ${boundaryDefinition.migrationFileName}`,
    );
    const ownerDatabaseUrl = createDatabaseUrl(
      adminConnection,
      disposableDatabaseName,
      adminConnection.username,
      adminConnection.password,
    );
    phase = "migration boundary setup";
    await applyMigrationBoundary(
      adminConnection,
      migrationFiles,
      boundaryDefinition,
      boundaryState,
      lifecycleAdminSession,
      signalSupervisor,
      mutableWorkSupervisor,
    );
    const runtimeDatabaseUrl = createDatabaseUrl(
      adminConnection,
      disposableDatabaseName,
      "backend_app",
      backendRolePassword,
    );
    phase = "integration test child";
    const childVerificationPhase =
      `before integration test child for ${boundaryDefinition.migrationFileName}`;
    await lifecycleAdminSession.runWork(
      childVerificationPhase,
      async (adminClient) => {
        await requireOwnedDatabaseIdentityForWork(
          adminClient,
          boundaryState,
          childVerificationPhase,
        );
        await assertOwnedRole(
          adminClient,
          "backend_app",
          boundaryState,
        );
      },
    );
    const expectedDatabaseOid = requireOwnedDatabaseOidForWork(
      boundaryState,
      `before integration test child for ${boundaryDefinition.migrationFileName}`,
    );
    await runNodeTests(
      boundaryDefinition.testFiles,
      runtimeDatabaseUrl,
      ownerDatabaseUrl,
      expectedDatabaseOid,
      signalSupervisor,
      mutableWorkSupervisor,
    );
    await lifecycleAdminSession.runWork(
      `after integration test child for ${boundaryDefinition.migrationFileName}`,
      () => undefined,
    );
  } catch (error) {
    primaryError = contextualError(
      `PostgreSQL integration boundary failed. boundary=${boundaryDefinition.migrationFileName} phase=${phase}`,
      error,
    );
  }

  const cleanupDeadline = terminalCleanupController.begin(
    `boundary cleanup boundary=${boundaryDefinition.migrationFileName}`,
  );
  const cleanupErrors = await cleanupBoundaryStateWithRecovery(
    lifecycleAdminSession,
    boundaryState,
    boundaryDefinition.migrationFileName,
    cleanupDeadline,
  );
  const failure = combineErrors(
    [
      ...(primaryError === null ? [] : [primaryError]),
      ...cleanupErrors,
    ],
    `PostgreSQL integration phase and cleanup failed. boundary=${boundaryDefinition.migrationFileName}`,
  );
  if (failure !== null) throw failure;
  if (!isFinalBoundary && signalSupervisor.firstSignal() === null) {
    terminalCleanupController.clearCompletedBoundary(cleanupDeadline);
  }
}

const adminConnection = requireAdminDatabaseConnection();
const terminalCleanupController = createTerminalCleanupController();
const mutableWorkSupervisor = createMutableWorkSupervisor();
const lifecycleAdminSession = createLifecycleAdminSession(
  adminConnection,
  mutableWorkSupervisor,
);
const signalSupervisor = createSignalSupervisor((signal, failure) => {
  const cleanupDeadline = terminalCleanupController.begin(
    `signal-driven terminal cleanup signal=${signal}`,
  );
  mutableWorkSupervisor.stopAll(failure);
  lifecycleAdminSession.startTerminalInterruption(
    cleanupDeadline,
    failure,
  );
});
signalSupervisor.install();

let runError = null;
try {
  signalSupervisor.throwIfSignaled("before lifecycle lock connection");
  await lifecycleAdminSession.connectAndAcquire();
  signalSupervisor.throwIfSignaled("lifecycle lock acquisition");
  const initiallyAbsentRoleNames = await lifecycleAdminSession.runWork(
    "administrative preflight",
    (adminClient) => preflightAdministrativeCluster(
      adminClient,
      adminConnection,
      signalSupervisor,
    ),
  );
  for (
    let boundaryIndex = 0;
    boundaryIndex < boundaryDefinitions.length;
    boundaryIndex += 1
  ) {
    const boundaryDefinition = boundaryDefinitions[boundaryIndex];
    await runBoundary(
      lifecycleAdminSession,
      adminConnection,
      boundaryDefinition,
      initiallyAbsentRoleNames,
      signalSupervisor,
      mutableWorkSupervisor,
      terminalCleanupController,
      boundaryIndex === boundaryDefinitions.length - 1,
    );
  }
} catch (error) {
  runError = asError(error);
}

const finalCleanupDeadline = terminalCleanupController.begin(
  "lifecycle administrative finalization",
);
await lifecycleAdminSession.finalize(finalCleanupDeadline);
runError = combineErrors(
  [
    ...(runError === null ? [] : [runError]),
    ...lifecycleAdminSession.errors(),
  ],
  "PostgreSQL integration lifecycle and administrative cleanup failed.",
);

const interruptedBySignal = signalSupervisor.firstSignal();
signalSupervisor.uninstall();
if (interruptedBySignal !== null) {
  if (runError !== null) console.error(runError);
  process.kill(process.pid, interruptedBySignal);
} else if (runError !== null) {
  throw runError;
}
