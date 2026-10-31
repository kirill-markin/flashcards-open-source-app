import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import test from "node:test";
import { Hono } from "hono";
import type pg from "pg";
import type { DatabaseExecutor, SqlValue } from "../database";
import { createSyncRoutes } from "../routes/sync";
import type { AppEnv } from "../server/app";
import type { RequestContext } from "../server/requestContext";
import {
  withPostgresIntegrationFixture,
  type PostgresIntegrationFixture,
} from "../testSupport/postgresIntegration";
import { createWebGuestEverPurchasedGuardSql } from "../guestAuth/reaper";
import {
  anonymizeBillingForDeletedPersonInExecutor,
  transferBillingToUpgradedAccountInExecutor,
  resolveBillingOwnerInExecutor,
} from "./identity";
import { lockPurchase } from "./apple/store";
import { lockGooglePurchaseOwners, readGooglePurchase } from "./google/store";
import { findStripeCustomerIdentityInExecutor, listStripeCustomerIdentitiesInExecutor,
  getStripeAccountTrialEligibilityInExecutor, hasStripeTrialConsumptionInExecutor, loadStripeCheckoutAttemptInExecutor,
  reserveStripeCheckoutAttemptInExecutor } from "./stripe/identityStore";
import { loadEntitlementResolutionInputsInExecutor } from "./store";
import { resolveEntitlement } from "./resolver";
import {
  resolveEntitlementSnapshotForUser,
  type EntitlementWire,
} from "./snapshot";

type EntitlementSnapshotStateRow = Readonly<{
  tier: string;
  status: string;
  source: string;
  until: Date | null;
  is_trial: boolean;
  will_renew: boolean;
  computed_at: string;
}>;

type PurchaseUntilRow = Readonly<{
  until: Date;
}>;

type ProductEventCountRow = Readonly<{
  count: string;
}>;

// One stored billing fact as an analytics reader sees it, ordered by the clock the resolution that
// produced it used.
type BillingProductEventRow = Readonly<{
  event_name: string;
  origin: string;
  trust_level: string;
  platform: string | null;
  screen: string | null;
  subject_user_id: string | null;
  event_properties: Readonly<Record<string, string>>;
}>;

// The route omits the field when the entitlement could not be resolved, so the body cannot promise it.
type SyncPullResponseBody = Readonly<{
  entitlement?: EntitlementWire;
}>;

const billingProductEventsQuery = [
  "SELECT event_name, origin, trust_level, platform, screen, subject_user_id::text AS subject_user_id,",
  "event_properties",
  "FROM analytics.product_events",
  "WHERE user_id = $1::uuid",
  "ORDER BY occurred_at",
].join(" ");

const entitlementSnapshotStateQuery = [
  "SELECT tier, status, source, until, is_trial, will_renew, computed_at::text AS computed_at",
  "FROM billing.entitlement_snapshots",
  "WHERE user_id = $1",
].join(" ");

const stripeRegionalCheckoutMigrationSql = readFileSync(resolve(
  __dirname, "../../../../db/migrations/0234_stripe_regional_checkout.sql",
), "utf8");

function createSyncPullApp(userId: string, workspaceId: string): Hono<AppEnv> {
  const requestContext: RequestContext = {
    userId,
    subjectUserId: userId,
    selectedWorkspaceId: workspaceId,
    email: `${userId}@example.com`,
    locale: "en",
    userSettingsCreatedAt: "2026-01-01T00:00:00.000Z",
    preferences: {
      accentColor: "#FF6719",
      reviewReactionAnimationsEnabled: true,
      firstReviewOnboardingCompleted: false,
      analyticsConsent: null,
      productAnalyticsEnabled: null,
    },
    transport: "bearer",
    connectionId: null,
    guestSessionId: null,
    guestPlatform: null,
  };
  const app = new Hono<AppEnv>();
  app.use("*", async (context, next) => {
    context.set("requestId", randomUUID());
    context.set("clientAppVersion", null);
    context.set("clientPlatform", null);
    await next();
  });
  app.route("/", createSyncRoutes({
    allowedOrigins: [],
    loadRequestContextFromRequestFn: async () => ({
      requestAuthInputs: {
        authorizationHeader: undefined,
        sessionToken: undefined,
        csrfTokenHeader: undefined,
        originHeader: undefined,
        refererHeader: undefined,
        secFetchSiteHeader: undefined,
      },
      requestContext,
    }),
  }));
  return app;
}

async function pullEntitlement(
  app: Hono<AppEnv>,
  workspaceId: string,
  installationId: string,
): Promise<EntitlementWire> {
  const response = await app.request(
    `http://localhost/workspaces/${workspaceId}/sync/pull`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        installationId,
        platform: "web",
        appVersion: "1.0.0",
        afterHotChangeId: 0,
        limit: 100,
      }),
    },
  );
  const responseBody = await response.text();
  assert.equal(response.status, 200, responseBody);
  const entitlement = (JSON.parse(responseBody) as SyncPullResponseBody).entitlement;
  if (entitlement === undefined) {
    throw new Error(`The sync pull response omitted the entitlement: ${responseBody}`);
  }

  return entitlement;
}

test("a person without purchases or grants resolves to the free tier and is cached once", async () => {
  await withPostgresIntegrationFixture(async (fixture) => {
    try {
      const firstResolution = await resolveEntitlementSnapshotForUser(
        fixture.userId,
        "account",
        new Date("2026-09-01T00:00:00.000Z"),
      );
      assert.deepEqual(firstResolution, {
        tier: "free",
        tierRank: 10,
        tierDisplayName: "Free",
        status: "none",
        until: null,
        isTrial: false,
        willRenew: false,
        limits: { aiMonthlyMessages: 50, aiMonthlyWeightedTokens: null },
      });

      const cachedAfterFirst = await fixture.ownerPool.query<EntitlementSnapshotStateRow>(
        entitlementSnapshotStateQuery,
        [fixture.userId],
      );
      assert.equal(cachedAfterFirst.rows.length, 1);
      assert.equal(cachedAfterFirst.rows[0]?.tier, "free");
      assert.equal(cachedAfterFirst.rows[0]?.status, "none");
      assert.equal(cachedAfterFirst.rows[0]?.source, "none");
      assert.equal(cachedAfterFirst.rows[0]?.until, null);
      assert.equal(cachedAfterFirst.rows[0]?.is_trial, false);
      assert.equal(cachedAfterFirst.rows[0]?.will_renew, false);

      // Resolving again with a later clock must not rewrite an unchanged entitlement, which is what
      // keeps the hot sync path free of a write per request.
      await resolveEntitlementSnapshotForUser(
        fixture.userId,
        "account",
        new Date("2026-09-02T00:00:00.000Z"),
      );
      const cachedAfterSecond = await fixture.ownerPool.query<EntitlementSnapshotStateRow>(
        entitlementSnapshotStateQuery,
        [fixture.userId],
      );
      assert.equal(
        cachedAfterSecond.rows[0]?.computed_at,
        cachedAfterFirst.rows[0]?.computed_at,
      );
    } finally {
      await fixture.ownerPool.query(
        "DELETE FROM billing.entitlement_snapshots WHERE user_id = $1",
        [fixture.userId],
      );
    }
  });
});

