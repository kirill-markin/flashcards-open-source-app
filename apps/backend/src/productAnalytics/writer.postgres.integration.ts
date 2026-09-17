import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import pg from "pg";
import { productAnalyticsSchemaVersion } from "./catalog";
import { retainRecentCountryObservations } from "./countryRetention";
import { storeFeedbackSubmissionForUser } from "../feedback/store";
import {
  insertProductAnalyticsClientBatch,
  insertProductAnalyticsIdentityLink,
} from "./writer";
import type { ProductAnalyticsEventRow, ProductAnalyticsInstallationObservation } from "./types";

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
  ui_locale: string | null;
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

type StoredInstallationRow = Readonly<{
  user_id: string;
  app_version: string | null;
  os_version: string | null;
  device_locale: string | null;
  timezone: string | null;
  first_seen: Date;
  last_seen: Date;
}>;

async function loadStoredInstallation(
  pool: pg.Pool,
  installation: ProductAnalyticsInstallationObservation,
): Promise<StoredInstallationRow | undefined> {
  const result = await pool.query<StoredInstallationRow>(
    `SELECT user_id::text, app_version, os_version, device_locale, timezone, first_seen, last_seen
     FROM analytics.installation_profiles WHERE anonymous_id = $1::uuid AND platform = $2`,
    [installation.anonymousId, installation.platform],
  );
  return result.rows[0];
}

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
  ui_locale,
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
  uiLocale: "ru-RU",
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
  uiLocale: null,
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
  uiLocale: null,
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
  const installation: ProductAnalyticsInstallationObservation = {
    anonymousId,
    platform: "ios",
    userId,
    guestSessionId: null,
    appVersion: "1.23.0",
    context: {
      osVersion: "18.2",
      deviceModel: "iPhone15,2",
      deviceLocale: "ru-RU",
      timezone: "Europe/Madrid",
    },
    observedAt: serverReceivedAt,
    countryLookup: null,
  };
  const guestUserId = randomUUID();
  const guestInstallation: ProductAnalyticsInstallationObservation = {
    ...installation,
    anonymousId: randomUUID(),
    userId: guestUserId,
    guestSessionId: randomUUID(),
  };
  const guestRow: ProductAnalyticsEventRow = {
    ...fullyPopulatedRow,
    eventId: createEventId(),
    userId: guestUserId,
    subjectUserId: guestUserId,
    authTransport: "guest",
    trustLevel: "guest_client",
    guestSessionId: guestInstallation.guestSessionId,
    anonymousId: guestInstallation.anonymousId,
  };
  const delayedGuestRow = { ...guestRow, eventId: createEventId() };
  batchEventIds.push(guestRow.eventId, delayedGuestRow.eventId);

  try {
    await ownerPool.query("INSERT INTO org.user_settings (user_id) VALUES ($1), ($2)", [userId, guestUserId]);
    const storedBatch = await insertProductAnalyticsClientBatch(
      [fullyPopulatedRow, minimalRow, slugPropertyRow],
      {
        linkId: randomUUID(),
        anonymousId,
        userId,
        source: "authenticated_client",
      },
      installation,
    );
    assert.equal(storedBatch.storedEventCount, 3);
    assert.equal(storedBatch.storedIdentityLinkCount, 1);
    const createdInstallation = await loadStoredInstallation(ownerPool, installation);
    assert.deepEqual(createdInstallation, {
      user_id: userId,
      app_version: "1.23.0",
      os_version: "18.2",
      device_locale: "ru-RU",
      timezone: "Europe/Madrid",
      first_seen: serverReceivedAt,
      last_seen: serverReceivedAt,
    });

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
    assert.equal(storedFullyPopulated?.ui_locale, "ru-RU");
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
    assert.equal(storedMinimal?.ui_locale, null);
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
      { ...installation, observedAt: new Date(serverReceivedAt.getTime() + 60_000) },
    );
    assert.equal(redelivered.storedEventCount, 1);
    assert.equal(redelivered.storedIdentityLinkCount, 0);
    assert.deepEqual(await loadStoredInstallation(ownerPool, installation), createdInstallation);

    const changedInstallation: ProductAnalyticsInstallationObservation = {
      ...installation,
      appVersion: "1.24.0",
      context: { ...installation.context, osVersion: "18.3", deviceLocale: "en-GB", timezone: null },
      observedAt: new Date(serverReceivedAt.getTime() + 120_000),
    };
    await insertProductAnalyticsClientBatch([fullyPopulatedRow], null, changedInstallation);
    assert.deepEqual(await loadStoredInstallation(ownerPool, installation), {
      ...createdInstallation,
      app_version: "1.24.0",
      os_version: "18.3",
      device_locale: "en-GB",
      timezone: null,
      last_seen: changedInstallation.observedAt,
    });

    const hourlyInstallation = {
      ...changedInstallation,
      observedAt: new Date(changedInstallation.observedAt.getTime() + 3_600_000),
    };
    await insertProductAnalyticsClientBatch([fullyPopulatedRow], null, hourlyInstallation);
    const afterHour = await loadStoredInstallation(ownerPool, installation);
    assert.equal(afterHour?.last_seen.getTime(), hourlyInstallation.observedAt.getTime());
    assert.equal(afterHour?.first_seen.getTime(), serverReceivedAt.getTime());

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

    await ownerPool.query(
      `INSERT INTO auth.guest_sessions (session_id, session_secret_hash, user_id, platform)
       VALUES ($1::uuid, $2, $3, 'ios')`,
      [guestInstallation.guestSessionId, randomUUID(), guestUserId],
    );
    await insertProductAnalyticsClientBatch([guestRow], null, guestInstallation);
    assert.equal((await loadStoredInstallation(ownerPool, guestInstallation))?.user_id, guestUserId);

    // State left by analytics linking and account cleanup: the guest still exists, but its
    // credential is revoked and the profile has been removed. The delayed upload was already
    // authenticated, so only the writer's transactional recheck can stop it recreating that data.
    await ownerPool.query(
      "UPDATE auth.guest_sessions SET revoked_at = now() WHERE session_id = $1::uuid",
      [guestInstallation.guestSessionId],
    );
    await ownerPool.query(
      "DELETE FROM analytics.installation_profiles WHERE anonymous_id = $1::uuid",
      [guestInstallation.anonymousId],
    );
    for (const delayedInstallation of [guestInstallation, null]) {
      await assert.rejects(
        insertProductAnalyticsClientBatch([delayedGuestRow], null, delayedInstallation),
        { code: "GUEST_AUTH_INVALID" },
      );
    }
    assert.equal(await loadStoredInstallation(ownerPool, guestInstallation), undefined);
    const rejectedEvent = await ownerPool.query(
      "SELECT event_id FROM analytics.product_events WHERE event_id = $1::uuid",
      [delayedGuestRow.eventId],
    );
    assert.equal(rejectedEvent.rowCount, 0);
  } finally {
    await ownerPool.query(
      "DELETE FROM analytics.installation_profiles WHERE anonymous_id = ANY($1::uuid[])",
      [[anonymousId, guestInstallation.anonymousId]],
    );
    await ownerPool.query(
      "DELETE FROM analytics.identity_links WHERE anonymous_id = $1::uuid",
      [anonymousId],
    );
    await ownerPool.query(
      "DELETE FROM analytics.product_events WHERE event_id = ANY($1::uuid[])",
      [batchEventIds],
    );
    await ownerPool.query("DELETE FROM org.user_settings WHERE user_id = ANY($1::text[])", [[userId, guestUserId]]);
    await ownerPool.end();
  }
});

