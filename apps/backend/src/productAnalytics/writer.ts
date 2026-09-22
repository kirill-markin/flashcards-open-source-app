import { randomBytes } from "node:crypto";
import pg from "pg";
import { sampleInstallationCountryInTransaction } from "./installationCountry";
import { applyUserDatabaseScopeInExecutor, type DatabaseExecutor } from "../database";
import { getDatabaseUrl } from "../database/config";
import {
  getDatabaseErrorFields,
  logDatabasePoolError,
  toDatabaseBoundaryError,
  TransientDatabaseHttpError,
  type DatabaseBoundaryErrorFields,
} from "../database/transient";
import { HttpError } from "../shared/errors";
import {
  findProductAnalyticsEventDefinition,
  parseProductAnalyticsExperimentAssignments,
  productAnalyticsSchemaVersion,
} from "./catalog";
import type {
  AnonymousProductAnalyticsEventRow,
  ProductAnalyticsEventRow,
  ProductAnalyticsIdentityLink,
  ProductAnalyticsInstallationObservation,
} from "./types";

// The analytics writer owns its own small pool so an analytics spike can never starve product
// requests of database connections. Events are written on the request that carried them: a Lambda
// container is frozen and killed unpredictably, so an in-memory buffer between invocations would
// lose data silently. Client-side batching is the only batching.
const analyticsPoolMaxConnections = 4;
const analyticsPoolConnectionTimeoutMs = 2_000;

// pg-pool answers a failed acquisition with a bare Error carrying no code and no SQLSTATE, so it
// matches nothing isTransientDatabaseError recognises and would otherwise reach a caller as an
// unclassified failure. The message is the only thing that names it, and it is pg's wording rather
// than a contract: a pg upgrade that rewords it makes this match fail silently, so the acquisition
// timeout would take the 503 branch below instead of the 429 the analytics ingest route still
// answers a saturated pool with. Re-check the string against pg-pool on every pg upgrade.
const analyticsPoolAcquisitionTimeoutMessage = "timeout exceeded when trying to connect";

type ProductAnalyticsParameterValue = string | number | boolean | Date | null;

type ProductAnalyticsInsertColumn<Row extends ProductAnalyticsEventRow> = Readonly<{
  columnName: string;
  columnType: string;
  readValue: (row: Row) => ProductAnalyticsParameterValue;
}>;

// One ordered source for the column list, the array casts, and the parameter values, so a new
// column cannot silently shift the positional mapping between them.
const productAnalyticsInsertColumns: ReadonlyArray<ProductAnalyticsInsertColumn<ProductAnalyticsEventRow>> = [
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
  { columnName: "ui_locale", columnType: "text", readValue: (row) => row.uiLocale },
  { columnName: "network_state", columnType: "text", readValue: (row) => row.networkState },
  { columnName: "screen", columnType: "text", readValue: (row) => row.screen },
  { columnName: "event_properties", columnType: "jsonb", readValue: (row) => JSON.stringify(row.eventProperties) },
  {
    columnName: "experiment_assignments",
    columnType: "jsonb",
    readValue: (row) => JSON.stringify(row.experimentAssignments),
  },
  { columnName: "request_id", columnType: "text", readValue: (row) => row.requestId },
  // The only nullable jsonb column: event_properties and experiment_assignments are always objects,
  // while details is absent on every client-origin row and on every server-derived row whose
  // producer has no provenance to record, so this parameter carries NULL elements in its jsonb[].
  {
    columnName: "details",
    columnType: "jsonb",
    readValue: (row) => (row.details === null ? null : JSON.stringify(row.details)),
  },
];

// The credential-free collector's columns: the shared list plus the two columns only that collector
// writes. Keeping them out of the shared list is deliberate: every other producer, and every
// integration test pinned by apps/backend/scripts/postgresIntegrations/boundaries.mjs to a schema
// older than db/migrations/0144_anonymous_client_daily_visitor_hash.sql and
// db/migrations/0145_anonymous_client_automated_marker.sql, inserts through the shared list, and
// naming either column there would fail each of those writes.
const anonymousProductAnalyticsInsertColumns: ReadonlyArray<
  ProductAnalyticsInsertColumn<AnonymousProductAnalyticsEventRow>