test("the sync pull response publishes the highest-ranked entitlement that currently grants", async () => {
  await withPostgresIntegrationFixture(async (fixture) => {
    try {
      const purchase = await fixture.ownerPool.query<PurchaseUntilRow>(
        [
          "INSERT INTO billing.purchases (",
          "provider, provider_purchase_id, kind, user_id, tier, status, is_trial, will_renew, until, environment",
          ") VALUES ('stripe', $1, 'subscription', $2, 'premium', 'active', FALSE, TRUE,",
          // Truncated to milliseconds so the stored paid-through date survives a round trip through a
          // JavaScript Date unchanged, which is what the wire field carries.
          "date_trunc('milliseconds', now() + interval '30 days'), 'production')",
          "RETURNING until",
        ].join(" "),
        [`entitlement-integration-${randomUUID()}`, fixture.userId],
      );
      const purchaseUntil = purchase.rows[0]?.until;
      if (!(purchaseUntil instanceof Date)) {
        throw new Error("The seeded premium purchase did not return its paid-through date.");
      }

      await fixture.ownerPool.query(
        [
          "INSERT INTO billing.grants (user_id, tier, source, reason)",
          "VALUES ($1, 'lifetime', 'admin_grant', 'Entitlement resolver integration test')",
        ].join(" "),
        [fixture.userId],
      );

      const app = createSyncPullApp(fixture.userId, fixture.workspaceId);
      const installationId = randomUUID();

      // A lifetime grant outranks an active premium subscription, and it never ends.
      assert.deepEqual(await pullEntitlement(app, fixture.workspaceId, installationId), {
        tier: "lifetime",
        tierRank: 30,
        tierDisplayName: "Lifetime",
        status: "active",
        until: null,
        isTrial: false,
        willRenew: false,
        limits: { aiMonthlyMessages: 1000, aiMonthlyWeightedTokens: null },
      });
      const cachedAfterGrant = await fixture.ownerPool.query<EntitlementSnapshotStateRow>(
        entitlementSnapshotStateQuery,
        [fixture.userId],
      );
      assert.equal(cachedAfterGrant.rows[0]?.tier, "lifetime");
      assert.equal(cachedAfterGrant.rows[0]?.source, "grant");

      // Revoking the grant falls back to the purchase rather than to nothing.
      await fixture.ownerPool.query(
        "UPDATE billing.grants SET revoked_at = now() WHERE user_id = $1",
        [fixture.userId],
      );
      assert.deepEqual(await pullEntitlement(app, fixture.workspaceId, installationId), {
        tier: "premium",
        tierRank: 20,
        tierDisplayName: "Premium",
        status: "active",
        until: purchaseUntil.toISOString(),
        isTrial: false,
        willRenew: true,
        limits: { aiMonthlyMessages: 1000, aiMonthlyWeightedTokens: null },
      });
      const cachedAfterRevoke = await fixture.ownerPool.query<EntitlementSnapshotStateRow>(
        entitlementSnapshotStateQuery,
        [fixture.userId],
      );
      assert.equal(cachedAfterRevoke.rows[0]?.tier, "premium");
      assert.equal(cachedAfterRevoke.rows[0]?.source, "purchase");
      assert.equal(cachedAfterRevoke.rows[0]?.will_renew, true);

      // The paid-through date passing is enough on its own: no worker rewrites the purchase row, and
      // the stored status stays 'active'.
      await fixture.ownerPool.query(
        "UPDATE billing.purchases SET until = now() - interval '1 day' WHERE user_id = $1",
        [fixture.userId],
      );
      assert.deepEqual(await pullEntitlement(app, fixture.workspaceId, installationId), {
        tier: "free",
        tierRank: 10,
        tierDisplayName: "Free",
        status: "none",
        until: null,
        isTrial: false,
        willRenew: false,
        limits: { aiMonthlyMessages: 50, aiMonthlyWeightedTokens: null },
      });
      const cachedAfterExpiry = await fixture.ownerPool.query<EntitlementSnapshotStateRow>(
        entitlementSnapshotStateQuery,
        [fixture.userId],
      );
      assert.equal(cachedAfterExpiry.rows[0]?.tier, "free");
      assert.equal(cachedAfterExpiry.rows[0]?.status, "none");
      assert.equal(cachedAfterExpiry.rows[0]?.source, "none");

      // Each transition above reached the entitlement_changed producer and stored nothing, because
      // analytics.product_events.user_id is a uuid column and this test's actor is the shared fixture's
      // prefixed id: the writer's batch fails that cast, and it reports a refused write as a warning
      // rather than raising it. The product_analytics_server_event_write_failed records this test emits
      // in CI are that cast and not a writer failure. Asserted rather than left implicit so the
      // absence is a stated fact; giving this test a UUID actor belongs to whoever owns it.
      const refusedFacts = await fixture.ownerPool.query<ProductEventCountRow>(
        "SELECT count(*)::text AS count FROM analytics.product_events WHERE user_id::text = $1",
        [fixture.userId],
      );
      assert.equal(refusedFacts.rows[0]?.count, "0");
    } finally {
      await fixture.ownerPool.query(
        "DELETE FROM billing.entitlement_snapshots WHERE user_id = $1",
        [fixture.userId],
      );
      await fixture.ownerPool.query("DELETE FROM billing.grants WHERE user_id = $1", [fixture.userId]);
      await fixture.ownerPool.query("DELETE FROM billing.purchases WHERE user_id = $1", [fixture.userId]);
    }
  });
});

