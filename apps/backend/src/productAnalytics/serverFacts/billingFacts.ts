import type {
  ProductAnalyticsBillingProvider,
  ProductAnalyticsEntitlementSource,
  ProductAnalyticsEntitlementStatus,
  ProductAnalyticsEntitlementTier,
  ProductAnalyticsPurchaseKind,
  ProductAnalyticsSubscriptionPeriod,
  ProductAnalyticsSubscriptionRevokedReason,
} from "../catalog";
import {
  deriveServerDerivedProductAnalyticsEventId,
  emitServerDerivedProductAnalyticsEvent,
} from "./serverEvents";

// The five facts the billing layer writes, and no others
// (docs/premium-entitlements.md, "Analytics facts written by the billing layer"). Each reports what
// happened to one person's access; conversion, churn and cohorts are queries over them at analysis
// time, so nothing here is shaped to feed a report.
//
// THE OFF SWITCH DOES NOT APPLY, ON PURPOSE. This is the implementation of that exemption, so a later
// reader does not take it for an oversight and "fix" it. Nothing below reads
// org.user_settings.product_analytics_enabled, and the switch itself is applied to client batches in
// apps/backend/src/routes/productAnalytics.ts, which these facts never pass through. They establish
// what we sold and when we granted or withdrew access, which accounting and support need whatever a
// person's analytics preference says. That is the whole of the exemption: no further billing event
// may be added to this file to route ordinary product analytics around the switch.
//
// AN AUTOMATION INSTALLATION IS NOT SUPPRESSED HERE, ALSO ON PURPOSE, and this is the other default
// a reader might expect from the neighbouring producers. ./contentWrites.ts and ./reviewAnswers.ts
// drop the facts of an installation that declared itself automation
// (db/migrations/0141_sync_installation_automation_marker.sql), because a card a script wrote and a
// review a script answered are that installation's own actions and counting them would smear the
// product metrics with synthetic activity. A billing transition is not an action of any installation:
// it happens at a provider or at an operator's hand, and the only thing a device does is be the next
// one to sync, which is what makes the change visible at all. Suppressing by the marker would
// therefore not drop a synthetic fact, it would lose a real one twice over: the fact would depend on
// which of a person's devices reached the pull first, and once the snapshot row is refreshed no later
// pull reports the change again, so it would be lost for good on an append-only table. These
// producers consequently read no installation and no replica, and pass no platform for the same
// reason.
//
// Every producer emits after the write it reports has committed, and none of them is on a path whose
// failure a person can see: a dropped emission is reported as a warning by the shared emitter and the
// billing operation stands.

export type EntitlementChangedFact = Readonly<{
  // The person whose access moved. It is written into both identity columns, because the account
  // deletion sweep matches on user_id and rewrites subject_user_id blind, so a person reachable only
  // through subject_user_id would outlive a deletion that believed it had covered them
  // (db/migrations/0120_backfill_product_analytics_server_facts.sql).
  userId: string;
  fromTier: ProductAnalyticsEntitlementTier;
  toTier: ProductAnalyticsEntitlementTier;
  fromStatus: ProductAnalyticsEntitlementStatus;
  toStatus: ProductAnalyticsEntitlementStatus;
  // Which kind of row the person's entitlement now rests on, never why it moved.
  source: ProductAnalyticsEntitlementSource;
  // The provider behind the purchase that now grants, absent when a grant or nothing does.
  provider: ProductAnalyticsBillingProvider | null;
  // The clock the resolution that discovered the change used, which is also the clock its snapshot
  // row was stored under.
  discoveredAt: Date;
}>;

