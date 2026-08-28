import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import pg from "pg";
import { productAnalyticsSchemaVersion } from "./catalog";
import {
  insertProductAnalyticsClientBatch,
  insertProductAnalyticsIdentityLink,
} from "./writer";
import type { ProductAnalyticsEventRow } from "./types";

// The writer builds one multi-row INSERT ... SELECT * FROM unnest($1::uuid[], ... $27::jsonb[], ...)
// and relies on bare-unnest ROWS FROM expansion plus node-postgres array-literal serialization for
// the jsonb[], smallint[] and timestamptz[] parameters. Nothing else in the repository executes SQL,
// so this is the only place that proves the statement runs at all, that a redelivered batch conflicts
// on event_id instead of duplicating, and that the identity link the ingest route writes in the same
// transaction lands without outranking the link a guest upgrade writes for the same pair.

type StoredEventRow = Readonly<{
  event_id: string;
  schema_version: number;
  event_name: string;
  origin: string;
  backfill_id: string | null;
  client_occurred_at: Date | null;
  client_sent_at: Date | null;
  occurred_at: Date;
  user_id: string | null;
  subject_user_id: string | null;
  auth_transport: string | null;
  trust_level: string;
  identity_state: string;
  guest_session_id: string | null;
  workspace_id: string | null;
  anonymous_id: string | null;
  session_id: string | null;
  platform: string | null;
  app_version: string | null;
  os_version: string | null;
  device_model: string | null;
  device_locale: string | null;
  timezone: string | null;
  country: string | null;
  network_state: string | null;
  screen: string | null;
  event_properties: Readonly<Record<string, unknown>>;
  experiment_assignments: Readonly<Record<string, unknown>>;
  request_id: string | null;
  details: Readonly<Record<string, unknown>> | null;
}>;

type StoredIdentityLinkRow = Readonly<{
  anonymous_id: string;
  user_id: string;
  source: string;
}>;

const storedEventColumns = `
  event_id::text AS event_id,
  schema_version,
  event_name,
  origin,
  backfill_id::text AS backfill_id,
  client_occurred_at,
  client_sent_at,
  occurred_at,
  user_id::text AS user_id,
  subject_user_id::text AS subject_user_id,
  auth_transport,
  trust_level,
  identity_state,
  guest_session_id::text AS guest_session_id,
  workspace_id::text AS workspace_id,
  anonymous_id::text AS anonymous_id,
  session_id::text AS session_id,
  platform,
  app_version,
  os_version,
  device_model,
  device_locale,
  timezone,
  country,
  network_state,
  screen,
  event_properties,
  experiment_assignments,
  request_id,
  details
`;

function requireOwnerDatabaseUrl(): string {
  const databaseUrl = process.env.TEST_DATABASE_ADMIN_URL?.trim();
  if (databaseUrl === undefined || databaseUrl === "") {
    throw new Error(
      "TEST_DATABASE_ADMIN_URL is required for the product analytics writer integration test.",
    );
  }

  return databaseUrl;
}

// The contract pins event_id to a UUIDv7, so the fixtures carry the version the route accepts.
function createEventId(): string {
  const candidate = randomUUID();
  return `${candidate.slice(0, 14)}7${candidate.slice(15)}`;
}

const serverReceivedAt = new Date("2026-08-27T10:15:31.000Z");
const clientSentAt = new Date("2026-08-27T10:15:30.500Z");
const requestId = randomUUID();
const userId = randomUUID();
const anonymousId = randomUUID();
const fullyPopulatedEventId = createEventId();
const minimalEventId = createEventId();
const slugPropertyEventId = createEventId();
const redeliveredBatchEventId = createEventId();

// Every optional column carries a value, so the uuid, text, smallint, timestamptz and jsonb casts are
// all exercised with a real value at least once. details is the one exception it cannot make: every
// row in this batch is client-origin, and product_events_details_client_shape requires that column
// to be NULL on exactly those rows.
const fullyPopulatedRow: ProductAnalyticsEventRow = {
  eventId: fullyPopulatedEventId,
  schemaVersion: productAnalyticsSchemaVersion,
  // Carries both an enum and a counter property, so the jsonb cast is exercised with a mixed
  // payload rather than with strings alone.
  eventName: "analytics_events_dropped",
  origin: "client",
  backfillId: null,
  clientOccurredAt: new Date("2026-08-27T10:14:00.000Z"),
  clientSentAt,
  serverReceivedAt,
  occurredAt: new Date("2026-08-27T10:14:00.500Z"),
  userId,
  subjectUserId: userId,
  authTransport: "bearer",
  trustLevel: "authenticated_client",
  guestSessionId: randomUUID(),
  workspaceId: randomUUID(),
  anonymousId,
  sessionId: randomUUID(),
  platform: "ios",
  appVersion: "1.23.0",
  osVersion: "18.2",
  deviceModel: "iPhone15,2",
  deviceLocale: "ru-RU",
  timezone: "Europe/Madrid",
  country: null,
  networkState: "wifi",
  screen: "review",
  eventProperties: { reason: "queue_overflow", count: 12 },
  experimentAssignments: { onboarding_v2: "variant_b", review_order: "interleaved" },
  requestId,
  // details is the one nullable jsonb column, and a client-origin row is exactly the case
  // product_events_details_client_shape requires it to be NULL for.
  details: null,
};