// The billing facts are written by the same refresh the tests above drive, so they are pinned here
// rather than in a new file: this is the only place the real resolver, the real snapshot upsert and
// the real analytics writer run together against the real schema, and the emission depends on all
// three agreeing - the catalog's strict property parser, the cached row's stored vocabularies and the
// clock guard that can discard a write the code path still ran.
//
// The person here is a fresh UUID rather than the shared fixture's prefixed user id, for the reason
// serverFacts/authoringUpdates.postgres.integration.ts states: analytics.product_events.user_id is a
// uuid column, the writer reports a refused batch as a warning instead of raising it, and a non-UUID
// actor would make every assertion below fail as "no rows" with the real cause logged and discarded.
// Nothing else about the person is needed - the billing tables carry no foreign key to
// org.user_settings, deliberately (db/migrations/0151_billing_schema.sql).
test("an entitlement change that moves access is recorded as a server-derived fact", async () => {
  await withPostgresIntegrationFixture(async (fixture) => {
    const billingUserId = randomUUID();
    try {
      // A cache miss stores the baseline and reports nothing. The snapshot may be truncated and
      // rebuilt at any time, so a missing row is no evidence that anything changed.
      await resolveEntitlementSnapshotForUser(
        billingUserId,
        "account",
        new Date("2026-09-01T00:00:00.000Z"),
      );
      const afterBaseline = await fixture.ownerPool.query<BillingProductEventRow>(
        billingProductEventsQuery,
        [billingUserId],
      );
      assert.deepEqual(afterBaseline.rows, []);

      await fixture.ownerPool.query(
        [
          "INSERT INTO billing.grants (user_id, tier, source, reason)",
          "VALUES ($1, 'premium', 'admin_grant', 'Entitlement analytics integration test')",
        ].join(" "),
        [billingUserId],
      );
      await resolveEntitlementSnapshotForUser(
        billingUserId,
        "account",
        new Date("2026-09-02T00:00:00.000Z"),
      );
      const afterGrant = await fixture.ownerPool.query<BillingProductEventRow>(
        billingProductEventsQuery,
        [billingUserId],
      );
      assert.deepEqual(afterGrant.rows, [
        {
          event_name: "entitlement_changed",
          origin: "server",
          trust_level: "server_derived",
          // No device is named: the change happened at an operator's hand and the only thing a client
          // did was be the next one to sync.
          platform: null,
          screen: null,
          subject_user_id: billingUserId,
          event_properties: {
            from_tier: "free",
            to_tier: "premium",
            from_status: "none",
            to_status: "active",
            source: "grant",
          },
        },
      ]);

      // An unchanged entitlement writes no snapshot row and reports nothing, whatever clock it is
      // resolved on.
      await resolveEntitlementSnapshotForUser(
        billingUserId,
        "account",
        new Date("2026-09-03T00:00:00.000Z"),
      );
      const afterUnchanged = await fixture.ownerPool.query<BillingProductEventRow>(
        billingProductEventsQuery,
        [billingUserId],
      );
      assert.equal(afterUnchanged.rows.length, 1);

      // Revoking the grant takes the access away, which is the churn half of the series.
      await fixture.ownerPool.query(
        "UPDATE billing.grants SET revoked_at = now() WHERE user_id = $1",
        [billingUserId],
      );

      // Resolved on a clock older than the stored row, that revocation reaches the writing branch and
      // loses the upsert's clock guard, so the fact must not be reported: it would describe a state
      // that never became current. The injected clock is what makes this reachable in a test; in
      // production it is two concurrent pulls committing in an order the database does not fix.
      await resolveEntitlementSnapshotForUser(
        billingUserId,
        "account",
        new Date("2026-09-01T12:00:00.000Z"),
      );
      const afterSuperseded = await fixture.ownerPool.query<BillingProductEventRow>(
        billingProductEventsQuery,
        [billingUserId],
      );
      assert.equal(afterSuperseded.rows.length, 1);
      const stillStored = await fixture.ownerPool.query<EntitlementSnapshotStateRow>(
        entitlementSnapshotStateQuery,
        [billingUserId],
      );
      assert.equal(stillStored.rows[0]?.tier, "premium");

      await resolveEntitlementSnapshotForUser(
        billingUserId,
        "account",
        new Date("2026-09-04T00:00:00.000Z"),
      );
      const afterRevoke = await fixture.ownerPool.query<BillingProductEventRow>(
        billingProductEventsQuery,
        [billingUserId],
      );
      assert.equal(afterRevoke.rows.length, 2);
      assert.deepEqual(afterRevoke.rows[1]?.event_properties, {
        from_tier: "premium",
        to_tier: "free",
        from_status: "active",
        to_status: "none",
        source: "none",
      });
    } finally {
      await fixture.ownerPool.query(
        "DELETE FROM analytics.product_events WHERE user_id = $1::uuid",
        [billingUserId],
      );
      await fixture.ownerPool.query(
        "DELETE FROM billing.entitlement_snapshots WHERE user_id = $1",
        [billingUserId],
      );
      await fixture.ownerPool.query("DELETE FROM billing.grants WHERE user_id = $1", [billingUserId]);
    }
  });
});

// One person's billing rows as an identity rewrite leaves them.
type BillingIdentityRow = Readonly<{
  user_id: string | null;
  previous_user_id: string | null;
  account_deleted_at: Date | null;
}>;

type BillingStateIdentityRow = Readonly<{
  user_id: string;
  ever_purchased_at: Date | null;
  trial_provider: string | null;
  stripe_customer_id: string | null;
  apple_app_account_token: string | null;
}>;

type ProviderEventIdentityRow = Readonly<{
  user_id: string | null;
  payload: unknown;
  payload_raw: string;
}>;

type SnapshotUserIdRow = Readonly<{ user_id: string }>;

/**
 * Runs one identity rewrite as `backend_app` and throws the rows away afterwards.
 *
 * Rolled back rather than cleaned up because these tables are the ones this role may not delete from,
 * and because the rewrites mint identifiers of their own that a cleanup statement could not name. The
 * seeds, the rewrite and the read-back all run on the one connection, so what is asserted is what the
 * statements actually left behind.
 */
async function withRolledBackBillingTransaction(
  fixture: PostgresIntegrationFixture,
  work: (executor: DatabaseExecutor) => Promise<void>,
): Promise<void> {
  const client = await fixture.runtimePool.connect();
  try {
    await client.query("BEGIN");
    await work({
      query: async <Row extends pg.QueryResultRow>(
        text: string,
        params: ReadonlyArray<SqlValue>,
      ): Promise<pg.QueryResult<Row>> => client.query<Row>(text, [...params]),
    });
  } finally {
    await client.query("ROLLBACK");
    client.release();
  }
}

async function insertPurchase(
  executor: DatabaseExecutor,
  userId: string,
  previousUserId: string | null,
  providerPurchaseId: string,
): Promise<void> {
  await executor.query(
    [
      "INSERT INTO billing.purchases (",
      "provider, provider_purchase_id, kind, user_id, previous_user_id, tier, status, environment",
      ") VALUES ('stripe', $1, 'subscription', $2, $3, 'premium', 'active', 'production')",
    ].join(" "),
    [providerPurchaseId, userId, previousUserId],
  );
}

async function insertBillingState(
  executor: DatabaseExecutor,
  row: Readonly<{
    userId: string;
    createdAt: string;
    trialConsumedAt: string | null;
    trialProvider: string | null;
    everPurchasedAt: string | null;
    stripeCustomerId: string | null;
    appleAppAccountToken: string | null;
  }>,
): Promise<void> {
  await executor.query(
    [
      "INSERT INTO billing.user_billing_state (",
      "user_id, trial_consumed_at, trial_provider, ever_purchased_at, stripe_customer_id,",
      "apple_app_account_token, created_at",
      ") VALUES ($1, $2, $3, $4, $5, $6::uuid, $7)",
    ].join(" "),
    [
      row.userId,
      row.trialConsumedAt,
      row.trialProvider,
      row.everPurchasedAt,
      row.stripeCustomerId,
      row.appleAppAccountToken,
      row.createdAt,
    ],
  );
}