/**
 * Reports one person's effective entitlement moving to a different tier or status.
 *
 * Both timestamps are the discovery clock, and they are equal because there is no second one to
 * record: the refresh runs on that person's next authenticated sync pull, the change itself happened
 * at a provider or at an operator's hand at an instant nothing at the call site can read, and the
 * purchase row's own dates describe the access period rather than when the answer moved. A reader of
 * this series therefore measures when we knew, which for a person who stops opening the app is
 * arbitrarily later than when it changed.
 *
 * The event id is derived from the person and that same clock, which separates the resolutions that
 * actually stored a row rather than collapsing them: the upsert applies only while its clock is newer
 * than the stored one, so two stored writes for one person never share it. That is a separation and not
 * a deduplication, and nothing here can dedupe one transition reported twice - the ids would differ.
 * What keeps that from happening is upstream: the caller reads the state it replaced under the write's
 * own row lock, so two racing pulls report two different transitions or one of them reports nothing
 * (../../billing/snapshot.ts). A pull retried after the row was stored finds the cached answer
 * unchanged and reaches neither the write nor this producer.
 *
 * The derivation is reproducible and this repository is public, so the second half of the key has to
 * be something a client cannot hold in advance. A person knows their own user id; the millisecond a
 * future resolution of theirs will run on is the server's, which is what keeps them from sending an
 * ordinary event carrying this row's id and suppressing it on an append-only table.
 */
export async function recordEntitlementChangedAnalytics(
  fact: EntitlementChangedFact,
): Promise<void> {
  const provider = fact.provider;
  await emitServerDerivedProductAnalyticsEvent({
    eventId: deriveServerDerivedProductAnalyticsEventId(
      "entitlement_changed",
      [fact.userId, fact.discoveredAt.toISOString()],
    ),
    eventName: "entitlement_changed",
    occurredAt: fact.discoveredAt,
    serverReceivedAt: fact.discoveredAt,
    userId: fact.userId,
    subjectUserId: fact.userId,
    // The billing layer resolves an account and knows nothing about the session or the workspace the
    // pull that triggered it came through.
    guestSessionId: null,
    workspaceId: null,
    platform: null,
    properties: {
      from_tier: fact.fromTier,
      to_tier: fact.toTier,
      from_status: fact.fromStatus,
      to_status: fact.toStatus,
      source: fact.source,
      ...(provider === null ? {} : { provider }),
    },
    details: null,
  });
}

// What every provider-driven fact below carries, because each is read off the same two rows: the
// purchase the provider is talking about, and the notification that said so.
//
// The four producers under this type have no call site yet. The writer that records a purchase
// transition is the first store rail, and none exists: no client asks a store to buy anything and the
// backend handles no provider notification (docs/premium-entitlements.md). Until that rail lands only
// `entitlement_changed` can fire, driven by an operator grant, and an empty series on any of the four
// is a producer nobody calls rather than a measurement.
type ProviderPurchaseFact = Readonly<{
  userId: string;
  // billing.purchases.purchase_id, our own key for the provider-side purchase. Every fact here is
  // keyed on it, so a provider redelivering the notification it was read from collides on event_id
  // and is counted once.
  purchaseId: string;
  tier: ProductAnalyticsEntitlementTier;
  provider: ProductAnalyticsBillingProvider;
  // When the provider says it happened, and when we stored the notification. They differ by the
  // delivery lag, which stays recoverable as their difference; a provider that supplies no time of
  // its own leaves the two equal.
  occurredAt: Date;
  receivedAt: Date;
}>;

export type TrialStartedFact = ProviderPurchaseFact;

/**
 * Reports one provider-granted free trial starting, keyed on the purchase that carries it.
 *
 * A purchase has at most one trial: the stores grant one introductory offer per store account and
 * decide eligibility themselves, so a second period on the same purchase row is a paid one and is
 * reported by the purchase fact below instead.
 */
export async function recordTrialStartedAnalytics(fact: TrialStartedFact): Promise<void> {
  await emitServerDerivedProductAnalyticsEvent({
    eventId: deriveServerDerivedProductAnalyticsEventId("trial_started", [fact.purchaseId]),
    eventName: "trial_started",
    occurredAt: fact.occurredAt,
    serverReceivedAt: fact.receivedAt,
    userId: fact.userId,
    subjectUserId: fact.userId,
    guestSessionId: null,
    workspaceId: null,
    platform: null,
    properties: {
      tier: fact.tier,
      provider: fact.provider,
    },
    details: null,
  });
}