> = [
  ...productAnalyticsInsertColumns,
  { columnName: "daily_visitor_hash", columnType: "text", readValue: (row) => row.dailyVisitorHash },
  { columnName: "automated_client", columnType: "boolean", readValue: (row) => row.automatedClient },
];

// unnest keeps the parameter count and the query plan stable no matter how many events a batch
// carries, which expanded VALUES tuples would not. The multi-argument form is FROM-clause syntax
// that PostgreSQL expands into ROWS FROM, and that expansion only fires for a bare, unaliased
// unnest without a column definition list, so it must not be schema-qualified.
function buildInsertProductAnalyticsEventsSql<Row extends ProductAnalyticsEventRow>(
  columns: ReadonlyArray<ProductAnalyticsInsertColumn<Row>>,
): string {
  return [
    "INSERT INTO analytics.product_events (",
    columns.map((column) => column.columnName).join(", "),
    ") SELECT * FROM unnest(",
    columns
      .map((column, columnIndex) => `$${columnIndex + 1}::${column.columnType}[]`)
      .join(", "),
    ") ON CONFLICT (event_id) DO NOTHING",
  ].join("");
}

const insertProductAnalyticsEventsSql = buildInsertProductAnalyticsEventsSql(productAnalyticsInsertColumns);
const insertAnonymousProductAnalyticsEventsSql = buildInsertProductAnalyticsEventsSql(
  anonymousProductAnalyticsInsertColumns,
);

// One salt per UTC day, created by whichever request needs it first, and deleted when its day ends by
// the scheduled expiry job; see db/migrations/0144_anonymous_client_daily_visitor_hash.sql. Creating a
// salt and expiring salts both hold this transaction-scoped advisory lock and then read the database
// clock only once they hold it, so whichever of the two runs first, no request can create a salt for
// a day that has already ended or that a later day's salt has replaced. A refused day gets no hash.
const lockDailyVisitorHashSaltsSql =
  "SELECT pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtext('analytics.daily_visitor_hash_salts'))";
const selectDailyVisitorHashSaltDayOpenSql =
  "SELECT $1::date >= (pg_catalog.clock_timestamp() AT TIME ZONE 'UTC')::date"
  + " AND NOT EXISTS (SELECT 1 FROM analytics.daily_visitor_hash_salts AS salts WHERE salts.utc_day > $1::date)"
  + " AS is_open";
const insertDailyVisitorHashSaltSql =
  "INSERT INTO analytics.daily_visitor_hash_salts (utc_day, salt) VALUES ($1::date, $2::bytea)"
  + " ON CONFLICT (utc_day) DO NOTHING";
const selectDailyVisitorHashSaltSql =
  "SELECT salt FROM analytics.daily_visitor_hash_salts WHERE utc_day = $1::date";
const deleteEarlierDailyVisitorHashSaltsSql =
  "DELETE FROM analytics.daily_visitor_hash_salts WHERE utc_day < $1::date";
const deleteEndedDailyVisitorHashSaltsSql =
  "DELETE FROM analytics.daily_visitor_hash_salts"
  + " WHERE utc_day < (pg_catalog.clock_timestamp() AT TIME ZONE 'UTC')::date";
const dailyVisitorHashSaltByteLength = 32;

