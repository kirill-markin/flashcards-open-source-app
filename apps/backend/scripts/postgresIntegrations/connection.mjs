import {
  administrativeDatabaseName,
  disposableDatabaseName,
  integrationChildDatabaseEnvironmentVariableNames,
  postgresConnectionTimeoutMilliseconds,
  postgresStartupOptions,
} from "./boundaries.mjs";
import { contextualError } from "./errors.mjs";

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

export function requireAdminDatabaseConnection() {
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

export function createDatabaseUrl(
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

export function createPostgresClientOptions(
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

export function createIntegrationChildEnvironment(
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
