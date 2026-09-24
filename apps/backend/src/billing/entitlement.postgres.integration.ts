import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import { Hono } from "hono";
import { createSyncRoutes } from "../routes/sync";
import type { AppEnv } from "../server/app";
import type { RequestContext } from "../server/requestContext";
import { withPostgresIntegrationFixture } from "../testSupport/postgresIntegration";
import {
  resolveEntitlementSnapshotForUser,
  type EntitlementWire,
} from "./snapshot";

// The entitlement is derived from rows nothing writes yet, so a unit test with hand-built inputs would
// only restate the resolver. What is worth pinning is the part no pure test can reach: that the reads
// match the shipped billing schema, that the cache is written once and not rewritten while the answer
// holds, and that the sync pull route publishes the resolved value. This file must stay listed in
// apps/backend/scripts/postgresIntegrations/boundaries.mjs, because an unlisted integration file is
// never executed by any workflow.

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

function createSyncPullApp(userId: string, workspaceId: string): Hono<AppEnv> {
  const requestContext: RequestContext = {
    userId,
    subjectUserId: userId,
    selectedWorkspaceId: workspaceId,
    email: `${userId}@example.com`,
    locale: "en",
    userSettingsCreatedAt: "2026-01-01T00:00:00.000Z",
    preferences: {
      reviewReactionAnimationsEnabled: true,
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
        limits: { aiMonthlyWeightedTokens: null },
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
        limits: { aiMonthlyWeightedTokens: null },
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
        limits: { aiMonthlyWeightedTokens: null },
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
        limits: { aiMonthlyWeightedTokens: null },
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