export type PurchaseCompletedFact = ProviderPurchaseFact & Readonly<{
  kind: ProductAnalyticsPurchaseKind;
  // Absent on a `one_time` purchase, which has no period at all.
  period: ProductAnalyticsSubscriptionPeriod | null;
}>;

/**
 * Reports one purchase the person paid for, keyed on the purchase so a renewal of it is never a
 * second row: the decision happened once, and the provider charging again on schedule belongs to the
 * revenue reports.
 */
export async function recordPurchaseCompletedAnalytics(
  fact: PurchaseCompletedFact,
): Promise<void> {
  const period = fact.period;
  await emitServerDerivedProductAnalyticsEvent({
    eventId: deriveServerDerivedProductAnalyticsEventId("purchase_completed", [fact.purchaseId]),
    eventName: "purchase_completed",
    occurredAt: fact.occurredAt,
    serverReceivedAt: fact.receivedAt,
    userId: fact.userId,
    subjectUserId: fact.userId,
    guestSessionId: null,
    workspaceId: null,
    platform: null,
    properties: {
      tier: fact.tier,
      provider: fact.provider,
      kind: fact.kind,
      ...(period === null ? {} : { period }),
    },
    details: null,
  });
}

export type SubscriptionRevokedFact = ProviderPurchaseFact & Readonly<{
  reason: ProductAnalyticsSubscriptionRevokedReason;
}>;

/**
 * Reports one purchase a provider pulled back, keyed on the purchase because `revoked` is terminal:
 * a provider that redelivers the revocation, and every provider does, stores nothing further.
 *
 * An expiry is not reported here. Access ending because a paid-through date passed is nobody taking
 * anything back, and it is already visible as the entitlement change it produces.
 */
export async function recordSubscriptionRevokedAnalytics(
  fact: SubscriptionRevokedFact,
): Promise<void> {
  await emitServerDerivedProductAnalyticsEvent({
    eventId: deriveServerDerivedProductAnalyticsEventId("subscription_revoked", [fact.purchaseId]),
    eventName: "subscription_revoked",
    occurredAt: fact.occurredAt,
    serverReceivedAt: fact.receivedAt,
    userId: fact.userId,
    subjectUserId: fact.userId,
    guestSessionId: null,
    workspaceId: null,
    platform: null,
    properties: {
      tier: fact.tier,
      provider: fact.provider,
      reason: fact.reason,
    },
    details: null,
  });
}

export type AutorenewDisabledFact = ProviderPurchaseFact & Readonly<{
  // billing.provider_events.event_id, the provider's own delivery id for the notification this was
  // read from. It is part of the key because renewal can be turned off, back on and off again on one
  // purchase, so the purchase alone would count only the first of those as a churn signal while the
  // provider's id still collapses a redelivery of each.
  providerEventId: string;
}>;

/**
 * Reports auto-renewal turned off on a subscription the person still holds.
 *
 * Nothing about their access changes at that moment, which is why this is a fact of its own and why
 * it is the earliest churn signal we have. It is emitted only by the writer that records the
 * provider's cancellation signal, never from the snapshot refresh: the cached row's `will_renew`
 * eventually flips there too, and reporting both would count one cancellation twice, a pull later
 * than the provider said it.
 */
export async function recordAutorenewDisabledAnalytics(
  fact: AutorenewDisabledFact,
): Promise<void> {
  await emitServerDerivedProductAnalyticsEvent({
    eventId: deriveServerDerivedProductAnalyticsEventId(
      "autorenew_disabled",
      [fact.purchaseId, fact.providerEventId],
    ),
    eventName: "autorenew_disabled",
    occurredAt: fact.occurredAt,
    serverReceivedAt: fact.receivedAt,
    userId: fact.userId,
    subjectUserId: fact.userId,
    guestSessionId: null,
    workspaceId: null,
    platform: null,
    properties: {
      tier: fact.tier,
      provider: fact.provider,
    },
    details: null,
  });
}
