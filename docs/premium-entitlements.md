# Premium Entitlements

The settled platform contract for paid access: tiers, access status, how an entitlement is
derived, and what each client is allowed to trust. Every later change to billing, limits, or
paywalls reads this document instead of re-deriving the rules, and every client reads the same
rules as the backend.

No store integration exists yet. No client asks a store to buy anything, and the backend validates
no receipt and handles no provider webhook: the only store SDKs linked anywhere are `StoreKit` on
iOS, for the review prompt and the Subscription page's product lookup and Manage subscription
sheet, and Play review on Android. The `billing` schema is already migrated
(`db/migrations/0151_billing_schema.sql`), and `provider_events`, `purchases`, `grants` and
`user_billing_state` are all still empty, because no writer yet creates a table's first row. Each
does have a writer now, and none of it is ingestion: the identity lifecycle rewrites rows it finds,
on account deletion and on guest upgrade (`apps/backend/src/billing/identity.ts`). The one insert
among those is the `user_billing_state` merge an upgrade performs, and it can only run when a guest
already has a row to merge, so it cannot create the table's first row. A store rail still has
to write the first row. This document is the contract those rails must satisfy, so it is
deliberately written ahead of the code.

The entitlement half of it is built, in `apps/backend/src/billing/`: `tiers.ts` is the catalogue,
`limits.ts` the limits keyed by tier and account kind, `resolver.ts` the pure derivation,
`store.ts` the reads and the cached row it writes, `snapshot.ts` the cache and the shape
clients receive, and `identity.ts` the rewrites that move a person's rows to another account or
anonymise them. That module settles the derivation, its cache and those rewrites and nothing else:
no store rail exists to feed it, and the billing work still missing elsewhere is named by the
sections that own it. `entitlement_snapshots` is the table that writer keeps: `snapshot.ts` refreshes
it through `store.ts` when the answer it just resolved differs from the stored row — on the first
resolution for that person as much as on a later change, and it is the one billing row that may be
created out of nothing, because it is derived. The derivation itself writes
nothing, and nothing pushes the refresh: the only trigger is that person's next authenticated sync
pull, so the row lags a change in their purchases or grants until that pull arrives. Anything
reaching those rows, account deletion included, has to account for them.

This document links to source rather than restating mechanism, because the source is what ships.

## Decided later, on purpose

These are open by explicit decision, not by oversight. Do not invent them, and do not read a
placeholder anywhere in the codebase as a decision:

