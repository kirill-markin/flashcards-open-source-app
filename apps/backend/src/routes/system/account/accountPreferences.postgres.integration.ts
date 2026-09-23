import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import pg from "pg";
import { parseAccountPreferencesInput } from "../support";
import { updateAccountPreferences } from "./accountPreferences";

/**
 * The two stickiness guards, run against real PostgreSQL.
 *
 * Each guard is a three-valued `CASE` over a nullable column, and the branch that matters in both
 * is the one that does nothing: `analytics_consent = 'declined'` is unknown rather than false for a
 * stored NULL, and so would `product_analytics_enabled = FALSE` be, so an account nobody has
 * answered on has to fall through to the write while an account that refused has to keep its
 * answer. Neither reading can be checked against a mock of the update function, which is what the
 * route's unit tests hold, so both are checked here at the module boundary where the SQL runs.
 *
 * Every test seeds both columns with a value, never only the one it writes. The branch that leaves
 * an unnamed column alone is what makes this route backward-compatible with every released client -
 * an animations-only `PATCH` names neither analytics column - and against a NULL seed "left alone"
 * and "written back to NULL" are the same row, so an edit that broke it would pass. With both
 * seeded, breaking it erases a recorded `declined` and a stored `FALSE` and the assertions catch it.
 */
function requireOwnerDatabaseUrl(): string {
  const databaseUrl = process.env.TEST_DATABASE_ADMIN_URL?.trim();
  if (databaseUrl === undefined || databaseUrl === "") {
    throw new Error(
      "TEST_DATABASE_ADMIN_URL is required for the account preferences integration test.",
    );
  }

  return databaseUrl;
}

type StoredAnalyticsPreferencesRow = Readonly<{
  analytics_consent: string | null;
  product_analytics_enabled: boolean | null;
}>;

async function readStoredPreferences(
  ownerPool: pg.Pool,
  userIds: ReadonlyArray<string>,
): Promise<ReadonlyArray<StoredAnalyticsPreferencesRow>> {
  const rows: Array<StoredAnalyticsPreferencesRow> = [];
  for (const userId of userIds) {
    const result = await ownerPool.query<StoredAnalyticsPreferencesRow>(
      "SELECT analytics_consent, product_analytics_enabled FROM org.user_settings WHERE user_id = $1",
      [userId],
    );
    rows.push(result.rows[0] ?? { analytics_consent: null, product_analytics_enabled: null });
  }

  return rows;
}

test("a reconciliation grant cannot overwrite a stored declined and a stored null still takes one", async () => {
  const ownerPool = new pg.Pool({
    connectionString: requireOwnerDatabaseUrl(),
    application_name: "account-preferences-integration-owner",
  });
  const declinedUserId = randomUUID();
  const unansweredUserId = randomUUID();
  const reversedUserId = randomUUID();

  try {
    // The other column is seeded with a value on every row, and a different one per row. Every
    // write below leaves it out, so an implementation that wrote it back as NULL instead of leaving
    // it alone would be indistinguishable from a correct one if it were seeded NULL - and that
    // absent-field branch is the whole backward compatibility of this route: an animations-only
    // PATCH from a released client names neither analytics column.
    await ownerPool.query(
      "INSERT INTO org.user_settings (user_id, analytics_consent, product_analytics_enabled)"
      + " VALUES ($1, 'declined', FALSE), ($2, NULL, TRUE), ($3, 'declined', FALSE)",
      [declinedUserId, unansweredUserId, reversedUserId],
    );

    // A device carrying an answer it read before the withdrawal. Refused, and told so by the row it
    // gets back rather than by a later read.
    const afterReconciliation = await updateAccountPreferences(declinedUserId, {
      reviewReactionAnimationsEnabled: null,
      analyticsConsent: "granted",
      analyticsConsentOrigin: "reconciliation",
      productAnalyticsEnabled: null,
      productAnalyticsEnabledOrigin: "user_action",
    });
    assert.equal(afterReconciliation.analyticsConsent, "declined");

    // The person pressing the control. A withdrawal stays reversible by the thing that took it.
    const afterUserAction = await updateAccountPreferences(reversedUserId, {
      reviewReactionAnimationsEnabled: null,
      analyticsConsent: "granted",
      analyticsConsentOrigin: "user_action",
      productAnalyticsEnabled: null,
      productAnalyticsEnabledOrigin: "user_action",
    });
    assert.equal(afterUserAction.analyticsConsent, "granted");

    // The three-valued case: nobody has answered on this account, so `analytics_consent = 'declined'`
    // is unknown and the guard must not fire. A reconciliation is the only way a device that answered
    // before signing in gets its answer onto an account, so refusing here would lose it silently.
    const afterUnanswered = await updateAccountPreferences(unansweredUserId, {
      reviewReactionAnimationsEnabled: null,
      analyticsConsent: "granted",
      analyticsConsentOrigin: "reconciliation",
      productAnalyticsEnabled: null,
      productAnalyticsEnabledOrigin: "user_action",
    });
    assert.equal(afterUnanswered.analyticsConsent, "granted");

    // Read back through the owner connection too, so the assertions above are about the column and
    // not only about what the route chose to answer with.
    const stored = await readStoredPreferences(
      ownerPool,
      [declinedUserId, reversedUserId, unansweredUserId],
    );
    assert.deepEqual(stored.map((row) => row.analytics_consent), ["declined", "granted", "granted"]);
    // The other column was named by none of those writes and must still hold what it was seeded
    // with, including the stored FALSE that an accidental write-back would have switched to NULL,
    // which reads as on.
    assert.deepEqual(stored.map((row) => row.product_analytics_enabled), [false, false, true]);
  } finally {
    await ownerPool.query("DELETE FROM org.user_settings WHERE user_id = ANY($1::text[])", [
      [declinedUserId, unansweredUserId, reversedUserId],
    ]);
    await ownerPool.end();
  }
});