// The transfer's hard part is a database rule rather than a decision: each provider handle carries a
// partial unique index (0151), the retired guest row is not deletable, and a partial unique index cannot
// be deferred, so writing a moving handle on the destination before clearing it on the guest fails with
// 23505. Only a real transaction shows that, and only a real one shows that a person's whole paid
// history survives an upgrade under the grants this role actually holds.
test("a guest upgrade moves the paid history and merges the billing state without colliding on a handle", async () => {
  await withPostgresIntegrationFixture(async (fixture) => {
    const guestUserId = `${fixture.userId}-guest`;
    const movingStripeCustomerId = `cus_${randomUUID()}`;
    const guestAppleToken = randomUUID();
    const targetAppleToken = randomUUID();
    await withRolledBackBillingTransaction(fixture, async (executor) => {
      await insertPurchase(executor, guestUserId, null, `transfer-${randomUUID()}`);
      await executor.query(
        [
          "INSERT INTO billing.grants (user_id, tier, source, reason)",
          "VALUES ($1, 'premium', 'gift', 'Billing identity integration test')",
        ].join(" "),
        [guestUserId],
      );
      await insertBillingState(executor, {
        userId: guestUserId,
        createdAt: "2026-01-01T00:00:00.000Z",
        trialConsumedAt: "2026-01-01T00:00:00.000Z",
        trialProvider: "apple",
        everPurchasedAt: "2026-03-01T00:00:00.000Z",
        stripeCustomerId: movingStripeCustomerId,
        appleAppAccountToken: guestAppleToken,
      });
      await insertBillingState(executor, {
        userId: fixture.userId,
        createdAt: "2026-02-01T00:00:00.000Z",
        trialConsumedAt: "2026-02-01T00:00:00.000Z",
        trialProvider: "stripe",
        everPurchasedAt: null,
        stripeCustomerId: null,
        appleAppAccountToken: targetAppleToken,
      });
      await executor.query(
        [
          "INSERT INTO billing.entitlement_snapshots (user_id, tier, status, source)",
          "VALUES ($1, 'premium', 'active', 'purchase')",
        ].join(" "),
        [guestUserId],
      );

      await transferBillingToUpgradedAccountInExecutor(executor, guestUserId, fixture.userId);

      const purchases = await executor.query<BillingIdentityRow>(
        [
          "SELECT user_id, previous_user_id, account_deleted_at",
          "FROM billing.purchases",
          "WHERE user_id = ANY($1::text[]) OR previous_user_id = ANY($1::text[])",
        ].join(" "),
        [[guestUserId, fixture.userId]],
      );
      assert.deepEqual(purchases.rows, [{
        user_id: fixture.userId,
        previous_user_id: guestUserId,
        // A transfer is not a deletion: the purchase stays live for the person who now holds it.
        account_deleted_at: null,
      }]);

      const billingStates = await executor.query<BillingStateIdentityRow>(
        [
          "SELECT user_id, ever_purchased_at, trial_provider, stripe_customer_id,",
          "apple_app_account_token::text AS apple_app_account_token",
          "FROM billing.user_billing_state",
          "WHERE user_id = ANY($1::text[])",
          "ORDER BY user_id",
        ].join(" "),
        [[guestUserId, fixture.userId]],
      );
      assert.deepEqual(billingStates.rows, [
        {
          user_id: fixture.userId,
          ever_purchased_at: new Date("2026-03-01T00:00:00.000Z"),
          // The earlier consumed trial wins, and its provider travels with it.
          trial_provider: "apple",
          stripe_customer_id: movingStripeCustomerId,
          apple_app_account_token: targetAppleToken,
        },
        {
          // The retired row survives, because nothing may delete it, and keeps the handle that did not
          // move: the destination already had an Apple token, and overwriting it would make Apple's
          // notifications for that purchase unattributable.
          user_id: guestUserId,
          ever_purchased_at: new Date("2026-03-01T00:00:00.000Z"),
          trial_provider: "apple",
          stripe_customer_id: null,
          apple_app_account_token: guestAppleToken,
        },
      ]);

      // The guest's cache entry goes rather than moving: the destination's next resolution recomputes
      // its own from the purchase and grant that just arrived.
      const snapshots = await executor.query<SnapshotUserIdRow>(
        "SELECT user_id FROM billing.entitlement_snapshots WHERE user_id = ANY($1::text[])",
        [[guestUserId, fixture.userId]],
      );
      assert.deepEqual(snapshots.rows, []);
    });
  });
});

