# Premium Entitlements

The platform contract for paid access: tiers, access status, how an entitlement is derived, and
what each client may trust. Every client follows the same rules as the backend. The mechanism lives
in [`apps/backend/src/billing/`](../apps/backend/src/billing/); this document states only what no
single file can.

## Decided later, on purpose

Open by explicit decision, not by oversight; do not read a placeholder anywhere in the codebase as a
decision:

- Per-person limit overrides (see [Limits resolve on the backend](#limits-resolve-on-the-backend)).

Prices, the plan name, limit numbers, and whether sandbox purchases grant entitlement are decided in
[docs/premium-offer.md](premium-offer.md).

## Tiers

[`tiers.ts`](../apps/backend/src/billing/tiers.ts) holds the tiers: a stable id and an integer rank
with gaps. `lifetime` is granted as a gift, not sold for now (see
[docs/premium-offer.md](premium-offer.md#lifetime-is-a-gift)).

Every client gates on the rank, never on a tier name: a feature asks whether the resolved rank is at
or above the rank it requires, so a `lifetime` holder passes every `premium` check. A client renders
the published display name and never holds its own table of tier names, so a tier shipped after its
release still renders and gates correctly.

## `guest` is not a tier

A guest is an account without an email (`apps/backend/src/guestAuth/`). It is a property of the
account, orthogonal to the tier: a guest can hold `premium`. Limits are therefore keyed by tier and
account kind ([`limits.ts`](../apps/backend/src/billing/limits.ts)). The browser guest
[AI trial policy](premium-offer.md#browser-guest-ai-trial) is request-specific and does not change the entitlement
snapshot or its numeric limits. `/me` and `/me/ai-usage` publish `browserGuestCapabilities` alongside
their existing fields so clients can distinguish access from allowance.

## Access status

Every provider's state maps into one vocabulary per purchase: `active` and `in_grace` grant access;
`expired` and `revoked` do not. `expired` is not terminal, because a provider can revive the same
purchase; `revoked` (refund, chargeback, family removal) is terminal for Apple and Google, while for
Stripe it covers only the current paid period. `is_trial` and `will_renew` are flags beside the
status, and the provider's own status is kept verbatim for support. The mappings are
[Apple](../apps/backend/src/billing/apple/provider.ts),
[Google](../apps/backend/src/billing/google/provider.ts) (RTDN revocation in
[`notifications.ts`](../apps/backend/src/billing/google/notifications.ts)) and
[Stripe](../apps/backend/src/billing/stripe/state.ts).

A cancelled subscription is not an ended one: a cancellation that has not reached its period end
stays `active` with `will_renew = false` on every provider. Revoking access at the cancellation
signal takes away time the person paid for.

## Effective entitlement is the highest rank

A person's effective entitlement is the highest-ranked tier across all of their purchases and grants
that currently grant access, sandbox purchases included (see
[docs/premium-offer.md](premium-offer.md#sandbox-purchases-grant-entitlement)). Holding several
active purchases, even of the same purchase on two platforms, is a supported state, so no code may
assume a single row ([`resolver.ts`](../apps/backend/src/billing/resolver.ts)).

## Derivation is a pure function; the snapshot is a cache

The effective entitlement is a pure, server-owned function over the stored purchases and grants
([`resolveEntitlement`](../apps/backend/src/billing/resolver.ts)). The stored snapshot is a cache
that may be truncated and rebuilt at any time with the same result: no writer edits it in a way the
function would not reproduce, a fix to the function is deployed and the snapshots rebuilt rather
than patched by a migration, and a missing snapshot is a cache miss, never an error.

## What a client receives

The resolved entitlement reaches clients inside the sync pull response
([`EntitlementWire`](../apps/backend/src/billing/snapshot.ts)). Its published `status` is `none`,
`active` or `in_grace`. Current AI consumption is left out on purpose, so the object does not change
after every AI call.

A client reads `status` before `until`, because a null `until` means something different under each:
under `active` it is access with no known end, the shape of a lifetime purchase; under `in_grace` it
is a grace end the provider has not sent, which no client may read as unlimited access; under `none`
there is nothing to end.

An absent entitlement means unknown, never free: a client keeps the last value it saw and downgrades
nobody on it. A billing-data problem may cost the paywall its input, and must never cost a person
their access or their sync.

## Offline behaviour

The two halves of premium fail in opposite directions on purpose.

- AI is checked server-side on every chat turn. There is no client-side AI budget, optimistic
  counter or offline allowance: a client cannot know what other devices have spent.
- Local premium features trust the last known snapshot with no expiry and fail open. A cancelled
  subscriber who stays offline keeps them indefinitely; the alternative punishes a paying person on a
  plane.

The snapshot is not signed: every client is open source, so any client-side check can be compiled
out. Enforcement lives on the server for everything that costs money.

## The monthly AI window is UTC

The AI usage window is a calendar month in UTC for everyone. Its only home and the reason it differs
from the caller-timezone progress endpoints are in
[`getAiUsageMonthWindow`](../apps/backend/src/aiUsage/cap.ts); do not unify the two.

## Where a guest can buy

A guest can buy in the App Store and on Google Play, not on the web. Both stores offer a restore path
tied to the store account, so a guest who reinstalls can recover a purchase. Stripe recovery runs
through an email a guest does not have, so a web guest links an email first.

## A purchase belongs to the store transaction, not to our account

The store transaction is the identity of a purchase; our account is an attachment to it.

- A purchase whose owner we cannot determine is stored with no `user_id`; server notifications
  routinely arrive this way. An unattached purchase grants nothing: guessing by email or device would
  grant a stranger's subscription.
- A purchase attaches when a client deliberately presents the transaction (purchase or Restore) while
  authenticated as that account, and moves to whichever account presented it last, which is what a
  shared family device produces. Automatic replay never moves it: it preserves the attached owner
  ([Apple](../apps/backend/src/routes/appleBilling.ts),
  [Google](../apps/backend/src/routes/googleBilling.ts)).

## Guest upgrade, reaping, and deletion

**Upgrade.** When a guest becomes an account, its purchases, billing state and all of its AI usage
move with the workspace content, so upgrading never resets a monthly budget
([`completeGuestUpgradeInExecutor`](../apps/backend/src/guestAuth/upgrade/index.ts) states the
ordering this needs).

**Reaping.** Browser-product retention follows the
[browser guest policy](auth-service.md#browser-guest-credentials). A guest that ever made a purchase
is never reaped; deleting it would destroy the only link between a paid transaction and its holder.
Any job that can reach a purchaser applies the guard in [`createWebGuestEverPurchasedGuardSql`](../apps/backend/src/guestAuth/reaper/index.ts).

**Deletion.** Account deletion anonymises billing history rather than deleting it, under the one
pseudonym the analytics and AI usage rewrites share
([`deleteRealAccountDataInExecutor`](../apps/backend/src/auth/accountDeletion.ts)). Provider
identifiers and the verbatim provider status are retained on accounting and claim-defence grounds;
personal fields inside stored provider payloads are cleared.

Every store rail must stamp `billing.provider_events.user_id` as soon as it has decoded a payload far
enough to know whose notification it is. The erasure finds a person's events only by that column or
by the purchase the event names, so an event that never decoded keeps the buyer's details out of its
reach for good ([`identity.ts`](../apps/backend/src/billing/identity.ts)). An undecoded event must be
either decoded and stamped, or not retained.

## Analytics facts written by the billing layer

The billing layer writes only the facts declared in the
[event catalog](../apps/backend/src/productAnalytics/catalog.ts) and produced in
[`billingFacts.ts`](../apps/backend/src/productAnalytics/serverFacts/billingFacts.ts). They are exempt
from the user-facing product-analytics off switch because accounting and support need what we sold
and when we granted or withdrew access; no other billing event may be added to route product
analytics around the switch. The paywall and purchase-flow events clients report are ordinary client
analytics, subject to the switch.

## Trials

Apple and Google decide trial eligibility, and we cannot override it. Stripe eligibility is ours:
[`getStripeAccountTrialEligibilityInExecutor`](../apps/backend/src/billing/stripe/identityStore.ts) and
the customer trial history read in [`provider.ts`](../apps/backend/src/billing/stripe/provider.ts).
`trial_consumed_at` and `trial_provider` are recorded for support and reporting, and nothing is
enforced from them.

## Limits resolve on the backend

Limits live in [`limits.ts`](../apps/backend/src/billing/limits.ts) and reach clients already resolved
to numbers. A client never holds a limit table, maps a tier to a number, or computes a limit from a
plan name, so changing a limit is a backend deploy that applies to every shipped client at once, with
no store release. Per-person overrides, when they land, resolve inside the same backend path.

## Sandbox and production are separated by a column

Every purchase carries an `environment`. Store sandboxes issue real-looking transactions and
renewals, so reports filter to production by default and ask for sandbox rows explicitly. The
resolver does not filter on it (see
[docs/premium-offer.md](premium-offer.md#sandbox-purchases-grant-entitlement)).