test("a reconciliation cannot switch product analytics back on and a stored null still takes one", async () => {
  const ownerPool = new pg.Pool({
    connectionString: requireOwnerDatabaseUrl(),
    application_name: "account-preferences-integration-owner",
  });
  const optedOutUserId = randomUUID();
  const unansweredUserId = randomUUID();
  const reversedUserId = randomUUID();

  try {
    // Seeded on the other column too, for the reason given in the first test: a NULL there would
    // let "left alone" and "written back to NULL" look the same.
    await ownerPool.query(
      "INSERT INTO org.user_settings (user_id, analytics_consent, product_analytics_enabled)"
      + " VALUES ($1, 'declined', FALSE), ($2, 'granted', NULL), ($3, 'declined', FALSE)",
      [optedOutUserId, unansweredUserId, reversedUserId],
    );

    // The case this guard exists for: a device carrying a remembered `true` that predates the
    // opt-out. Refused, so collection stays stopped for the credential at ingest.
    const afterReconciliation = await updateAccountPreferences(optedOutUserId, {
      reviewReactionAnimationsEnabled: null,
      analyticsConsent: null,
      analyticsConsentOrigin: "user_action",
      productAnalyticsEnabled: true,
      productAnalyticsEnabledOrigin: "reconciliation",
    });
    assert.equal(afterReconciliation.productAnalyticsEnabled, false);

    // The person moving the switch back. An opt-out stays reversible by the control that took it.
    const afterUserAction = await updateAccountPreferences(reversedUserId, {
      reviewReactionAnimationsEnabled: null,
      analyticsConsent: null,
      analyticsConsentOrigin: "user_action",
      productAnalyticsEnabled: true,
      productAnalyticsEnabledOrigin: "user_action",
    });
    assert.equal(afterUserAction.productAnalyticsEnabled, true);

    // The three-valued case again, on the column where NULL already reads as on: nobody has
    // answered here, so the guard must not fire and the reconciled `true` is stored as the answer
    // it is. Refusing it would leave "never answered" and "answered yes" indistinguishable, which
    // migration 0149 keeps apart on purpose.
    const afterUnanswered = await updateAccountPreferences(unansweredUserId, {
      reviewReactionAnimationsEnabled: null,
      analyticsConsent: null,
      analyticsConsentOrigin: "user_action",
      productAnalyticsEnabled: true,
      productAnalyticsEnabledOrigin: "reconciliation",
    });
    assert.equal(afterUnanswered.productAnalyticsEnabled, true);

    const stored = await readStoredPreferences(
      ownerPool,
      [optedOutUserId, reversedUserId, unansweredUserId],
    );
    assert.deepEqual(stored.map((row) => row.product_analytics_enabled), [false, true, true]);
    // Named by none of those writes, so the recorded cookie answers stand - a write-back to NULL
    // would erase a withdrawal nobody asked to reverse.
    assert.deepEqual(
      stored.map((row) => row.analytics_consent),
      ["declined", "declined", "granted"],
    );
  } finally {
    await ownerPool.query("DELETE FROM org.user_settings WHERE user_id = ANY($1::text[])", [
      [optedOutUserId, unansweredUserId, reversedUserId],
    ]);
    await ownerPool.end();
  }
});

