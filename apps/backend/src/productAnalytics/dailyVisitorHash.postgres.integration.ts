import assert from "node:assert/strict";
import { randomBytes, randomUUID } from "node:crypto";
import test from "node:test";
import pg from "pg";
import { parseAnonymousEvent } from "./anonymousEvent";
import { isAutomatedUserAgent } from "./automatedClient";
import { computeDailyVisitorHash, resolveDailyVisitorHash } from "./dailyVisitorHash";
import { deleteEndedDailyVisitorHashSalts, insertAnonymousProductAnalyticsEvent } from "./writer";

type SaltRow = Readonly<{
  utc_day: string;
  salt: Buffer;
}>;

type StoredHashRow = Readonly<{
  event_id: string;
  daily_visitor_hash: string | null;
}>;

type StoredAutomatedClientRow = Readonly<{
  event_id: string;
  automated_client: boolean | null;
}>;

function requireOwnerDatabaseUrl(): string {
  const databaseUrl = process.env.TEST_DATABASE_ADMIN_URL?.trim();
  if (databaseUrl === undefined || databaseUrl === "") {
    throw new Error(
      "TEST_DATABASE_ADMIN_URL is required for the daily visitor hash integration test.",
    );
  }

  return databaseUrl;
}

// The contract pins event_id to a UUIDv7, so the fixtures carry the version the route accepts.
function createEventId(): string {
  const candidate = randomUUID();
  return `${candidate.slice(0, 14)}7${candidate.slice(15)}`;
}

async function readSalts(pool: pg.Pool): Promise<ReadonlyArray<SaltRow>> {
  const result = await pool.query<SaltRow>(
    "SELECT utc_day::text AS utc_day, salt FROM analytics.daily_visitor_hash_salts ORDER BY utc_day",
  );
  return result.rows;
}

function createCollectorBody(eventId: string, eventName: string, properties: object, sentAt: string): object {
  return {
    eventId,
    eventName,
    clientOccurredAt: sentAt,
    clientSentAt: sentAt,
    properties,
  };
}

test("a cookieless collector row stores a daily visitor hash and a consent row does not", async () => {
  const ownerPool = new pg.Pool({
    connectionString: requireOwnerDatabaseUrl(),
    application_name: "daily-visitor-hash-integration-owner",
  });
  const serverReceivedAt = new Date();
  const sentAt = serverReceivedAt.toISOString();
  const utcDay = sentAt.slice(0, 10);
  const earlierUtcDay = "2026-01-01";
  const endedReceivedAt = new Date(serverReceivedAt.getTime() - 86_400_000);
  const endedUtcDay = endedReceivedAt.toISOString().slice(0, 10);
  const inputs = { sourceIp: "203.0.113.7", userAgent: "Mozilla/5.0 (integration)" };
  const pageViewRow = parseAnonymousEvent(
    createCollectorBody(
      createEventId(),
      "site_page_viewed",
      { page_kind: "home", source: "direct", device_category: "desktop" },
      sentAt,
    ),
    serverReceivedAt,
    randomUUID(),
  );
  const consentRow = parseAnonymousEvent(
    createCollectorBody(createEventId(), "consent_granted", {}, sentAt),
    serverReceivedAt,
    randomUUID(),
  );
  const endedDayRow = parseAnonymousEvent(
    createCollectorBody(
      createEventId(),
      "site_page_viewed",
      { page_kind: "home", source: "direct", device_category: "desktop" },
      endedReceivedAt.toISOString(),
    ),
    endedReceivedAt,
    randomUUID(),
  );
  const eventIds = [pageViewRow.eventId, consentRow.eventId];

  try {
    await ownerPool.query(
      "INSERT INTO analytics.daily_visitor_hash_salts (utc_day, salt) VALUES ($1::date, $2::bytea)",
      [earlierUtcDay, randomBytes(32)],
    );

    const pageViewHash = await resolveDailyVisitorHash(pageViewRow, inputs);
    const consentHash = await resolveDailyVisitorHash(consentRow, inputs);
    assert.ok(pageViewHash !== null);
    assert.equal(consentHash, null);
    const automatedClient = isAutomatedUserAgent(inputs.userAgent);
    assert.equal(
      await insertAnonymousProductAnalyticsEvent({ ...pageViewRow, dailyVisitorHash: pageViewHash, automatedClient }),
      1,
    );
    assert.equal(
      await insertAnonymousProductAnalyticsEvent({ ...consentRow, dailyVisitorHash: consentHash, automatedClient }),
      1,
    );

    const salts = await readSalts(ownerPool);
    // Resolving today's salt deleted the earlier day's, so no hash from that day can be recomputed.
    assert.deepEqual(salts.map((row) => row.utc_day), [utcDay]);
    const todaySalt = salts[0]?.salt;
    assert.ok(todaySalt !== undefined);

    const stored = await ownerPool.query<StoredHashRow>(
      `SELECT event_id::text AS event_id, daily_visitor_hash
       FROM analytics.product_events_resolved
       WHERE event_id = ANY($1::uuid[])`,
      [eventIds],
    );
    const storedByEventId = new Map(stored.rows.map((row) => [row.event_id, row.daily_visitor_hash]));
    assert.equal(
      storedByEventId.get(pageViewRow.eventId),
      computeDailyVisitorHash(todaySalt, inputs.sourceIp, inputs.userAgent),
    );
    assert.match(storedByEventId.get(pageViewRow.eventId) ?? "", /^[0-9a-f]{32}$/u);
    assert.equal(storedByEventId.get(consentRow.eventId), null);

    // The database refuses the hash on a consent fact whatever the writer computed.
    await assert.rejects(
      insertAnonymousProductAnalyticsEvent({
        ...consentRow,
        eventId: createEventId(),
        dailyVisitorHash: pageViewHash,
        automatedClient,
      }),
      { code: "23514", constraint: "product_events_daily_visitor_hash_shape" },
    );

    // A late event stamped on a day that has already ended gets no hash and recreates no salt.
    assert.equal(await resolveDailyVisitorHash(endedDayRow, inputs), null);
    assert.deepEqual((await readSalts(ownerPool)).map((row) => row.utc_day), [utcDay]);

    // The scheduled expiry deletes an ended day's salt without any request, and keeps today's.
    await ownerPool.query(
      "INSERT INTO analytics.daily_visitor_hash_salts (utc_day, salt) VALUES ($1::date, $2::bytea)",
      [earlierUtcDay, randomBytes(32)],
    );
    assert.equal(await deleteEndedDailyVisitorHashSalts(), 1);
    assert.deepEqual((await readSalts(ownerPool)).map((row) => row.utc_day), [utcDay]);
  } finally {
    await ownerPool.query("DELETE FROM analytics.product_events WHERE event_id = ANY($1::uuid[])", [eventIds]);
    await ownerPool.query(
      "DELETE FROM analytics.daily_visitor_hash_salts WHERE utc_day IN ($1::date, $2::date, $3::date)",
      [earlierUtcDay, endedUtcDay, utcDay],
    );
    await ownerPool.end();
  }
});