// A link is a fact about one anonymous_id and one account, so a repeated observation of the same
// pair is not a new fact. The first link keeps its linked_at, which is what bounds how far back the
// resolved read view lets a link claim history, and link_id keeps naming the first observation.
//
// source is the one column a repeat may rewrite, and only towards the server. A server_derived link
// is something the backend watched happen, during a guest upgrade or in the
// /guest-auth/identity/link route where a signed-in account claims the guest identity its browser or
// install held, while an authenticated_client link is a claim a request carried, so the pair's trust
// must not be decided by whichever of the two happened to arrive first. Without this, a client that
// used a guest user id as its anonymous_id could land the authenticated_client row first, and
// analytics.product_events_resolved reads the server namespace through source = 'server_derived', so
// that guest's whole tail would silently stop resolving to the account. 0115 grants the matching
// column-scoped UPDATE privilege and policy.
const insertProductAnalyticsIdentityLinkSql = [
  "INSERT INTO analytics.identity_links (link_id, anonymous_id, user_id, source)",
  " VALUES ($1::uuid, $2::uuid, $3::uuid, $4::text)",
  " ON CONFLICT (anonymous_id, user_id) DO UPDATE SET source = EXCLUDED.source",
  " WHERE identity_links.source <> 'server_derived'",
  " AND EXCLUDED.source = 'server_derived'",
].join("");

const upsertInstallationProfileSql = `
  INSERT INTO analytics.installation_profiles (
    anonymous_id, platform, user_id, app_version, os_version, device_locale, timezone,
    first_seen, last_seen
  ) VALUES ($1::uuid, $2::text, $3::uuid, $4::text, $5::text, $6::text, $7::text,
    $8::timestamptz, $8::timestamptz)
  ON CONFLICT (anonymous_id, platform) DO UPDATE SET
    user_id = EXCLUDED.user_id,
    app_version = EXCLUDED.app_version,
    os_version = EXCLUDED.os_version,
    device_locale = EXCLUDED.device_locale,
    timezone = EXCLUDED.timezone,
    last_seen = EXCLUDED.last_seen
  WHERE EXCLUDED.last_seen >= installation_profiles.last_seen
    AND (
      installation_profiles.last_seen <= EXCLUDED.last_seen - INTERVAL '1 hour'
      OR (installation_profiles.user_id, installation_profiles.app_version,
          installation_profiles.os_version, installation_profiles.device_locale,
          installation_profiles.timezone)
        IS DISTINCT FROM
         (EXCLUDED.user_id, EXCLUDED.app_version, EXCLUDED.os_version,
          EXCLUDED.device_locale, EXCLUDED.timezone)
    )
`;

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

// The 429 message is a fixed public string, so it is the only thing a caller that logs the raised
// error would otherwise record. Two very different failures reach it: the pool cap refusing a batch
// before a connection is requested, and an acquisition that timed out, which is what a slow connect
// during an RDS capacity or failover window looks like. The source error therefore travels on the
// same side fields TransientDatabaseHttpError carries and getDatabaseErrorFields reads, and never in
// the message: app.onError renders an HttpError message to the client verbatim.
class AnalyticsWriterBusyHttpError extends HttpError implements DatabaseBoundaryErrorFields {
  readonly sqlState: string | null;
  readonly errorCode: string | null;
  readonly databaseErrorClass: string;
  readonly databaseErrorMessage: string;

  constructor(sourceError: unknown | null) {
    super(
      429,
      "Analytics ingestion is saturated. Retry this batch shortly.",
      "ANALYTICS_WRITER_BUSY",
      { retryAfterSeconds: 1 },
    );
    if (sourceError === null) {
      this.sqlState = null;
      this.errorCode = null;
      this.databaseErrorClass = "AnalyticsPoolCapacityExceeded";
      this.databaseErrorMessage = "The analytics pool cap refused the batch before a connection was requested.";
      return;
    }

    const fields = getDatabaseErrorFields(sourceError);
    this.sqlState = fields.sqlState;
    this.errorCode = fields.errorCode;
    this.databaseErrorClass = fields.errorClass;
    this.databaseErrorMessage = fields.errorMessage;
  }
}

// The cap is the protection, so an exhausted pool fails immediately instead of queueing behind
// product traffic. The caller turns this into a 429 and the client retries from its own queue.
function assertAnalyticsPoolCapacity(pool: pg.Pool): void {
  const busyConnectionCount = pool.totalCount - pool.idleCount;
  if (pool.waitingCount > 0 || busyConnectionCount >= analyticsPoolMaxConnections) {
    throw new AnalyticsWriterBusyHttpError(null);
  }
}