test("a reconciliation still switches product analytics off, and one PATCH carries two origins", async () => {
  const ownerPool = new pg.Pool({
    connectionString: requireOwnerDatabaseUrl(),
    application_name: "account-preferences-integration-owner",
  });
  const optedInUserId = randomUUID();
  const mixedOriginUserId = randomUUID();

  try {
    await ownerPool.query(
      "INSERT INTO org.user_settings (user_id, analytics_consent, product_analytics_enabled)"
      + " VALUES ($1, 'granted', TRUE), ($2, 'declined', TRUE)",
      [optedInUserId, mixedOriginUserId],
    );

    // Only the direction that resumes collection is guarded. A reconciled `false` is the
    // under-collecting direction and is stored, because a stale opt-out costs rows rather than
    // collecting rows nobody allowed.
    const afterReconciledOptOut = await updateAccountPreferences(optedInUserId, {
      reviewReactionAnimationsEnabled: null,
      analyticsConsent: null,
      analyticsConsentOrigin: "user_action",
      productAnalyticsEnabled: false,
      productAnalyticsEnabledOrigin: "reconciliation",
    });
    assert.equal(afterReconciledOptOut.productAnalyticsEnabled, false);

    // Why the origin is per column rather than per body: one PATCH carries a person's press on the
    // switch and a reconciled consent, and each is decided on its own origin. A single shared
    // origin would have to refuse one of the two.
    const afterMixedOrigins = await updateAccountPreferences(mixedOriginUserId, {
      reviewReactionAnimationsEnabled: null,
      analyticsConsent: "granted",
      analyticsConsentOrigin: "reconciliation",
      productAnalyticsEnabled: true,
      productAnalyticsEnabledOrigin: "user_action",
    });
    assert.equal(afterMixedOrigins.analyticsConsent, "declined");
    assert.equal(afterMixedOrigins.productAnalyticsEnabled, true);

    const stored = await readStoredPreferences(ownerPool, [optedInUserId, mixedOriginUserId]);
    assert.deepEqual(stored, [
      // The consent column is named by neither write on this row and keeps its stored answer.
      { analytics_consent: "granted", product_analytics_enabled: false },
      { analytics_consent: "declined", product_analytics_enabled: true },
    ]);
  } finally {
    await ownerPool.query("DELETE FROM org.user_settings WHERE user_id = ANY($1::text[])", [
      [optedInUserId, mixedOriginUserId],
    ]);
    await ownerPool.end();
  }
});

/**
 * The two bodies a mobile client can put on the wire for one owed answer, parsed from raw JSON and
 * run through the same write, because the pair is what both clients' new refusal branches rest on.
 *
 * `parseAccountPreferencesInput` is in the path rather than a hand-built update: the origin default
 * lives there, and the whole backward-compatibility claim is that a body which names no origin
 * writes as a person's. A check that passed the field explicitly would never touch that default.
 */
test("the mobile bodies for one owed answer: refused as a reconciliation, stored without an origin", async () => {
  const ownerPool = new pg.Pool({
    connectionString: requireOwnerDatabaseUrl(),
    application_name: "account-preferences-integration-owner",
  });
  const refusedUserId = randomUUID();
  const originlessUserId = randomUUID();

  try {
    await ownerPool.query(
      "INSERT INTO org.user_settings (user_id, analytics_consent, product_analytics_enabled)"
      + " VALUES ($1, 'granted', FALSE), ($2, 'granted', FALSE)",
      [refusedUserId, originlessUserId],
    );

    // Exactly what a retry of an owed opt-in sends: the one column and its origin, nothing else.
    // The response has to repeat the stored FALSE explicitly, because that is the only signal
    // either client has that the guard fired - both read the refusal off `productAnalyticsEnabled`
    // being an explicit `false` beside an owed `true`, and neither can tell an absent field from a
    // refusal.
    const afterRefusedReconciliation = await updateAccountPreferences(
      refusedUserId,
      parseAccountPreferencesInput({
        productAnalyticsEnabled: true,
        productAnalyticsEnabledOrigin: "reconciliation",
      }),
    );
    assert.equal(afterRefusedReconciliation.productAnalyticsEnabled, false);

    // The same body with the origin dropped, which is what every already-released client sends. It
    // must be written as the person's answer, or this route would start refusing presses that were
    // stored before the field existed.
    const afterOriginlessBody = await updateAccountPreferences(
      originlessUserId,
      parseAccountPreferencesInput({ productAnalyticsEnabled: true }),
    );
    assert.equal(afterOriginlessBody.productAnalyticsEnabled, true);

    const stored = await readStoredPreferences(ownerPool, [refusedUserId, originlessUserId]);
    assert.deepEqual(stored, [
      // Neither body named the cookie column, so both rows keep the answer they were seeded with.
      { analytics_consent: "granted", product_analytics_enabled: false },
      { analytics_consent: "granted", product_analytics_enabled: true },
    ]);
  } finally {
    await ownerPool.query("DELETE FROM org.user_settings WHERE user_id = ANY($1::text[])", [
      [refusedUserId, originlessUserId],
    ]);
    await ownerPool.end();
  }
});