// Erasure here is an UPDATE throughout, because this role holds no DELETE on four of the five tables.
// What a real transaction proves is that the rewrite is possible at all under those grants, that
// stamping a deleted account cannot invalidate a purchase somebody else now holds, and that a person
// carrying two billing-state rows does not collide on the primary key those rows are keyed by.
test("account deletion anonymises the billing history without deleting a row", async () => {
  await withPostgresIntegrationFixture(async (fixture) => {
    const mergedGuestUserId = `${fixture.userId}-merged-guest`;
    const otherPersonUserId = `${fixture.userId}-other-person`;
    const anonymizedUserId = randomUUID();
    const personUserIds = [fixture.userId, mergedGuestUserId];
    const ownPurchaseId = `erasure-own-${randomUUID()}`;
    const transferredPurchaseId = `erasure-transferred-${randomUUID()}`;
    const accountStripeCustomerId = `cus_${randomUUID()}`;
    await withRolledBackBillingTransaction(fixture, async (executor) => {
      await insertPurchase(executor, fixture.userId, null, ownPurchaseId);
      // Bought by this person and since transferred away, so it is somebody else's live access now.
      await insertPurchase(executor, otherPersonUserId, fixture.userId, transferredPurchaseId);
      await executor.query(
        [
          "INSERT INTO billing.provider_events (",
          "provider, event_id, event_type, payload_raw, payload, provider_purchase_id, environment",
          ") VALUES ('stripe', $1, 'customer.subscription.updated', $2, $3::jsonb, $4, 'production')",
        ].join(" "),
        [
          `erasure-event-${randomUUID()}`,
          '{"customer_email":"person@example.com"}',
          '{"customer_email":"person@example.com"}',
          ownPurchaseId,
        ],
      );
      // A second event on the same purchase, this one already attributed, so both arms of the user_id
      // CASE are executed: this row is renamed, the row above keeps the NULL it was inserted with.
      await executor.query(
        [
          "INSERT INTO billing.provider_events (",
          "provider, event_id, event_type, payload_raw, payload, user_id, provider_purchase_id,",
          "environment",
          ") VALUES ('stripe', $1, 'customer.subscription.deleted', $2, $3::jsonb, $4, $5, 'production')",
        ].join(" "),
        [
          `erasure-event-attributed-${randomUUID()}`,
          '{"customer_email":"person@example.com"}',
          '{"customer_email":"person@example.com"}',
          fixture.userId,
          ownPurchaseId,
        ],
      );
      // A third event on that same purchase, from before it was transferred in, so it names the person
      // who held it then. This is the case the CASE exists for: the row is in reach through the purchase,
      // which is this person's now, so its payload goes — but the id belongs to somebody who has asked
      // for nothing, and an unconditional assignment would stamp this person's pseudonym over it and
      // misattribute their notification.
      await executor.query(
        [
          "INSERT INTO billing.provider_events (",
          "provider, event_id, event_type, payload_raw, payload, user_id, provider_purchase_id,",
          "environment",
          ") VALUES ('stripe', $1, 'customer.subscription.created', $2, $3::jsonb, $4, $5, 'production')",
        ].join(" "),
        [
          `erasure-event-previous-holder-${randomUUID()}`,
          '{"customer_email":"previous-holder@example.com"}',
          '{"customer_email":"previous-holder@example.com"}',
          otherPersonUserId,
          ownPurchaseId,
        ],
      );
      await insertBillingState(executor, {
        userId: fixture.userId,
        createdAt: "2026-02-01T00:00:00.000Z",
        trialConsumedAt: null,
        trialProvider: null,
        everPurchasedAt: "2026-03-01T00:00:00.000Z",
        stripeCustomerId: accountStripeCustomerId,
        appleAppAccountToken: null,
      });
      // The second row exists because a guest upgrade merged two identities that each already had
      // billing state, and the row retired there cannot be deleted.
      await insertBillingState(executor, {
        userId: mergedGuestUserId,
        createdAt: "2026-01-01T00:00:00.000Z",
        trialConsumedAt: "2026-01-01T00:00:00.000Z",
        trialProvider: "apple",
        everPurchasedAt: null,
        stripeCustomerId: null,
        appleAppAccountToken: randomUUID(),
      });
      await executor.query(
        [
          "INSERT INTO billing.entitlement_snapshots (user_id, tier, status, source)",
          "VALUES ($1, 'premium', 'active', 'purchase')",
        ].join(" "),
        [fixture.userId],
      );

      await anonymizeBillingForDeletedPersonInExecutor(executor, personUserIds, anonymizedUserId);

      const purchases = await executor.query<BillingIdentityRow>(
        [
          "SELECT user_id, previous_user_id, account_deleted_at",
          "FROM billing.purchases",
          "WHERE provider_purchase_id = ANY($1::text[])",
          "ORDER BY provider_purchase_id",
        ].join(" "),
        [[ownPurchaseId, transferredPurchaseId]],
      );
      const ownPurchase = purchases.rows[0];
      const transferredPurchase = purchases.rows[1];
      assert.equal(ownPurchase?.user_id, anonymizedUserId);
      assert.notEqual(ownPurchase?.account_deleted_at, null);
      // The purchase this person sold on keeps naming its current holder and keeps granting: the
      // resolver ignores a purchase carrying account_deleted_at, so stamping it here would strip
      // somebody else of access they paid for.
      assert.equal(transferredPurchase?.user_id, otherPersonUserId);
      assert.equal(transferredPurchase?.previous_user_id, anonymizedUserId);
      assert.equal(transferredPurchase?.account_deleted_at, null);

      const providerEvents = await executor.query<ProviderEventIdentityRow>(
        [
          "SELECT user_id, payload, payload_raw",
          "FROM billing.provider_events",
          "WHERE provider_purchase_id = $1",
          "ORDER BY event_type",
        ].join(" "),
        [ownPurchaseId],
      );
      // All three rows are reached through the purchase, and all three lose the payload the buyer's
      // details were in. Only the one that named this person is renamed: writing the pseudonym into a
      // NULL would assert that the notification concerned them, which the row never said, and writing it
      // over the previous holder's id would take a third party's attribution with it.
      assert.deepEqual(providerEvents.rows, [
        { user_id: otherPersonUserId, payload: null, payload_raw: "" },
        { user_id: anonymizedUserId, payload: null, payload_raw: "" },
        { user_id: null, payload: null, payload_raw: "" },
      ]);

      const billingStates = await executor.query<BillingStateIdentityRow>(
        [
          "SELECT user_id, ever_purchased_at, trial_provider, stripe_customer_id,",
          "apple_app_account_token::text AS apple_app_account_token",
          "FROM billing.user_billing_state",
          "WHERE user_id = ANY($1::text[]) OR user_id = $2",
          "ORDER BY created_at",
        ].join(" "),
        [personUserIds, anonymizedUserId],
      );
      // Both rows survive, and neither names the person. user_id is this table's primary key, so only
      // the older can take the shared pseudonym; the other takes a fresh id of its own.
      assert.equal(billingStates.rows.length, 1);
      assert.equal(billingStates.rows[0]?.user_id, anonymizedUserId);
      assert.equal(billingStates.rows[0]?.trial_provider, "apple");
      // The younger row is found by the handle it still holds, because the id it now carries is one the
      // statement minted. Nothing was deleted, it no longer names the person, and it did not collide
      // with the pseudonym the older row took.
      const retiredStates = await executor.query<SnapshotUserIdRow>(
        "SELECT user_id FROM billing.user_billing_state WHERE stripe_customer_id = $1",
        [accountStripeCustomerId],
      );
      assert.equal(retiredStates.rows.length, 1);
      const retiredStateUserId = retiredStates.rows[0]?.user_id ?? "";
      assert.equal(personUserIds.includes(retiredStateUserId), false);
      assert.notEqual(retiredStateUserId, anonymizedUserId);

      // The one billing row erasure may drop, because it is a cache: a copy of it under a pseudonym is a
      // row no rebuild would ever produce again.
      const snapshots = await executor.query<SnapshotUserIdRow>(
        "SELECT user_id FROM billing.entitlement_snapshots WHERE user_id = ANY($1::text[]) OR user_id = $2",
        [personUserIds, anonymizedUserId],
      );
      assert.deepEqual(snapshots.rows, []);
    });
  });
});

// The reaper's purchase guard is the only thing between a person who paid and permanent deletion, and
// both of its readers are SQL: nothing in a unit test can execute either. It is also the failure mode
// that hides, because it fails open - if the reporting role ever lost the column grant or the policy
// migration 0151 gives it, the subquery would see nothing, `NOT EXISTS` would turn true, and every
// paying guest would quietly become reapable. So this runs the exported clause itself, under both roles
// that have to be able to see through it: backend_app, which runs the in-transaction re-check, and
// reporting_readonly, which runs the candidate scan. The reporting side reaches the role through
// `SET LOCAL ROLE` on the owner connection, because the boundary child is given no reporting connection
// string; the administrative role is a superuser, and a superuser that has set a non-owner role is
// subject to row-level security exactly as that role is, which is the property being tested.
type GuardRow = Readonly<{ spared: boolean }>;

const everPurchasedGuardQuery =
  `SELECT NOT (${createWebGuestEverPurchasedGuardSql("$1")}) AS spared`;

test("the reaper's purchase guard spares a paying guest under both roles that read it", async () => {
  await withPostgresIntegrationFixture(async (fixture) => {
    const payingGuestUserId = `${fixture.userId}-paying-guest`;
    const freeGuestUserId = `${fixture.userId}-free-guest`;
    try {
      await fixture.ownerPool.query(
        [
          "INSERT INTO billing.user_billing_state (user_id, ever_purchased_at)",
          "VALUES ($1, $2::timestamptz)",
        ].join(" "),
        [payingGuestUserId, "2026-03-01T00:00:00.000Z"],
      );
      // A guest who never paid, so the clause is shown to discriminate rather than always spare.
      await fixture.ownerPool.query(
        "INSERT INTO billing.user_billing_state (user_id) VALUES ($1)",
        [freeGuestUserId],
      );

      const runtimeSpared = await fixture.runtimePool.query<GuardRow>(
        everPurchasedGuardQuery,
        [payingGuestUserId],
      );
      assert.equal(runtimeSpared.rows[0]?.spared, true);
      const runtimeReapable = await fixture.runtimePool.query<GuardRow>(
        everPurchasedGuardQuery,
        [freeGuestUserId],
      );
      assert.equal(runtimeReapable.rows[0]?.spared, false);

      const reportingClient = await fixture.ownerPool.connect();
      try {
        await reportingClient.query("BEGIN");
        await reportingClient.query("SET LOCAL ROLE reporting_readonly");
        const reportingSpared = await reportingClient.query<GuardRow>(
          everPurchasedGuardQuery,
          [payingGuestUserId],
        );
        // The row is visible to the scanning role through 0151's policy and its column grant. A false
        // here is the silent failure: the guest looks like they never paid.
        assert.equal(reportingSpared.rows[0]?.spared, true);
        const reportingReapable = await reportingClient.query<GuardRow>(
          everPurchasedGuardQuery,
          [freeGuestUserId],
        );
        assert.equal(reportingReapable.rows[0]?.spared, false);
        await reportingClient.query("COMMIT");
      } finally {
        reportingClient.release();
      }
    } finally {
      await fixture.ownerPool.query(
        "DELETE FROM billing.user_billing_state WHERE user_id = ANY($1::text[])",
        [[payingGuestUserId, freeGuestUserId]],
      );
    }
  });
});