// The mirror image: every optional uuid and text column is NULL and the two non-nullable jsonb
// columns are empty objects, which is the row shape a guest client with no workspace and no device
// context produces.
const minimalRow: ProductAnalyticsEventRow = {
  eventId: minimalEventId,
  schemaVersion: productAnalyticsSchemaVersion,
  eventName: "screen_viewed",
  origin: "client",
  backfillId: null,
  clientOccurredAt: null,
  clientSentAt: null,
  serverReceivedAt,
  occurredAt: new Date("2026-08-27T10:15:00.000Z"),
  userId: null,
  subjectUserId: null,
  authTransport: null,
  trustLevel: "guest_client",
  guestSessionId: null,
  workspaceId: null,
  anonymousId: null,
  sessionId: null,
  platform: null,
  appVersion: null,
  osVersion: null,
  deviceModel: null,
  deviceLocale: null,
  timezone: null,
  country: null,
  networkState: null,
  // screen_viewed declares requiresScreen, so the surface is the one text column that must be present.
  screen: "catalog",
  eventProperties: {},
  experimentAssignments: {},
  requestId: null,
  details: null,
};

const slugPropertyRow: ProductAnalyticsEventRow = {
  eventId: slugPropertyEventId,
  schemaVersion: productAnalyticsSchemaVersion,
  eventName: "catalog_deck_install_started",
  origin: "client",
  backfillId: null,
  clientOccurredAt: new Date("2026-08-27T10:15:20.000Z"),
  clientSentAt,
  serverReceivedAt,
  occurredAt: new Date("2026-08-27T10:15:20.500Z"),
  userId,
  subjectUserId: userId,
  authTransport: "bearer",
  trustLevel: "authenticated_client",
  guestSessionId: null,
  workspaceId: null,
  anonymousId,
  sessionId: null,
  platform: "web",
  appVersion: "1.23.0",
  osVersion: null,
  deviceModel: null,
  deviceLocale: null,
  timezone: null,
  country: null,
  networkState: "offline",
  screen: "catalog",
  eventProperties: { package_slug: "spanish-basics" },
  experimentAssignments: {},
  requestId,
  details: null,
};

const redeliveredBatchRow: ProductAnalyticsEventRow = {
  ...minimalRow,
  eventId: redeliveredBatchEventId,
  eventName: "app_opened",
  screen: null,
  occurredAt: new Date("2026-08-27T10:15:25.000Z"),
  eventProperties: { launch_type: "cold" },
};

