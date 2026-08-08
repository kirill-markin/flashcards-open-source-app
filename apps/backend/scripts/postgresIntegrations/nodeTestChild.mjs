import { spawn } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { createIntegrationChildEnvironment } from "./connection.mjs";
import { contextualError } from "./errors.mjs";

const scriptDirectory = dirname(dirname(fileURLToPath(import.meta.url)));
const backendRoot = dirname(scriptDirectory);

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

export async function runNodeTests(
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