// The second column only the credential-free collector writes; contract in
// db/migrations/0145_anonymous_client_automated_marker.sql.
test("a collector row records whether the reporting request announced itself as automated", async () => {
  const ownerPool = new pg.Pool({
    connectionString: requireOwnerDatabaseUrl(),
    application_name: "automated-client-integration-owner",
  });
  const serverReceivedAt = new Date();
  const sentAt = serverReceivedAt.toISOString();
  const headlessUserAgent =
    "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) HeadlessChrome/140.0.0.0 Safari/537.36";
  const browserUserAgent =
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36";
  // A real handset brand whose model name carries the "bot" marker: a person, and a verdict this
  // append-only table could never correct.
  const collidingDeviceUserAgent =
    "Mozilla/5.0 (Linux; Android 13; CUBOT NOTE 30) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Mobile Safari/537.36";
  const pageViewProperties = { page_kind: "home", source: "direct", device_category: "desktop" };
  const headlessRow = parseAnonymousEvent(
    createCollectorBody(createEventId(), "site_page_viewed", pageViewProperties, sentAt),
    serverReceivedAt,
    randomUUID(),
  );
  const browserRow = parseAnonymousEvent(
    createCollectorBody(createEventId(), "site_page_viewed", pageViewProperties, sentAt),
    serverReceivedAt,
    randomUUID(),
  );
  const collidingDeviceRow = parseAnonymousEvent(
    createCollectorBody(createEventId(), "site_page_viewed", pageViewProperties, sentAt),
    serverReceivedAt,
    randomUUID(),
  );
  const eventIds = [headlessRow.eventId, browserRow.eventId, collidingDeviceRow.eventId];

  try {
    assert.equal(
      await insertAnonymousProductAnalyticsEvent({
        ...headlessRow,
        dailyVisitorHash: null,
        automatedClient: isAutomatedUserAgent(headlessUserAgent),
      }),
      1,
    );
    assert.equal(
      await insertAnonymousProductAnalyticsEvent({
        ...browserRow,
        dailyVisitorHash: null,
        automatedClient: isAutomatedUserAgent(browserUserAgent),
      }),
      1,
    );
    assert.equal(
      await insertAnonymousProductAnalyticsEvent({
        ...collidingDeviceRow,
        dailyVisitorHash: null,
        automatedClient: isAutomatedUserAgent(collidingDeviceUserAgent),
      }),
      1,
    );

    const stored = await ownerPool.query<StoredAutomatedClientRow>(
      `SELECT event_id::text AS event_id, automated_client
       FROM analytics.product_events_resolved
       WHERE event_id = ANY($1::uuid[])`,
      [eventIds],
    );
    const storedByEventId = new Map(stored.rows.map((row) => [row.event_id, row.automated_client]));
    assert.equal(storedByEventId.get(headlessRow.eventId), true);
    assert.equal(storedByEventId.get(browserRow.eventId), false);
    assert.equal(storedByEventId.get(collidingDeviceRow.eventId), false);
  } finally {
    await ownerPool.query("DELETE FROM analytics.product_events WHERE event_id = ANY($1::uuid[])", [eventIds]);
    await ownerPool.end();
  }
});