// The owner connection stands in for the future atomic union; runtime must not gain a transfer API.
test("private account billing union retains aliases, paid history and every month of AI usage", async () => {
  await withPostgresIntegrationFixture(async (fixture) => {
    const client = await fixture.ownerPool.connect();
    const source = `${fixture.userId}-billing-source`;
    const target = fixture.userId;
    const sourceIdentityId = randomUUID();
    const targetIdentityId = randomUUID();
    const sourceCustomer = `cus_${randomUUID().replaceAll("-", "")}`;
    const targetCustomer = `cus_${randomUUID().replaceAll("-", "")}`;
    const sourceApple = randomUUID();
    const targetApple = randomUUID();
    const sourceGoogle = randomUUID();
    const targetGoogle = randomUUID();
    const sourceAttemptId = randomUUID();
    const targetAttemptId = randomUUID();
    const providerEventId = randomUUID();
    const now = new Date("2026-10-16T12:00:00.000Z");
    const executor: DatabaseExecutor = {
      query: async <Row extends pg.QueryResultRow>(
        text: string, params: ReadonlyArray<SqlValue>,
      ): Promise<pg.QueryResult<Row>> => client.query<Row>(text, [...params]),
    };
    try {
      await client.query("BEGIN");
      await client.query("INSERT INTO org.user_settings(user_id, email) VALUES ($1, 'billing-source@example.com')", [source]);
      await client.query(`INSERT INTO billing.user_billing_state
        (user_id, trial_consumed_at, trial_provider, ever_purchased_at, stripe_customer_id,
          apple_app_account_token, google_obfuscated_account_id)
        VALUES ($1, '2026-01-01', 'apple', '2026-02-01', $3, $5, $7),
          ($2, '2026-03-01', 'google', '2026-04-01', $4, $6, $8)`,
      [source, target, sourceCustomer, targetCustomer, sourceApple, targetApple, sourceGoogle, targetGoogle]);
      assert.equal(await getStripeAccountTrialEligibilityInExecutor(executor, target, "production"), true);
      await client.query(`INSERT INTO billing.stripe_customer_identities
        (identity_id, environment, user_id, customer_id)
        VALUES ($1, 'production', $3, $5), ($2, 'production', $4, $6)`,
      [sourceIdentityId, targetIdentityId, source, target, sourceCustomer, targetCustomer]);
      assert.equal(await getStripeAccountTrialEligibilityInExecutor(executor, target, "production"), true);
      await client.query("UPDATE billing.stripe_customer_identities SET customer_id = NULL WHERE identity_id = $1", [targetIdentityId]);
      assert.equal(await getStripeAccountTrialEligibilityInExecutor(executor, target, "production"), null);
      await client.query("UPDATE billing.stripe_customer_identities SET customer_id = $2 WHERE identity_id = $1",
        [targetIdentityId, targetCustomer]);
      await client.query(`INSERT INTO billing.stripe_trial_consumptions
        (identity_id, environment, subscription_id, consumed_at)
        VALUES ($1, 'production', 'sub_SourceTrial', '2026-01-01')`, [sourceIdentityId]);
      await client.query(`INSERT INTO billing.stripe_checkout_attempts
        (attempt_id, identity_id, environment, user_id, trial_days, locale, expires_at)
        VALUES ($1, $2, 'production', $3, 7, 'en', now() + interval '1 hour')`,
      [sourceAttemptId, sourceIdentityId, source]);
      await client.query(`INSERT INTO billing.stripe_checkout_attempts
        (attempt_id, identity_id, environment, user_id, session_id, status, trial_days, locale, expires_at)
        VALUES ($1, $2, 'production', $3, 'cs_FrozenTarget', 'open', 7, 'fr', now() + interval '2 hours')`,
      [targetAttemptId, targetIdentityId, target]);
      await client.query(`INSERT INTO billing.purchases
        (provider, provider_purchase_id, environment, kind, tier, user_id, previous_user_id,
          status, until, provider_status_raw)
        VALUES ('apple', $3, 'production', 'subscription', 'premium', $1, 'original-holder', 'active', '2030-01-01', '1'),
          ('google', $4, 'production', 'subscription', 'premium', $2, NULL, 'active', '2030-01-01', 'ACTIVE'),
          ('stripe', $5, 'production', 'subscription', 'premium', $1, NULL, 'expired', '2026-02-01', 'canceled')`,
      [source, target, `apple-${sourceIdentityId}`, `google-${targetIdentityId}`, `sub_${sourceIdentityId}`]);
      await client.query(`INSERT INTO billing.grants(user_id, tier, source, reason, granted_at)
        VALUES ($1, 'lifetime', 'gift', 'Account union integration', '2026-01-01'),
          ($2, 'premium', 'gift', 'Account union integration', '2026-01-01')`, [source, target]);
      await client.query(`INSERT INTO billing.provider_events
        (provider, event_id, user_id, provider_purchase_id, environment, payload_raw, payload)
        VALUES ('apple', $1, $2, $3, 'production', 'original-fact', '{"original":true}')`,
      [providerEventId, source, `apple-${sourceIdentityId}`]);
      await client.query(`INSERT INTO billing.apple_transactions
        (environment, transaction_id, subject_id, original_transaction_id, product_id, purchased_at,
          source_signed_at, native_fields, observed_at)
        SELECT 'production', $1, subject_id, $2, 'premium_monthly', '2026-02-01',
          '2026-02-01', '{"price":6990}', '2026-02-01'
        FROM billing.history_subjects WHERE provider = 'apple' AND user_id = $3`,
      [randomUUID(), `apple-${sourceIdentityId}`, source]);
      await client.query(`INSERT INTO billing.entitlement_snapshots(user_id, tier, status, source)
        VALUES ($1, 'lifetime', 'active', 'grant'), ($2, 'premium', 'active', 'purchase')`, [source, target]);
      await client.query(`INSERT INTO ai.usage_events
        (usage_event_id, user_id, workspace_id, occurred_at, surface, provider, model_id,
          request_id, tier_at_call, input_tokens, output_tokens, user_supplied_key)
        VALUES ($1, $5, $7, '2026-09-01', 'chat', 'openai', 'gpt-5', 'past-source', 'free', 11, 2, false),
          ($2, $6, $7, '2026-09-02', 'dictation', 'openai', 'gpt-5', 'past-target', 'premium', 13, 3, true),
          ($3, $5, $7, '2026-10-01', 'chat', 'openai', 'gpt-5', 'current-source', 'premium', 17, 5, false),
          ($4, $6, NULL, '2026-10-02', 'chat', 'openai', 'gpt-5', 'current-target', 'free', 19, 7, false)`,
      [randomUUID(), randomUUID(), randomUUID(), randomUUID(), source, target, fixture.workspaceId]);
      const usageBefore = await client.query<{ facts: ReadonlyArray<object> }>(`SELECT jsonb_agg(
        to_jsonb(usage) - 'user_id' ORDER BY usage_event_id) AS facts
        FROM ai.usage_events AS usage WHERE user_id IN ($1, $2)`, [source, target]);
      const purchasesBefore = await client.query<{ facts: ReadonlyArray<object> }>(`SELECT jsonb_agg(
        to_jsonb(purchase) - 'user_id' ORDER BY purchase_id) AS facts
        FROM billing.purchases AS purchase WHERE user_id IN ($1, $2)`, [source, target]);
      const grantsBefore = await client.query<{ facts: ReadonlyArray<object> }>(`SELECT jsonb_agg(
        to_jsonb(grant_row) - 'user_id' ORDER BY grant_id) AS facts
        FROM billing.grants AS grant_row WHERE user_id IN ($1, $2)`, [source, target]);
      const nativeBefore = await client.query<{ facts: ReadonlyArray<object> }>(`SELECT jsonb_agg(
        to_jsonb(transaction_row)) AS facts FROM billing.apple_transactions AS transaction_row
        WHERE original_transaction_id = $1`, [`apple-${sourceIdentityId}`]);
      // Preserve 0206's transfer functions while supplying the current Stripe reader's schema.
      await client.query(stripeRegionalCheckoutMigrationSql);
      const attemptBefore = await loadStripeCheckoutAttemptInExecutor(executor, sourceAttemptId, "production");
      const openAttemptBefore = await loadStripeCheckoutAttemptInExecutor(executor, targetAttemptId, "production");
      assert.notEqual(attemptBefore, null);
      assert.notEqual(openAttemptBefore, null);

      await client.query("SELECT billing.transfer_account_billing($1, $2)", [source, target]);
      await client.query("SELECT ai.transfer_account_usage($1, $2)", [source, target]);
      await client.query("SELECT auth.record_account_retirement($1, $2, $3)", [source, target, randomUUID()]);
      await client.query("SET LOCAL ROLE backend_app");
      for (const functionName of ["billing.transfer_account_billing", "ai.transfer_account_usage"]) {
        await client.query("SAVEPOINT runtime_transfer_denied");
        await assert.rejects(client.query(`SELECT ${functionName}($1, $2)`, [source, target]),
          (error: Error) => "code" in error && error.code === "42501");
        await client.query("ROLLBACK TO SAVEPOINT runtime_transfer_denied");
      }
      assert.equal(await resolveBillingOwnerInExecutor(executor, source), target);
      const aliases = await client.query<{ user_id: string; owner_id: string }>(`SELECT user_id,
        billing.canonical_owner_id(user_id) AS owner_id FROM billing.user_billing_state
        WHERE apple_app_account_token IN ($1, $2) AND google_obfuscated_account_id IN ($3, $4)`,
      [sourceApple, targetApple, sourceGoogle, targetGoogle]);
      assert.equal(aliases.rows.length, 2);
      assert.ok(aliases.rows.every((row) => row.owner_id === target));
      const apple = await lockPurchase(executor, {
        originalTransactionId: `unknown-${randomUUID()}`, appAccountToken: sourceApple, environment: "production",
      }, null);
      assert.equal(apple.ownerUserId, target);
      const googleToken = `unknown-${randomUUID()}`;
      const google = await lockGooglePurchaseOwners(executor, {
        purchaseToken: googleToken, productId: "premium", basePlanId: "monthly", offerId: null,
        price: null, status: "active", providerStatus: "ACTIVE", environment: "production", currentPhase: "base_price",
        isTrial: false, willRenew: true, autorenewDisabledReason: "unknown", cancellationSurveyReason: null,
        paid: true, completed: true, until: new Date("2030-01-01"), graceUntil: null, startedAt: now, verifiedAt: now,
        latestSuccessfulOrderId: null, linkedPurchaseToken: null, acknowledgementState: "acknowledged",
        obfuscatedExternalAccountId: sourceGoogle, outOfAppPurchaseContext: null,
      }, [{ purchaseToken: googleToken, predecessorToken: null, state: null }], null);
      assert.equal(google.ownerUserId, target);
      assert.equal((await readGooglePurchase(executor, `google-${targetIdentityId}`, "production"))?.user_id, target);
      const customers = await listStripeCustomerIdentitiesInExecutor(executor, target, "production");
      assert.equal(customers.length, 2);
      assert.equal(customers.filter((identity) => identity.isPrimary).length, 1);
      assert.equal(customers.find((identity) => identity.isPrimary)?.identityId, targetIdentityId);
      for (const customer of [sourceCustomer, targetCustomer]) {
        assert.equal((await findStripeCustomerIdentityInExecutor(executor, "production", customer))?.userId, target);
      }
      const attemptAfter = await loadStripeCheckoutAttemptInExecutor(executor, sourceAttemptId, "production");
      assert.deepEqual(attemptAfter, { ...attemptBefore, userId: target });
      assert.deepEqual(await loadStripeCheckoutAttemptInExecutor(executor, targetAttemptId, "production"), openAttemptBefore);
      assert.equal(await hasStripeTrialConsumptionInExecutor(executor, sourceIdentityId, "production"), true);
      assert.equal(await hasStripeTrialConsumptionInExecutor(executor, targetIdentityId, "production"), false);
      const primary = customers.find((identity) => identity.identityId === targetIdentityId);
      assert.ok(primary);
      const frozenOffer = await reserveStripeCheckoutAttemptInExecutor(executor, primary, "en");
      assert.deepEqual(frozenOffer, openAttemptBefore);
      await client.query(`UPDATE billing.stripe_checkout_attempts SET status = 'complete'
        WHERE attempt_id = $1`, [targetAttemptId]);
      await client.query(`UPDATE billing.stripe_checkout_attempts SET status = 'abandoned'
        WHERE attempt_id = $1`, [sourceAttemptId]);
      assert.equal(await getStripeAccountTrialEligibilityInExecutor(executor, target, "production"), false);
      assert.equal(await getStripeAccountTrialEligibilityInExecutor(executor, target, "sandbox"), true);
      await client.query("SAVEPOINT future_trial_offer");
      await client.query("UPDATE billing.stripe_customer_identities SET customer_id = NULL WHERE identity_id = $1", [targetIdentityId]);
      assert.equal(await getStripeAccountTrialEligibilityInExecutor(executor, target, "production"), false);
      await client.query("UPDATE billing.stripe_customer_identities SET is_primary = false WHERE identity_id = $1", [targetIdentityId]);
      assert.equal(await getStripeAccountTrialEligibilityInExecutor(executor, target, "production"), false);
      await client.query("ROLLBACK TO SAVEPOINT future_trial_offer");
      const futureOffer = await reserveStripeCheckoutAttemptInExecutor(executor, primary, "en");
      assert.equal(futureOffer.trialDays, 0);
      assert.equal((await loadStripeCheckoutAttemptInExecutor(executor, sourceAttemptId, "production"))?.trialDays, 7);
      const state = await client.query<{ trial_consumed_at: Date; trial_provider: string; ever_purchased_at: Date }>(
        "SELECT trial_consumed_at, trial_provider, ever_purchased_at FROM billing.user_billing_state WHERE user_id = $1", [target]);
      assert.deepEqual(state.rows[0], { trial_consumed_at: new Date("2026-01-01"),
        trial_provider: "apple", ever_purchased_at: new Date("2026-02-01") });
      const inputs = await loadEntitlementResolutionInputsInExecutor(executor, target);
      assert.equal(inputs.purchases.length, 3);
      assert.equal(inputs.grants.length, 2);
      assert.equal(inputs.cached, null);
      assert.equal(resolveEntitlement(inputs.purchases, inputs.grants, "account", now).tier, "lifetime");
      const snapshots = await client.query("SELECT user_id FROM billing.entitlement_snapshots WHERE user_id IN ($1, $2)", [source, target]);
      assert.equal(snapshots.rows.length, 0);
      const usageAfter = await client.query<{ facts: ReadonlyArray<object> }>(`SELECT jsonb_agg(
        to_jsonb(usage) - 'user_id' ORDER BY usage_event_id) AS facts
        FROM ai.usage_events AS usage WHERE user_id = $1`, [target]);
      assert.deepEqual(usageAfter.rows, usageBefore.rows);
      const purchasesAfter = await client.query<{ facts: ReadonlyArray<object> }>(`SELECT jsonb_agg(
        to_jsonb(purchase) - 'user_id' ORDER BY purchase_id) AS facts
        FROM billing.purchases AS purchase WHERE user_id = $1`, [target]);
      assert.deepEqual(purchasesAfter.rows, purchasesBefore.rows);
      const grantsAfter = await client.query<{ facts: ReadonlyArray<object> }>(`SELECT jsonb_agg(
        to_jsonb(grant_row) - 'user_id' ORDER BY grant_id) AS facts
        FROM billing.grants AS grant_row WHERE user_id = $1`, [target]);
      assert.deepEqual(grantsAfter.rows, grantsBefore.rows);
      const nativeAfter = await client.query<{ facts: ReadonlyArray<object> }>(`SELECT jsonb_agg(
        to_jsonb(transaction_row)) AS facts FROM billing.apple_transactions AS transaction_row
        WHERE original_transaction_id = $1`, [`apple-${sourceIdentityId}`]);
      assert.deepEqual(nativeAfter.rows, nativeBefore.rows);
      const subjects = await client.query<{ user_id: string }>(`SELECT user_id FROM billing.history_subjects
        WHERE subject_hash = encode(sha256(convert_to($1::text, 'UTF8')), 'hex')`, [`apple-${sourceIdentityId}`]);
      assert.deepEqual(subjects.rows, [{ user_id: target }]);
      const event = await client.query<{ user_id: string; payload_raw: string }>(
        "SELECT user_id, payload_raw FROM billing.provider_events WHERE event_id = $1", [providerEventId]);
      assert.deepEqual(event.rows, [{ user_id: source, payload_raw: "original-fact" }]);
      const usageTotals = await client.query<{ month: string; calls: number; input_tokens: number }>(`SELECT
        to_char(occurred_at AT TIME ZONE 'UTC', 'YYYY-MM') AS month,
        count(*)::integer AS calls, sum(input_tokens)::integer AS input_tokens
        FROM ai.usage_events WHERE user_id = $1 GROUP BY month ORDER BY month`, [target]);
      assert.deepEqual(usageTotals.rows, [
        { month: "2026-09", calls: 2, input_tokens: 24 }, { month: "2026-10", calls: 2, input_tokens: 36 },
      ]);
      const budget = await client.query<{ platform_messages: number; weighted_tokens: number }>(`SELECT
        count(DISTINCT request_id) FILTER (WHERE surface = 'chat' AND NOT user_supplied_key)::integer AS platform_messages,
        sum(COALESCE(input_tokens, 0) + 6 * COALESCE(output_tokens, 0))
          FILTER (WHERE NOT user_supplied_key)::integer AS weighted_tokens
        FROM ai.usage_events WHERE user_id = $1 AND occurred_at >= '2026-10-01' AND occurred_at < '2026-11-01'`, [target]);
      assert.deepEqual(budget.rows, [{ platform_messages: 2, weighted_tokens: 108 }]);
      await client.query("UPDATE billing.grants SET revoked_at = $2 WHERE user_id = $1 AND tier = 'lifetime'", [target, now]);
      const withoutLifetime = await loadEntitlementResolutionInputsInExecutor(executor, target);
      assert.equal(resolveEntitlement(withoutLifetime.purchases, withoutLifetime.grants, "account", now).tier, "premium");
    } finally {
      await client.query("ROLLBACK");
      client.release();
    }
  });
});

