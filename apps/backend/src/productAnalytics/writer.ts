import pg from "pg";
import { getDatabaseUrl } from "../database/config";
import { logDatabasePoolError, toDatabaseBoundaryError } from "../database/transient";
import { HttpError } from "../shared/errors";
import {
  findProductAnalyticsEventDefinition,
  parseProductAnalyticsExperimentAssignments,
  productAnalyticsSchemaVersion,
} from "./catalog";
import type { ProductAnalyticsEventRow, ProductAnalyticsIdentityLink } from "./types";

// The analytics writer owns its own small pool so an analytics spike can never starve product
// requests of database connections. Events are written on the request that carried them: a Lambda
// container is frozen and killed unpredictably, so an in-memory buffer between invocations would
// lose data silently. Client-side batching is the only batching.
const analyticsPoolMaxConnections = 4;
const analyticsPoolConnectionTimeoutMs = 2_000;

type ProductAnalyticsParameterValue = string | number | Date | null;

type ProductAnalyticsInsertColumn = Readonly<{
  columnName: string;
  columnType: string;
  readValue: (row: ProductAnalyticsEventRow) => ProductAnalyticsParameterValue;
}>;

// One ordered source for the column list, the array casts, and the parameter values, so a new
// column cannot silently shift the positional mapping between them.
const productAnalyticsInsertColumns: ReadonlyArray<ProductAnalyticsInsertColumn> = [
  { columnName: "event_id", columnType: "uuid", readValue: (row) => row.eventId },
  { columnName: "schema_version", columnType: "smallint", readValue: (row) => row.schemaVersion },
  { columnName: "event_name", columnType: "text", readValue: (row) => row.eventName },
  { columnName: "origin", columnType: "text", readValue: (row) => row.origin },
  { columnName: "backfill_id", columnType: "uuid", readValue: (row) => row.backfillId },
  { columnName: "client_occurred_at", columnType: "timestamptz", readValue: (row) => row.clientOccurredAt },
  { columnName: "client_sent_at", columnType: "timestamptz", readValue: (row) => row.clientSentAt },
  { columnName: "server_received_at", columnType: "timestamptz", readValue: (row) => row.serverReceivedAt },
  { columnName: "occurred_at", columnType: "timestamptz", readValue: (row) => row.occurredAt },
  { columnName: "user_id", columnType: "uuid", readValue: (row) => row.userId },
  { columnName: "subject_user_id", columnType: "uuid", readValue: (row) => row.subjectUserId },
  { columnName: "auth_transport", columnType: "text", readValue: (row) => row.authTransport },
  { columnName: "trust_level", columnType: "text", readValue: (row) => row.trustLevel },
  { columnName: "guest_session_id", columnType: "uuid", readValue: (row) => row.guestSessionId },
  { columnName: "workspace_id", columnType: "uuid", readValue: (row) => row.workspaceId },
  { columnName: "anonymous_id", columnType: "uuid", readValue: (row) => row.anonymousId },
  { columnName: "session_id", columnType: "uuid", readValue: (row) => row.sessionId },
  { columnName: "platform", columnType: "text", readValue: (row) => row.platform },
  { columnName: "app_version", columnType: "text", readValue: (row) => row.appVersion },
  { columnName: "os_version", columnType: "text", readValue: (row) => row.osVersion },
  { columnName: "device_model", columnType: "text", readValue: (row) => row.deviceModel },
  { columnName: "device_locale", columnType: "text", readValue: (row) => row.deviceLocale },
  { columnName: "timezone", columnType: "text", readValue: (row) => row.timezone },
  { columnName: "country", columnType: "text", readValue: (row) => row.country },
  { columnName: "network_state", columnType: "text", readValue: (row) => row.networkState },
  { columnName: "screen", columnType: "text", readValue: (row) => row.screen },
  { columnName: "event_properties", columnType: "jsonb", readValue: (row) => JSON.stringify(row.eventProperties) },
  {
    columnName: "experiment_assignments",
    columnType: "jsonb",
    readValue: (row) => JSON.stringify(row.experimentAssignments),
  },
  { columnName: "request_id", columnType: "text", readValue: (row) => row.requestId },
];