- Paywall UI, placement, and trigger copy on every client.
- Per-person limit overrides (see [Limits resolve on the backend](#limits-resolve-on-the-backend)).

Prices, the plan name, limit numbers, and whether sandbox purchases grant entitlement are decided in
[docs/premium-offer.md](premium-offer.md).

## Tiers

Three tiers. The stable id is the identity, and the rank is an explicit integer with gaps so a
future tier can land between two existing ones without a renumber:

| Stable id | Rank | Meaning |
| --- | --- | --- |
| `free` | 10 | No paid access. Every account starts here, including guests. |
| `premium` | 20 | The recurring paid tier. |
| `lifetime` | 30 | Access that never expires. Granted as a gift, not sold for now (see [docs/premium-offer.md](premium-offer.md#lifetime-is-a-gift)). |

Tier comparisons use the rank, never the name. No code may branch on `tier === 'premium'` to mean
"has paid": a `lifetime` holder would fail that test. The only correct question is whether the
resolved rank is at or above the rank a feature requires.

Clients receive the stable id and a separate display-name field. A client renders the display name
and gates on the rank, so a tier shipped after a client's release still renders and still gates
correctly instead of falling back to "unknown". A client must never hold its own table of tier
names.

## `guest` is not a tier

A guest is an account without an email, created by the guest-session flow
(`apps/backend/src/guestAuth/`). It is a property of the account, orthogonal to the tier: a guest
can hold `premium`.

Limits are therefore keyed by `(tier, account_kind)`, where `account_kind` separates an account
with an email from a guest session without one. A free guest and a free signed-in user can carry
different limits without either becoming a tier. The stored spelling of `account_kind` belongs to
the schema, not to this document.

## Access status

One vocabulary across all providers, two orthogonal flags, and the provider's own status kept
verbatim.

Status — exactly one per purchase:

| Status | Grants access | Meaning |
| --- | --- | --- |
| `active` | yes | Paid through a future date, or inside a trial. |
| `in_grace` | yes | Past the paid-through date, still granted while the provider retries payment. |
| `expired` | no | Access ended. Not terminal: a provider can revive the same purchase. |
| `revoked` | no | The provider pulled the purchase (refund, chargeback, family removal). Terminal. |

Two flags, independent of the status and of each other:

- `is_trial` — the current period is a provider-granted free trial. A trial is `active`, not a
  fourth status.
- `will_renew` — the provider intends to charge again. `false` on an `active` purchase is the
  normal shape of a cancellation that has not reached its period end yet.

Alongside these, the provider's own status string is stored verbatim and never normalised away.
Support answers questions the derived vocabulary cannot: a person reporting a failed charge needs
Apple's `3` or Stripe's `past_due`, not our `in_grace`.

### Provider mapping

Apple, from the App Store Server API subscription status:

| Apple | Status | Notes |
| --- | --- | --- |
| `1` Active | `active` | |
| `2` Expired | `expired` | |
| `3` In billing retry | `expired` | Access ended, but Apple may still recover the charge. |
| `4` In billing grace period | `in_grace` | Access continues. |
| `5` Revoked | `revoked` | |

Google Play, from `subscriptionState` (the wire enum carries a `SUBSCRIPTION_STATE_` prefix) plus
one RTDN type:

| Google | Status | Notes |
| --- | --- | --- |
| `ACTIVE` | `active` | |
| `CANCELED` | `active` | **Still grants access until the period ends.** `will_renew` is `false`. |
| `IN_GRACE_PERIOD` | `in_grace` | Access continues. |
| `ON_HOLD` | `expired` | Recoverable. |
| `PAUSED` | `expired` | Person-initiated pause; recoverable. |
| `PENDING` | `expired` | Never granted; the signup has not completed payment. |
| `EXPIRED` | `expired` | |
| RTDN `SUBSCRIPTION_REVOKED` | `revoked` | |

Stripe, from the subscription status:

| Stripe | Status | Notes |
| --- | --- | --- |
| `trialing` | `active` | `is_trial` is `true`. |
| `active` | `active` | With `cancel_at_period_end`, **access continues to the period end** and `will_renew` is `false`. |
| `past_due` | `in_grace` | Access continues while Stripe retries. |
| `unpaid` | `expired` | Retries exhausted. |
| `paused` | `expired` | |
| `canceled` | `expired` | A refund or dispute is what produces `revoked`, not this status. |
| `incomplete`, `incomplete_expired` | `expired` | Never granted. |

The two rows in bold are the mistake this table exists to prevent: a cancelled subscription is not
an ended subscription. Revoking access at the cancellation signal takes away time the person paid
for.

## Effective entitlement is the highest rank

A person's effective entitlement is the highest-ranked tier across all of their purchases and
grants that currently grant access. Nothing else is consulted.

A purchase marked `sandbox` takes part in that set like any other, in production too (see
[docs/premium-offer.md](premium-offer.md#sandbox-purchases-grant-entitlement)).

There is deliberately no uniqueness rule of one active purchase per person. Someone can hold an
App Store `premium` subscription and a `lifetime` purchase from the web at the same time, and the
same purchase can arrive on two platforms. That is a supported state, not a data error, and no
code may assume a single row. Deduplication, refunds, and double-charge questions are support and
accounting concerns, not entitlement concerns.

## Derivation is a pure function; the snapshot is a cache

The effective entitlement is computed by a pure function over the stored purchases and grants —
inputs in, resolved entitlement out, no I/O, no clock reads beyond an injected `now`. This follows
the repository rule that domain logic is pure and server-owned
(`CLAUDE.md`, Engineering Principles).

The stored snapshot row is a cache. It may be truncated and rebuilt from the purchases at any
time, and doing so must produce the same result. This means:

- No writer may edit a snapshot in a way the pure function would not reproduce.
- A bug fixed in the function is deployed and the snapshots are rebuilt; there is no migration to
  patch derived values.
- A missing snapshot is never an error state. It is a cache miss, resolved by computing.

## What a client receives

The resolved entitlement reaches clients inside the sync pull response, carrying `tier`, `tierRank`,
`tierDisplayName`, `status`, `until`, `isTrial`, `willRenew` and `limits`. The rank travels with the
id so gating stays a rank comparison on every already-shipped client (see [Tiers](#tiers)). Which
row won is not published: `source` is stored for support only. Current AI consumption is absent on
purpose, so the object does not change after every AI call.

The published `status` is `none`, `active` or `in_grace`, and never the other two. Those belong to a
single purchase, and a purchase that grants nothing cannot be the effective entitlement, so `none`
is how holding nothing is expressed.

A client reads `status` before `until`, because a null `until` means something different under each
one. With `active` it is access with no end we know of, which is the shape of a lifetime purchase.
With `in_grace` it is a provider that has not told us when the grace ends: the end is unknown rather
than absent, and no client may read it as unlimited access. With `none` there is nothing to end.

The field is omitted from the response when the entitlement cannot be resolved. An absent
entitlement means unknown, never free: a client keeps the last value it saw and downgrades nobody on
it. A billing-data problem may cost the paywall its input, and must never cost a person their access
or their sync.

## Offline behaviour

The two halves of "premium" fail in opposite directions on purpose.

The chat turn is checked server-side on every request. There is no client-side AI budget, no optimistic
local counter, and no offline AI allowance. A client cannot know what other devices have spent, so
letting it decide would give away as much AI per month as the person owns devices.

Client-side premium — customisation and other local features — trusts the last known snapshot with
no expiry, and fails open. An offline client with a stale snapshot keeps the features it last saw.
We accept that a cancelled subscriber who stays offline keeps local features indefinitely, because
the alternative punishes the far more common case: a paying person on a plane.

The snapshot is not signed. Every client is MIT-licensed open source, so any check a client
performs can be removed by recompiling it, and a signature over the snapshot buys nothing but
complexity. Enforcement lives on the server for everything that costs money.

## The monthly AI window is UTC

The AI usage window is a calendar month in UTC, for everyone, regardless of where they are.
`getAiUsageMonthWindow` (`apps/backend/src/aiUsage/cap.ts`) is the rule's only home in code: it
resolves the window that both the usage sum and the allowance are read against. It kept the
convention of the guest quota it replaced, which keyed usage by a `YYYY-MM` month resolved in UTC
in a table `db/migrations/0157_drop_guest_ai_monthly_usage.sql` has since dropped.

This deliberately differs from the progress and streak endpoints, which resolve days in the
caller's timezone and echo it back (`apps/backend/src/progress/timeZone.ts`). Those answer "what
did I do today", which is a question about the person's day. A spend window answers "how much have
we paid for", which is a question about our month. Do not unify the two.

## Where a guest can buy

A guest can buy in the App Store and on Google Play. A guest cannot buy on the web.

Both stores tie a purchase to the store account and offer a restore path that needs nothing from
us, so a guest who reinstalls can recover a purchase. Stripe has no equivalent: recovery there
runs through an email that a guest does not have. Selling a guest a web subscription would sell
them something they cannot get back.

## A purchase belongs to the store transaction, not to our account

The store transaction is the identity of a purchase. Our account is an attachment to it.

- A purchase whose owner we cannot determine is stored with no `user_id`. Server-to-server
  notifications arrive this way routinely, before any client of ours has spoken.
- An unattached purchase never grants anything. There is no account to grant to, and guessing by
  email or device would grant a stranger's subscription.
- A purchase attaches when a client presents the transaction while authenticated as that account.

Transfer follows from this: a store transaction presented by a different account moves to the
account that presented it last. This is the behaviour a shared family device produces, and
refusing the move would strand the purchase on whichever account happened to reach us first.

## Guest upgrade, reaping, and deletion

**Upgrade.** When a guest becomes an account, purchases, billing state, and AI usage must move into
the target account along with the workspace content
(`apps/backend/src/guestAuth/upgrade/index.ts`, `apps/backend/src/guestAuth/merge/index.ts`). Every
AI usage row the guest owns moves, not only the window in progress: moving all of them costs the
same and keeps per-person reporting continuous across an upgrade. AI usage must move so that
upgrading is not a way to reset a monthly budget.

That transfer is built, in `completeGuestUpgradeInExecutor`
(`apps/backend/src/guestAuth/upgrade/index.ts`). It has to stay ahead of
`cleanupGuestSessionSourceInExecutor` (`apps/backend/src/guestAuth/delete/index.ts`), which deletes
the guest's `org.user_settings` row: once that row is gone there is no guest identity left to move
anything away from, and a mover placed after it moves nothing while still reporting success. Nothing
cascades the usage away: `ai.usage_events` holds no foreign key into `org.user_settings`, so those
rows survive that delete and are simply left naming a user id nobody can resolve, which is the
failure a mover placed too late produces. The quota table that did cascade,
`auth.guest_ai_monthly_usage`, no longer exists (`db/migrations/0157_drop_guest_ai_monthly_usage.sql`).

**Reaping.** A guest that ever made a purchase is never reaped. Deleting the account row cascades
its guest-scoped tables, which would destroy the only link between a paid transaction and the
person holding it.

The guard has nothing to protect in the current job. The only reaper
(`apps/backend/src/guestAuth/reaper/index.ts`) takes inactive web guests and nothing else: its
candidate query filters `guest_sessions.platform = 'web'`, and `ios` and `android` guests are
deliberately never candidates. A web guest is exactly the guest who cannot buy anything (see
[Where a guest can buy](#where-a-guest-can-buy)). The rule is written here for whoever widens that
job to mobile guests, or adds another job that can reach a purchaser.

**Deletion.** Account deletion must anonymise the billing history rather than delete it, exactly as
the analytics rewrite does, and under the same fresh identifier that rewrite mints
(`apps/backend/src/auth/accountDeletion.ts`). Provider identifiers — transaction ids, subscription
ids, the verbatim provider status — must be retained on accounting and claim-defence grounds, and
personal fields inside stored provider payloads must be cleared.

A store rail must stamp `provider_events.user_id` as soon as it has decoded the payload far enough to
know whose notification it is. That is a requirement of the rail, not an optimisation: it is what puts
a row within reach of the erasure at all. The erasure finds a person's events by that column or by the
purchase the event names, and for Google and Stripe the insert precedes the decode, so `user_id`,
`provider_purchase_id` and `environment` are all NULL at insert time. An event whose handling then
failed permanently is named by neither, and it keeps `payload_raw` — the bytes exactly as received,
which is why reporting is denied that column at all — with the buyer's details still in it. Such a row
is outside the erasure's reach for good, and no later rewrite can find it. Treat an undecoded event as
a row that must be either decoded and stamped, or not retained.

That identifier is minted once per deletion in `deleteRealAccountDataInExecutor` and handed to the
analytics, billing and AI usage rewrites inside the one transaction
(`apps/backend/src/auth/accountDeletion.ts`). The rule it exists to serve is the part that may not be
relaxed: an anonymiser that mints its own pseudonym instead leaves one person's histories under
identifiers that can never be brought back together.

## Analytics facts written by the billing layer

The billing layer writes exactly these facts, as facts, and no others:

- an entitlement change
- a trial start
- a first paid purchase
- a revoke
- auto-renew disabled

All five are declared in the event catalog (`apps/backend/src/productAnalytics/catalog.ts`) and have
a server-side producer (`apps/backend/src/productAnalytics/serverFacts/billingFacts.ts`). Only the
entitlement change has a call site: the snapshot refresh in `apps/backend/src/billing/snapshot.ts`.
The other four are emitted by the writer that records a provider's purchase transition, which
arrives with the first store rail, so until then an empty series on any of them is a producer nobody
calls rather than a measurement. The refresh is triggered by that person's next authenticated sync
pull and by nothing else, so an entitlement change is timed to the pull that discovered it.

Per the repository rule, these record what happened; conversion funnels, cohorts, and churn are
queries over them at analysis time, never an event shaped to feed one report.

These facts must be exempt from the user-facing product-analytics off switch, which drops client
batches for an opted-out person (`apps/backend/src/routes/productAnalytics.ts`). The exemption is
deliberate and matches the existing server-derived facts: these records establish what we sold and
when we granted or withdrew access, which we need for accounting and support regardless of an
analytics preference. They are not a way to route product analytics around the switch, and no
other billing event may be added to this list to do that.

## Trials

Apple and Google decide trial eligibility, and we cannot override it. A person who consumed an
introductory offer on their store account is ineligible by the store's own bookkeeping, whatever
our records say.

We will record `trial_consumed_at` and `trial_provider` for support and reporting, and enforce
nothing from them at launch. They are there so that a later decision has history to work from.

## Limits resolve on the backend

Limits live in backend code and reach clients already resolved to numbers for that person's tier
and account kind. A client never holds a limit table, never maps a tier to a number, and never
computes a limit from a plan name.

The consequence is the point: changing a limit is a backend deploy. It needs no client release, no
App Store review, and no Play rollout, and it applies to every already-shipped client at once.
Nothing may leak a limit into a client in a way that breaks this.

Per-person overrides are deliberately deferred. When they land, they resolve inside this same
backend path, so clients do not change.

## Sandbox and production are separated by a column

Every purchase carries an `environment` marking it sandbox or production. Store sandboxes issue
real-looking transactions with real-looking renewals, and test purchases in the production tables
are indistinguishable from revenue once the column is missing.

Reports filter to production by default. A query that wants sandbox rows asks for them
explicitly. The entitlement resolver does not filter on `environment`: sandbox purchases grant
entitlement in production (see [docs/premium-offer.md](premium-offer.md#sandbox-purchases-grant-entitlement)).