test("billing union moves unopposed handles and resolves an older guest alias through retirement", async () => {
  await withPostgresIntegrationFixture(async (fixture) => {
    const client = await fixture.ownerPool.connect();
    const source = `${fixture.userId}-source`;
    const guest = `${fixture.userId}-old-guest`;
    const token = randomUUID();
    const guestToken = randomUUID();
    const googleId = randomUUID();
    const customerId = `cus_${randomUUID().replaceAll("-", "")}`;
    const executor: DatabaseExecutor = {
      query: async <Row extends pg.QueryResultRow>(
        text: string, params: ReadonlyArray<SqlValue>,
      ): Promise<pg.QueryResult<Row>> => client.query<Row>(text, [...params]),
    };
    try {
      await client.query("BEGIN");
      await client.query("INSERT INTO org.user_settings(user_id) VALUES ($1)", [source]);
      await client.query(`INSERT INTO auth.guest_upgrade_history
        (upgrade_id, source_guest_user_id, source_guest_workspace_id, source_guest_session_id,
          target_subject_user_id, target_user_id, target_workspace_id, selection_type)
        VALUES ($1, $2, $3, $4, $5, $5, $3, 'existing')`,
      [randomUUID(), guest, fixture.workspaceId, randomUUID(), source]);
      await client.query(`INSERT INTO billing.user_billing_state
        (user_id, apple_app_account_token, google_obfuscated_account_id, stripe_customer_id)
        VALUES ($1, $3, $4, $5), ($2, $6, NULL, NULL)`,
      [source, guest, token, googleId, customerId, guestToken]);
      await client.query("SELECT billing.transfer_account_billing($1, $2)", [source, fixture.userId]);
      await client.query("SELECT auth.record_account_retirement($1, $2, $3)", [source, fixture.userId, randomUUID()]);
      await client.query("SET LOCAL ROLE backend_app");
      const state = await client.query<{ user_id: string; apple: string | null; google: string | null; stripe: string | null }>(
        `SELECT user_id, apple_app_account_token::text AS apple,
          google_obfuscated_account_id AS google, stripe_customer_id AS stripe
        FROM billing.user_billing_state WHERE user_id IN ($1, $2) ORDER BY user_id`, [source, fixture.userId]);
      assert.deepEqual(state.rows, [
        { user_id: fixture.userId, apple: token, google: googleId, stripe: customerId },
        { user_id: source, apple: null, google: null, stripe: null },
      ]);
      assert.equal(await resolveBillingOwnerInExecutor(executor, guest), fixture.userId);
      for (const appAccountToken of [guestToken, token]) {
        const mapped = await lockPurchase(executor, {
          originalTransactionId: `new-${randomUUID()}`, environment: "production", appAccountToken,
        }, null);
        assert.equal(mapped.ownerUserId, fixture.userId);
      }
      const privileges = await client.query<{ role: string; allowed: boolean }>(`SELECT role,
        has_function_privilege(role, 'billing.transfer_account_billing(text,text)', 'EXECUTE')
          OR has_function_privilege(role, 'ai.transfer_account_usage(text,text)', 'EXECUTE') AS allowed
        FROM unnest(ARRAY['backend_app', 'auth_app', 'reporting_readonly']) AS role ORDER BY role`);
      assert.ok(privileges.rows.every((row) => !row.allowed));
    } finally {
      await client.query("ROLLBACK");
      client.release();
    }
  });
});