// unnest keeps the parameter count and the query plan stable no matter how many events a batch
// carries, which expanded VALUES tuples would not. The multi-argument form is FROM-clause syntax
// that PostgreSQL expands into ROWS FROM, and that expansion only fires for a bare, unaliased
// unnest without a column definition list, so it must not be schema-qualified.
const insertProductAnalyticsEventsSql = [
  "INSERT INTO analytics.product_events (",
  productAnalyticsInsertColumns.map((column) => column.columnName).join(", "),
  ") SELECT * FROM unnest(",
  productAnalyticsInsertColumns
    .map((column, columnIndex) => `$${columnIndex + 1}::${column.columnType}[]`)
    .join(", "),
  ") ON CONFLICT (event_id) DO NOTHING",
].join("");

// A link is a fact about one anonymous_id and one account, so a repeated observation of the same
// pair is not a new fact. The first link keeps its linked_at, which is what bounds how far back the
// resolved read view lets a link claim history, and link_id keeps naming the first observation.
//
// source is the one column a repeat may rewrite, and only towards the server. A server_derived link
// is something the backend watched happen during a guest upgrade, while an authenticated_client link
// is a claim a request carried, so the pair's trust must not be decided by whichever of the two
// happened to arrive first. Without this, a client that used a guest user id as its anonymous_id
// could land the authenticated_client row first, and analytics.product_events_resolved reads the
// server namespace through source = 'server_derived', so that guest's whole tail would silently stop
// resolving to the account. 0115 grants the matching column-scoped UPDATE privilege and policy.
const insertProductAnalyticsIdentityLinkSql = [
  "INSERT INTO analytics.identity_links (link_id, anonymous_id, user_id, source)",
  " VALUES ($1::uuid, $2::uuid, $3::uuid, $4::text)",
  " ON CONFLICT (anonymous_id, user_id) DO UPDATE SET source = EXCLUDED.source",
  " WHERE identity_links.source <> 'server_derived'",
  " AND EXCLUDED.source = 'server_derived'",
].join("");

let analyticsPool: pg.Pool | undefined;

async function getAnalyticsPool(): Promise<pg.Pool> {
  if (analyticsPool !== undefined) {
    return analyticsPool;
  }

  const connectionString = await getDatabaseUrl();
  if (analyticsPool !== undefined) {
    return analyticsPool;
  }

  const ssl = process.env.DB_SECRET_ARN ? true : false;
  const createdPool = new pg.Pool({
    connectionString,
    ssl,
    max: analyticsPoolMaxConnections,
    connectionTimeoutMillis: analyticsPoolConnectionTimeoutMs,
  });
  createdPool.on("error", (error: Error): void => {
    logDatabasePoolError("product_analytics", error);
  });
  analyticsPool = createdPool;
  return analyticsPool;
}

// The cap is the protection, so an exhausted pool fails immediately instead of queueing behind
// product traffic. The caller turns this into a 429 and the client retries from its own queue.
function assertAnalyticsPoolCapacity(pool: pg.Pool): void {
  const busyConnectionCount = pool.totalCount - pool.idleCount;
  if (pool.waitingCount > 0 || busyConnectionCount >= analyticsPoolMaxConnections) {
    throw new HttpError(
      429,
      "Analytics ingestion is saturated. Retry this batch shortly.",
      "ANALYTICS_WRITER_BUSY",
      { retryAfterSeconds: 1 },
    );
  }
}

async function connectAnalyticsClient(pool: pg.Pool): Promise<pg.PoolClient> {
  try {
    return await pool.connect();
  } catch (error) {
    throw toDatabaseBoundaryError(error);
  }
}

async function rollbackAnalyticsTransaction(client: pg.PoolClient): Promise<Error | null> {
  try {
    await client.query("ROLLBACK");
    return null;
  } catch (rollbackError) {
    return rollbackError instanceof Error ? rollbackError : new Error(String(rollbackError));
  }
}

function buildInsertParameters(
  rows: ReadonlyArray<ProductAnalyticsEventRow>,
): Array<Array<ProductAnalyticsParameterValue>> {
  return productAnalyticsInsertColumns.map(
    (column) => rows.map((row) => column.readValue(row)),
  );
}

// Every analytics write runs with the same guards: the pool cap fails a saturated writer instead of
// queueing it behind product traffic, and the statement timeout keeps one slow write from holding a
// connection while the request that carried it waits.
async function runAnalyticsWrite(
  write: (client: pg.PoolClient) => Promise<number>,
): Promise<number> {
  const pool = await getAnalyticsPool();
  assertAnalyticsPoolCapacity(pool);

  const client = await connectAnalyticsClient(pool);
  let releaseError: Error | null = null;
  try {
    await client.query("BEGIN");
    await client.query("SET LOCAL statement_timeout = '2s'");
    const writtenRowCount = await write(client);
    await client.query("COMMIT");
    return writtenRowCount;
  } catch (error) {
    releaseError = await rollbackAnalyticsTransaction(client);
    throw toDatabaseBoundaryError(error);
  } finally {
    client.release(releaseError === null ? undefined : releaseError);
  }
}