// The counters above are sampled before the connection is taken, so two callers can both pass the
// assertion in one container and the loser waits out connectionTimeoutMillis here instead. That
// timeout is the same saturation the assertion refuses, so it answers with the same 429 and the
// same Retry-After rather than as an unclassified failure. Every other reason an acquisition fails
// is the database being unreachable, which is a 503, and the source error's class, message and
// SQLSTATE travel on the raised error either way.
function toAnalyticsConnectError(error: unknown): HttpError {
  if (error instanceof Error && error.message.includes(analyticsPoolAcquisitionTimeoutMessage)) {
    return new AnalyticsWriterBusyHttpError(error);
  }

  return new TransientDatabaseHttpError(error);
}

async function connectAnalyticsClient(pool: pg.Pool): Promise<pg.PoolClient> {
  try {
    return await pool.connect();
  } catch (error) {
    throw toAnalyticsConnectError(error);
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

function buildInsertParameters<Row extends ProductAnalyticsEventRow>(
  columns: ReadonlyArray<ProductAnalyticsInsertColumn<Row>>,
  rows: ReadonlyArray<Row>,
): Array<Array<ProductAnalyticsParameterValue>> {
  return columns.map(
    (column) => rows.map((row) => column.readValue(row)),
  );
}

// Every analytics write runs with the same guards: the pool cap fails a saturated writer instead of
// queueing it behind product traffic, and the statement timeout keeps one slow write from holding a
// connection while the request that carried it waits.
async function runAnalyticsWrite<Result>(
  write: (client: pg.PoolClient) => Promise<Result>,
): Promise<Result> {
  const pool = await getAnalyticsPool();
  assertAnalyticsPoolCapacity(pool);

  const client = await connectAnalyticsClient(pool);
  let releaseError: Error | null = null;
  try {
    await client.query("BEGIN");
    await client.query("SET LOCAL statement_timeout = '2s'");
    const writeResult = await write(client);
    await client.query("COMMIT");
    return writeResult;
  } catch (error) {
    releaseError = await rollbackAnalyticsTransaction(client);
    throw toDatabaseBoundaryError(error);
  } finally {
    client.release(releaseError === null ? undefined : releaseError);
  }
}

async function insertEventRowsInTransaction(
  client: pg.PoolClient,
  rows: ReadonlyArray<ProductAnalyticsEventRow>,
): Promise<number> {
  const result = await client.query(
    insertProductAnalyticsEventsSql,
    buildInsertParameters(productAnalyticsInsertColumns, rows),
  );
  return result.rowCount ?? 0;
}

// Beside the statement it feeds, so a column added to one cannot silently miss the other.
function buildIdentityLinkParameters(link: ProductAnalyticsIdentityLink): Array<string> {
  return [link.linkId, link.anonymousId, link.userId, link.source];
}

async function insertIdentityLinkInTransaction(
  client: pg.PoolClient,
  link: ProductAnalyticsIdentityLink,
): Promise<number> {
  const result = await client.query(
    insertProductAnalyticsIdentityLinkSql,
    buildIdentityLinkParameters(link),
  );
  return result.rowCount ?? 0;
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

  // identityFree belongs to the same catalog entry for the same reason requiresScreen does, and it
  // is checked here so it holds for every producer rather than only for the one route that first
  // needed it. Both ingest paths refuse such an event earlier and with a usable message; reaching
  // this throw means a producer built the row directly, and the table is append-only, so the row
  // must not be stored at all.
  if (definition.identityFree) {
    const identityColumns: ReadonlyArray<readonly [string, string | null]> = [
      ["user_id", row.userId],
      ["subject_user_id", row.subjectUserId],
      ["guest_session_id", row.guestSessionId],
      ["workspace_id", row.workspaceId],
      ["session_id", row.sessionId],
      ["anonymous_id", row.anonymousId],
    ];
    const carriedColumnNames = identityColumns
      .filter(([, value]) => value !== null)
      .map(([columnName]) => columnName);
    if (carriedColumnNames.length > 0) {
      throw new Error(
        `Product analytics row carries an identity its catalog entry forbids. eventId=${row.eventId} eventName=${row.eventName} columns=${carriedColumnNames.join(",")}`,
      );
    }
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

// Match the guest lifecycle's user-settings -> session lock order. A linked guest keeps its
// user_settings row after account deletion, so its revoked session must also be checked here.
async function lockInstallationOwnerInTransaction(
  client: pg.PoolClient,
  installation: Pick<ProductAnalyticsInstallationObservation, "userId" | "guestSessionId">,
): Promise<void> {
  await applyUserDatabaseScopeInExecutor(client, { userId: installation.userId });
  const owner = await client.query(
    "SELECT user_id FROM org.user_settings WHERE user_id = $1 FOR KEY SHARE",
    [installation.userId],
  );
  if (owner.rowCount !== 1) {
    throw new HttpError(403, "The analytics installation owner no longer exists.", "ANALYTICS_OWNER_DELETED");
  }

  if (installation.guestSessionId !== null) {
    const session = await client.query(
      `SELECT session_id FROM auth.guest_sessions
       WHERE session_id = $1::uuid AND user_id = $2 AND revoked_at IS NULL
       FOR SHARE`,
      [installation.guestSessionId, installation.userId],
    );
    if (session.rowCount !== 1) {
      throw new HttpError(401, "Guest session is invalid.", "GUEST_AUTH_INVALID");
    }
  }
}

async function upsertInstallationProfileInTransaction(
  client: pg.PoolClient,
  installation: ProductAnalyticsInstallationObservation,
): Promise<void> {
  await client.query(upsertInstallationProfileSql, [
    installation.anonymousId,
    installation.platform,
    installation.userId,
    installation.appVersion,
    installation.context.osVersion,
    installation.context.deviceLocale,
    installation.context.timezone,
    installation.observedAt,
  ]);
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

  return runAnalyticsWrite((client) => insertEventRowsInTransaction(client, rows));
}

// The credential-free collector's write, the only one that stores daily_visitor_hash and
// automated_client. Returns the number of rows stored, 0 for a redelivered event_id.
export async function insertAnonymousProductAnalyticsEvent(
  row: AnonymousProductAnalyticsEventRow,
): Promise<number> {
  assertProductAnalyticsRowMatchesCatalog(row);

  return runAnalyticsWrite(async (client) => {
    const result = await client.query(
      insertAnonymousProductAnalyticsEventsSql,
      buildInsertParameters(anonymousProductAnalyticsInsertColumns, [row]),
    );
    return result.rowCount ?? 0;
  });
}

// utcDay is a YYYY-MM-DD UTC date. Returns null when that day has ended by the database clock or a
// later day's salt exists, so a late request never recreates a deleted salt. Otherwise creates the
// day's salt when no request has yet, and deletes every earlier day's salt before returning.
export async function loadDailyVisitorHashSalt(utcDay: string): Promise<Buffer | null> {
  return runAnalyticsWrite(async (client) => {
    await client.query(lockDailyVisitorHashSaltsSql);
    const dayOpen = await client.query<{ is_open: boolean }>(selectDailyVisitorHashSaltDayOpenSql, [utcDay]);
    if (dayOpen.rows[0]?.is_open !== true) {
      return null;
    }

    await client.query(insertDailyVisitorHashSaltSql, [
      utcDay,
      randomBytes(dailyVisitorHashSaltByteLength),
    ]);
    const result = await client.query<{ salt: Buffer }>(selectDailyVisitorHashSaltSql, [utcDay]);
    const salt = result.rows[0]?.salt;
    if (salt === undefined) {
      throw new Error(
        `analytics.daily_visitor_hash_salts has no salt for the day it was just inserted for. utcDay=${utcDay}`,
      );
    }
    await client.query(deleteEarlierDailyVisitorHashSaltsSql, [utcDay]);
    return salt;
  });
}

// The scheduled expiry: deletes every salt whose UTC day has ended by the database clock, whether or
// not any request arrived since. Returns the number of salts deleted.
export async function deleteEndedDailyVisitorHashSalts(): Promise<number> {
  return runAnalyticsWrite(async (client) => {
    await client.query(lockDailyVisitorHashSaltsSql);
    const result = await client.query(deleteEndedDailyVisitorHashSaltsSql);
    return result.rowCount ?? 0;
  });
}

export type ProductAnalyticsClientBatchResult = Readonly<{
  storedEventCount: number;
  storedIdentityLinkCount: number;
}>;

// The ingest route's write: one client batch and the identity link the same request carried, in one
// transaction on one connection. Two sequential calls would take two of the pool's four connections
// per authenticated batch and sample the capacity counters twice, which is what widens the window in
// which two callers both pass the assertion; they would also leave a link committed for events that
// then failed to store. A batch redelivered after a failure conflicts on event_id and on the
// (anonymous_id, user_id) pair alike, so retrying the whole write stores nothing twice.
export async function insertProductAnalyticsClientBatch(
  rows: ReadonlyArray<ProductAnalyticsEventRow>,
  identityLink: ProductAnalyticsIdentityLink | null,
  installation: ProductAnalyticsInstallationObservation | null,
): Promise<ProductAnalyticsClientBatchResult> {
  if (rows.length === 0 && identityLink === null && installation === null) {
    return { storedEventCount: 0, storedIdentityLinkCount: 0 };
  }

  for (const row of rows) {
    assertProductAnalyticsRowMatchesCatalog(row);
  }

  return runAnalyticsWrite(async (client) => {
    if (installation !== null) {
      await lockInstallationOwnerInTransaction(client, installation);
    } else {
      // Missing installation metadata must not let a revoked guest persist event locales.
      const guestRow = rows.find((row) => row.authTransport === "guest");
      if (guestRow !== undefined) {
        if (guestRow.userId === null || guestRow.guestSessionId === null) {
          throw new HttpError(401, "Guest session is invalid.", "GUEST_AUTH_INVALID");
        }
        await lockInstallationOwnerInTransaction(client, {
          userId: guestRow.userId,
          guestSessionId: guestRow.guestSessionId,
        });
      }
    }
    const storedEventCount = rows.length === 0
      ? 0
      : await insertEventRowsInTransaction(client, rows);
    const storedIdentityLinkCount = identityLink === null
      ? 0
      : await insertIdentityLinkInTransaction(client, identityLink);
    if (installation !== null) {
      await upsertInstallationProfileInTransaction(client, installation);
      await sampleInstallationCountryInTransaction(client, installation);
    }
    return { storedEventCount, storedIdentityLinkCount };
  });
}

// Returns the number of rows the statement changed: 1 when the link was stored, 1 when an existing
// client-claimed link for the same pair was raised to the server's own observation, and 0 when the
// pair was already recorded at the same or higher trust.
export async function insertProductAnalyticsIdentityLink(
  link: ProductAnalyticsIdentityLink,
): Promise<number> {
  return runAnalyticsWrite((client) => insertIdentityLinkInTransaction(client, link));
}

/**
 * The same statement on the caller's own transaction, for a producer whose link has to commit with
 * the rest of its work instead of separately on the analytics pool.
 *
 * The analytics pool exists so an analytics spike cannot starve product requests of connections,
 * which is a rule about analytics traffic rather than about this table: a caller that already holds
 * a product connection takes no second one by writing here, and takes one fewer than it would by
 * going through the pool. There is likewise no acquisition to time out and no second commit to
 * lose. Only the pool's `SET LOCAL statement_timeout` has no counterpart here, and it is a
 * precondition rather than an omission: the caller must open its transaction under a deadline.
 */
export async function insertProductAnalyticsIdentityLinkInExecutor(
  executor: DatabaseExecutor,
  link: ProductAnalyticsIdentityLink,
): Promise<number> {
  const result = await executor.query(
    insertProductAnalyticsIdentityLinkSql,
    buildIdentityLinkParameters(link),
  );
  return result.rowCount ?? 0;
}