test("the product analytics writer stores a batch, dedupes a redelivery, and links an identity", async () => {
  const ownerPool = new pg.Pool({
    connectionString: requireOwnerDatabaseUrl(),
    application_name: "product-analytics-writer-integration-owner",
  });
  const batchEventIds = [
    fullyPopulatedEventId,
    minimalEventId,
    slugPropertyEventId,
    redeliveredBatchEventId,
  ];

  try {
    // The ingest route's own write: the batch and the link the same request carried, in one
    // transaction.
    const storedBatch = await insertProductAnalyticsClientBatch(
      [fullyPopulatedRow, minimalRow, slugPropertyRow],
      {
        linkId: randomUUID(),
        anonymousId,
        userId,
        source: "authenticated_client",
      },
    );
    assert.equal(storedBatch.storedEventCount, 3);
    assert.equal(storedBatch.storedIdentityLinkCount, 1);

    const stored = await ownerPool.query<StoredEventRow>(
      `SELECT ${storedEventColumns}
       FROM analytics.product_events
       WHERE event_id = ANY($1::uuid[])
       ORDER BY occurred_at`,
      [[fullyPopulatedEventId, minimalEventId, slugPropertyEventId]],
    );
    assert.equal(stored.rows.length, 3);

    const [storedFullyPopulated, storedMinimal, storedSlugProperty] = stored.rows;
    assert.equal(storedFullyPopulated?.event_id, fullyPopulatedEventId);
    assert.equal(storedFullyPopulated?.schema_version, productAnalyticsSchemaVersion);
    assert.equal(storedFullyPopulated?.event_name, "analytics_events_dropped");
    assert.equal(storedFullyPopulated?.origin, "client");
    assert.equal(storedFullyPopulated?.trust_level, "authenticated_client");
    // identity_state and ingested_at are owned by the database and are never sent by the writer.
    assert.equal(storedFullyPopulated?.identity_state, "active");
    assert.equal(storedFullyPopulated?.user_id, userId);
    assert.equal(storedFullyPopulated?.anonymous_id, anonymousId);
    assert.equal(storedFullyPopulated?.platform, "ios");
    assert.equal(storedFullyPopulated?.app_version, "1.23.0");
    assert.equal(storedFullyPopulated?.network_state, "wifi");
    assert.equal(storedFullyPopulated?.screen, "review");
    assert.equal(storedFullyPopulated?.country, null);
    assert.equal(storedFullyPopulated?.backfill_id, null);
    assert.equal(
      storedFullyPopulated?.occurred_at.getTime(),
      fullyPopulatedRow.occurredAt.getTime(),
    );
    assert.equal(
      storedFullyPopulated?.client_occurred_at?.getTime(),
      fullyPopulatedRow.clientOccurredAt?.getTime(),
    );
    assert.equal(storedFullyPopulated?.client_sent_at?.getTime(), clientSentAt.getTime());
    // The three jsonb casts are the parameter paths most likely to surprise, so all three columns
    // are read back as values rather than as text. details is the one that carries a NULL element
    // in its jsonb[] parameter, which is the shape every row written today has.
    assert.deepEqual(storedFullyPopulated?.event_properties, {
      reason: "queue_overflow",
      count: 12,
    });
    assert.deepEqual(storedFullyPopulated?.experiment_assignments, {
      onboarding_v2: "variant_b",
      review_order: "interleaved",
    });
    assert.equal(storedFullyPopulated?.details, null);

    assert.equal(storedSlugProperty?.event_id, slugPropertyEventId);
    assert.deepEqual(storedSlugProperty?.event_properties, { package_slug: "spanish-basics" });
    assert.deepEqual(storedSlugProperty?.experiment_assignments, {});
    assert.equal(storedSlugProperty?.os_version, null);
    assert.equal(storedSlugProperty?.session_id, null);

    assert.equal(storedMinimal?.event_id, minimalEventId);
    assert.equal(storedMinimal?.trust_level, "guest_client");
    assert.deepEqual(storedMinimal?.event_properties, {});
    assert.deepEqual(storedMinimal?.experiment_assignments, {});
    assert.equal(storedMinimal?.client_occurred_at, null);
    assert.equal(storedMinimal?.client_sent_at, null);
    assert.equal(storedMinimal?.user_id, null);
    assert.equal(storedMinimal?.subject_user_id, null);
    assert.equal(storedMinimal?.auth_transport, null);
    assert.equal(storedMinimal?.guest_session_id, null);
    assert.equal(storedMinimal?.workspace_id, null);
    assert.equal(storedMinimal?.anonymous_id, null);
    assert.equal(storedMinimal?.session_id, null);
    assert.equal(storedMinimal?.platform, null);
    assert.equal(storedMinimal?.app_version, null);
    assert.equal(storedMinimal?.device_model, null);
    assert.equal(storedMinimal?.device_locale, null);
    assert.equal(storedMinimal?.timezone, null);
    assert.equal(storedMinimal?.network_state, null);
    assert.equal(storedMinimal?.request_id, null);

    // A client that never saw the response redelivers the whole batch, so only the event it added
    // since may be stored, the batch must not raise a primary key violation, and the link it repeats
    // must report no new row instead of conflicting.
    const redelivered = await insertProductAnalyticsClientBatch(
      [fullyPopulatedRow, minimalRow, slugPropertyRow, redeliveredBatchRow],
      {
        linkId: randomUUID(),
        anonymousId,
        userId,
        source: "authenticated_client",
      },
    );
    assert.equal(redelivered.storedEventCount, 1);
    assert.equal(redelivered.storedIdentityLinkCount, 0);

    const afterRedelivery = await ownerPool.query<Readonly<{ count: number }>>(
      `SELECT count(*)::int AS count
       FROM analytics.product_events
       WHERE event_id = ANY($1::uuid[])`,
      [batchEventIds],
    );
    assert.equal(afterRedelivery.rows[0]?.count, 4);

    // A guest upgrade observed the same pair itself, so the conflict raises the stored link to the
    // server's own observation, which is the namespace analytics.product_events_resolved reads.
    assert.equal(
      await insertProductAnalyticsIdentityLink({
        linkId: randomUUID(),
        anonymousId,
        userId,
        source: "server_derived",
      }),
      1,
    );
    // And the ingest route's claim never lowers it back afterwards.
    assert.equal(
      await insertProductAnalyticsIdentityLink({
        linkId: randomUUID(),
        anonymousId,
        userId,
        source: "authenticated_client",
      }),
      0,
    );

    const storedLinks = await ownerPool.query<StoredIdentityLinkRow>(
      `SELECT anonymous_id::text AS anonymous_id, user_id::text AS user_id, source
       FROM analytics.identity_links
       WHERE anonymous_id = $1::uuid`,
      [anonymousId],
    );
    assert.deepEqual(storedLinks.rows, [{
      anonymous_id: anonymousId,
      user_id: userId,
      source: "server_derived",
    }]);
  } finally {
    await ownerPool.query(
      "DELETE FROM analytics.identity_links WHERE anonymous_id = $1::uuid",
      [anonymousId],
    );
    await ownerPool.query(
      "DELETE FROM analytics.product_events WHERE event_id = ANY($1::uuid[])",
      [batchEventIds],
    );
    await ownerPool.end();
  }
});