test("country periods dedupe concurrent days, retain first known country, and expire without changing queued events", async () => {
  const ownerPool = new pg.Pool({ connectionString: requireOwnerDatabaseUrl() });
  const countryUserId = randomUUID();
  const installationId = randomUUID();
  const eventId = createEventId();
  const feedbackId = randomUUID();
  const day = 86_400_000;
  const startedAt = new Date("2026-01-01T23:59:59.000Z");
  const installation: ProductAnalyticsInstallationObservation = {
    anonymousId: installationId, platform: "ios", userId: countryUserId, guestSessionId: null,
    appVersion: "1.23.0",
    context: { osVersion: "18.2", deviceModel: null, deviceLocale: "ru-RU", timezone: "Europe/Madrid" },
    observedAt: startedAt, countryLookup: async () => null,
  };
  const event: ProductAnalyticsEventRow = {
    ...minimalRow, eventId, userId: countryUserId, subjectUserId: countryUserId,
    anonymousId: installationId, country: null, uiLocale: "ru",
  };
  const writeSample = async (offset: number, country: string | null): Promise<void> => {
    await insertProductAnalyticsClientBatch([event], null, {
      ...installation, observedAt: new Date(startedAt.getTime() + offset), countryLookup: async () => country,
    });
  };
  const loadPeriods = async (): Promise<ReadonlyArray<Readonly<{
    country: string | null; first_seen: Date; last_seen: Date; sampled_at: Date;
  }>>> => (await ownerPool.query<Readonly<{
    country: string | null; first_seen: Date; last_seen: Date; sampled_at: Date;
  }>>(
    `SELECT country, first_seen, last_seen, sampled_at FROM analytics.installation_country_observations
     WHERE anonymous_id = $1::uuid ORDER BY first_seen`, [installationId],
  )).rows;
  try {
    await ownerPool.query("INSERT INTO org.user_settings (user_id) VALUES ($1)", [countryUserId]);
    await insertProductAnalyticsClientBatch([event], null, installation);
    // UTC midnight is a new sample day even when the requests are two seconds apart.
    let lookups = 0;
    const concurrentSample = {
      ...installation,
      observedAt: new Date(startedAt.getTime() + 2_000),
      countryLookup: async (): Promise<string> => { lookups += 1; return "ES"; },
    };
    await Promise.all([
      insertProductAnalyticsClientBatch([event], null, concurrentSample),
      insertProductAnalyticsClientBatch([event], null, concurrentSample),
    ]);
    assert.equal(lookups, 1);
    await writeSample(3_000, "FR");
    assert.deepEqual((await loadPeriods()).map((row) => row.country), [null, "ES"]);
    await writeSample(2 * day, "ES");
    const unchanged = await loadPeriods();
    assert.equal(unchanged.length, 2);
    assert.equal(unchanged[1]?.first_seen.toISOString(), concurrentSample.observedAt.toISOString());
    assert.equal(unchanged[1]?.last_seen.getTime(), startedAt.getTime() + 2 * day);
    await writeSample(3 * day, "FR");
    await writeSample(4 * day, null);
    assert.deepEqual((await loadPeriods()).map((row) => row.country), [null, "ES", "FR", null]);
    await assert.rejects(insertProductAnalyticsClientBatch([event], null, {
      ...installation, observedAt: new Date(startedAt.getTime() + 5 * day),
      countryLookup: async () => { throw new Error("Country database unavailable"); },
    }), /Country database unavailable/);
    assert.equal((await loadPeriods()).length, 4);
    const sampledProfile = await ownerPool.query<Readonly<{
      first_country: string; first_country_sampled_at: Date; country_sampled_at: Date;
    }>>(
      `SELECT first_country, first_country_sampled_at, country_sampled_at
       FROM analytics.installation_profiles WHERE anonymous_id = $1::uuid`, [installationId],
    );
    assert.deepEqual(sampledProfile.rows[0], {
      first_country: "ES", first_country_sampled_at: concurrentSample.observedAt,
      country_sampled_at: new Date(startedAt.getTime() + 4 * day),
    });
    // Resuming the same country after expiry starts a fresh period before cleanup has run.
    await writeSample(95 * day, null);
    assert.equal((await loadPeriods()).length, 5);
    const retention = await retainRecentCountryObservations(new Date(startedAt.getTime() + 95 * day), Date.now() + 20_000);
    assert.equal(retention.finished, true);
    assert.equal((await loadPeriods()).length, 1);
    assert.equal((await loadPeriods())[0]?.first_seen.getTime(), startedAt.getTime() + 95 * day);
    const firstCountry = await ownerPool.query<{ first_country: string }>(
      "SELECT first_country FROM analytics.installation_profiles WHERE anonymous_id = $1::uuid", [installationId],
    );
    assert.equal(firstCountry.rows[0]?.first_country, "ES");
    const queuedEvent = await ownerPool.query<{ country: string | null; ui_locale: string }>(
      "SELECT country, ui_locale FROM analytics.product_events WHERE event_id = $1::uuid", [eventId],
    );
    assert.deepEqual(queuedEvent.rows, [{ country: null, ui_locale: "ru" }]);

    const feedback = {
      feedbackSubmissionId: feedbackId, workspaceId: null, installationId: null, platform: "ios" as const,
      appVersion: "1.23.0", locale: "ru", timezone: "Europe/Madrid", trigger: "settings" as const,
      message: "Integration feedback", createdAtClient: startedAt.toISOString(),
    };
    await storeFeedbackSubmissionForUser(countryUserId, null, feedback);
    await storeFeedbackSubmissionForUser(countryUserId, null, { ...feedback, locale: "fr" });
    const storedFeedback = await ownerPool.query<{ locale: string; country: string | null }>(
      "SELECT locale, country FROM support.feedback_submissions WHERE feedback_submission_id = $1::uuid", [feedbackId],
    );
    assert.deepEqual(storedFeedback.rows, [{ locale: "ru", country: null }]);
    await ownerPool.query("DELETE FROM analytics.installation_profiles WHERE anonymous_id = $1::uuid", [installationId]);
    assert.equal((await loadPeriods()).length, 0);
    await ownerPool.query("DELETE FROM org.user_settings WHERE user_id = $1", [countryUserId]);
    assert.equal((await ownerPool.query(
      "SELECT 1 FROM support.feedback_submissions WHERE feedback_submission_id = $1::uuid", [feedbackId],
    )).rowCount, 0);
  } finally {
    await ownerPool.query("DELETE FROM analytics.installation_profiles WHERE anonymous_id = $1::uuid", [installationId]);
    await ownerPool.query("DELETE FROM analytics.product_events WHERE event_id = $1::uuid", [eventId]);
    await ownerPool.query("DELETE FROM org.user_settings WHERE user_id = $1", [countryUserId]);
    await ownerPool.end();
  }
});