// Every producer reaches Postgres through this function, so the catalog contract is enforced here
// instead of being an obligation each new producer has to remember. Client batches are already
// checked in validation.ts, but server-derived producers build rows directly and
// ProductAnalyticsEventRow carries the catalog-bound fields as a bare number and bare string maps,
// which give no per-event shape at compile time. The event_properties and experiment_assignments
// columns promise only catalog-declared values, meaning allowlisted enum members, non-negative
// integers, and strings the catalog binds to a fixed format, and never free text; the anonymization
// design keeps both columns in full because of that promise, so a row that breaks it must never be
// stored. A violation is a defect in the calling code rather than anything a retry can fix, so it
// fails loudly with no fallback.
// The table's own column-shape rules stay with the table: product_events_client_columns_shape and
// product_events_backfill_id_shape hold for every writer, including a backfill that never calls this
// function, so repeating them here would duplicate a rule that already cannot be skipped.
function assertProductAnalyticsRowMatchesCatalog(row: ProductAnalyticsEventRow): void {
  // schema_version records the catalog version that accepted the row, so a row stamped with any
  // other version claims an acceptance this catalog never gave it.
  if (row.schemaVersion !== productAnalyticsSchemaVersion) {
    throw new Error(
      `Product analytics row is stamped with a schema version this catalog did not accept. eventId=${row.eventId} schemaVersion=${row.schemaVersion} expectedSchemaVersion=${productAnalyticsSchemaVersion}`,
    );
  }

  const definition = findProductAnalyticsEventDefinition(row.eventName);
  if (definition === null) {
    throw new Error(
      `Product analytics row carries an event name that is not in the catalog. eventId=${row.eventId} eventName=${row.eventName}`,
    );
  }

  // A server-only event records something the backend observed itself, so a client-origin row can
  // never legitimately carry that name.
  if (definition.serverOnly && row.origin === "client") {
    throw new Error(
      `Product analytics row claims a server-derived event with client origin. eventId=${row.eventId} eventName=${row.eventName}`,
    );
  }

  // requiresScreen belongs to the same catalog entry as the property allowlist, so it is checked
  // here too rather than left to each producer. An event defined around a surface that arrives
  // without one is unusable, and on an append-only table it cannot be repaired afterwards.
  if (definition.requiresScreen && row.screen === null) {
    throw new Error(
      `Product analytics row is missing the surface its catalog entry requires. eventId=${row.eventId} eventName=${row.eventName}`,
    );
  }

  if (definition.parseProperties(row.eventProperties) === null) {
    throw new Error(
      `Product analytics row carries event properties the catalog does not declare. eventId=${row.eventId} eventName=${row.eventName}`,
    );
  }

  if (parseProductAnalyticsExperimentAssignments(row.experimentAssignments) === null) {
    throw new Error(
      `Product analytics row carries experiment assignments outside the catalog's token shape. eventId=${row.eventId} eventName=${row.eventName}`,
    );
  }
}

// Returns the number of rows actually stored. A redelivered batch conflicts on event_id and stores
// nothing, so a smaller number than the input length means the events were already ingested.
export async function insertProductAnalyticsEvents(
  rows: ReadonlyArray<ProductAnalyticsEventRow>,
): Promise<number> {
  if (rows.length === 0) {
    return 0;
  }

  // Checked before any connection is taken so a contract violation never consumes analytics pool
  // capacity and never writes part of a batch.
  for (const row of rows) {
    assertProductAnalyticsRowMatchesCatalog(row);
  }

  return runAnalyticsWrite(async (client) => {
    const result = await client.query(insertProductAnalyticsEventsSql, buildInsertParameters(rows));
    return result.rowCount ?? 0;
  });
}

// Returns the number of rows the statement changed: 1 when the link was stored, 1 when an existing
// client-claimed link for the same pair was raised to the server's own observation, and 0 when the
// pair was already recorded at the same or higher trust.
export async function insertProductAnalyticsIdentityLink(
  link: ProductAnalyticsIdentityLink,
): Promise<number> {
  return runAnalyticsWrite(async (client) => {
    const result = await client.query(
      insertProductAnalyticsIdentityLinkSql,
      [link.linkId, link.anonymousId, link.userId, link.source],
    );
    return result.rowCount ?? 0;
  });
}
