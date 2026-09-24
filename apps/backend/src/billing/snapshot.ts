import type { AuthTransport } from "../auth";
import { unsafeTransaction } from "../database/unsafe";
import {
  captureBackendRuntimeWarning,
  createBackendObservationScope,
} from "../observability/runtime";
import { recordEntitlementChangedAnalytics } from "../productAnalytics/serverFacts/billingFacts";
import type { AccountKind, EntitlementLimits } from "./limits";
import {
  isEntitlementStatus,
  resolveEntitlement,
  type EntitlementStatus,
  type ResolvedEntitlement,
} from "./resolver";
import {
  loadEntitlementResolutionInputs,
  loadEntitlementResolutionInputsInExecutor,
  lockEntitlementSnapshotInExecutor,
  matchesResolvedEntitlement,
  upsertEntitlementSnapshotInExecutor,
  type EntitlementSnapshotWriteOutcome,
  type ReplacedEntitlementSnapshotState,
} from "./store";
import {
  getEntitlementTierDisplayName,
  getEntitlementTierRank,
  isEntitlementTier,
  type EntitlementTier,
} from "./tiers";

/**
 * What a client receives. The resolved `source` is stored but deliberately not published: which of a
 * person's rows won is a support question, not something a client should read. Current AI consumption
 * is not published either, so this object does not change after every AI call.
 *
 * The rank travels with the id because gating is defined as a rank comparison and a client must never
 * hold a tier table of its own (docs/premium-entitlements.md, "Tiers"). Without it, every client would
 * have to map ids to ranks itself, and a tier shipped after a client's release would fail closed there
 * instead of rendering its display name and gating correctly.
 */
export type EntitlementWire = Readonly<{
  tier: EntitlementTier;
  tierRank: number;
  tierDisplayName: string;
  status: EntitlementStatus;
  until: string | null;
  isTrial: boolean;
  willRenew: boolean;
  limits: EntitlementLimits;
}>;

export function toEntitlementWire(resolved: ResolvedEntitlement): EntitlementWire {
  return {
    tier: resolved.tier,
    tierRank: getEntitlementTierRank(resolved.tier),
    tierDisplayName: getEntitlementTierDisplayName(resolved.tier),
    status: resolved.status,
    until: resolved.until === null ? null : resolved.until.toISOString(),
    isTrial: resolved.isTrial,
    willRenew: resolved.willRenew,
    limits: resolved.limits,
  };
}

/**
 * A guest is an account without an email, created by the guest-session flow, and holding a paid tier
 * does not change that. The credential in use is what the request already knows, so the account kind
 * follows the transport rather than a column of its own: a guest that upgrades keeps its user id and
 * authenticates as an account from then on.
 */
export function resolveAccountKindForTransport(transport: AuthTransport): AccountKind {
  return transport === "guest" ? "guest" : "account";
}

/**
 * The same rule where no request and no transport exist. The chat worker runs after the request that
 * started the turn is gone, and carries the signed-in claim that request made on the run row
 * (`ai.chat_runs.initiating_auth_is_signed_in`), which the route sets from exactly the transports the
 * function above calls an account. Both readings live here so that no caller invents a third.
 */
export function resolveAccountKindForSignedInAuth(initiatingAuthIsSignedIn: boolean): AccountKind {
  return initiatingAuthIsSignedIn ? "account" : "guest";
}

/**
 * The part of a stored snapshot an entitlement change fact is about: the access the person had.
 */
type ReportableEntitlementState = Readonly<{
  tier: EntitlementTier;
  status: EntitlementStatus;
}>;

/**
 * The replaced row as a transition can name it, or null when it holds a vocabulary this code cannot
 * read. billing.entitlement_snapshots keeps tier and status as text and the cache heals by comparison
 * (store.ts), so a value outside today's catalogue is a row written by another generation of this code
 * rather than an error.
 */
function readReplacedEntitlementState(
  replaced: ReplacedEntitlementSnapshotState,
): ReportableEntitlementState | null {
  const tier = replaced.tier;
  const status = replaced.status;
  if (!isEntitlementTier(tier) || !isEntitlementStatus(status)) {
    return null;
  }

  return { tier, status };
}

/**
 * Emits the entitlement change fact for a refresh that became the stored answer.
 *
 * Both sides of the transition come from behind the write's row lock: the state left is the row the
 * write replaced, and the state arrived at is the resolution derived from purchases and grants read
 * after that lock was taken. Neither may come from the read before the transaction, and the reason is
 * the same for both. Two pulls for one person race, and a fact built from the earlier read would claim
 * they both left the state only one of them replaced, or would report arriving at an answer computed
 * from rows that a resolution already committed had moved on from - a churn event and a re-conversion
 * that never happened, counted permanently on a table nothing rewrites. Behind the lock the second pull
 * sees its own predecessor and its own current inputs, so it reports the transition it actually made
 * or, when there is nothing between them, nothing at all.
 *
 * Three conditions narrow the writing branch down to the transitions this series is for, and each is a
 * decision rather than a saving:
 *
 * Replacing no row is not a change, and is handled by the caller. The snapshot may be truncated and
 * rebuilt at any time (docs/premium-entitlements.md, "Derivation is a pure function; the snapshot is a
 * cache"), so a missing row is no evidence that anything happened: reporting one would fire for every
 * person in the product on their next pull after a rebuild, and once for every existing person after
 * the deploy that added this. The first stored value is a baseline. What that gives up is the person
 * whose very first resolution already carries paid access, and the store rail that put it there
 * reports the purchase itself.
 *
 * That branch is also the one place the compare-and-swap does not hold, which makes reporting nothing
 * there load-bearing rather than merely uninteresting: with no row to lock, two first-ever resolutions
 * of one person are ordered only by the primary key, so both can come back `stored` having seen no
 * earlier state (`store.ts`, `lockEntitlementSnapshotInExecutor`). A fact from either would be one
 * arrival stored twice under two derived ids, on a table nothing rewrites.
 *
 * A write the clock guard discarded is not a change either, and is also handled by the caller. A
 * resolution carrying an older clock than the stored row stores nothing, and a fact from it would
 * describe a state that never became current.
 *
 * A move of the paid-through date alone is a renewal rather than a change in access, and is handled
 * below. The stored row differs whenever `until`, `is_trial`, `will_renew` or `source` moved too,
 * which is what keeps the cache correct, and none of those changes what the person may do.
 */
async function reportEntitlementChange(
  userId: string,
  replaced: ReplacedEntitlementSnapshotState,
  resolved: ResolvedEntitlement,
  discoveredAt: Date,
): Promise<void> {
  const previous = readReplacedEntitlementState(replaced);
  if (previous === null) {
    // An unreadable value cannot equal a value this code can name, so access did move and only the
    // state it moved from is unnameable. Recorded rather than dropped
    // silently, because the fact is lost for good: the row is refreshed now and no later pull reports
    // the same change again.
    captureBackendRuntimeWarning({
      action: "entitlement_changed_analytics_skipped",
      scope: createBackendObservationScope(
        "backend-api",
        null,
        null,
        null,
        userId,
        null,
        null,
        null,
        null,
        null,
        null,
      ),
      details: {
        reason: "unreadable_cached_entitlement",
        cachedTier: replaced.tier,
        cachedStatus: replaced.status,
        resolvedTier: resolved.tier,
        resolvedStatus: resolved.status,
      },
    });
    return;
  }

  if (previous.tier === resolved.tier && previous.status === resolved.status) {
    return;
  }

  await recordEntitlementChangedAnalytics({
    userId,
    fromTier: previous.tier,
    toTier: resolved.tier,
    fromStatus: previous.status,
    toStatus: resolved.status,
    source: resolved.source,
    // The resolver names which kind of row won and never which provider sold it, so no provider is
    // readable here: a grant-backed entitlement has none at all, and for a purchase-backed one the
    // value arrives with the store rail that gives the resolver a provider to carry.
    provider: null,
    discoveredAt,
  });
}

/**
 * What one writing refresh did: the access it replaced, the resolution it derived behind the lock, and
 * whether that resolution became the stored one. All three come out of the transaction together
 * because only there are they consistent with each other.
 */
type EntitlementRefresh = Readonly<{
  replaced: ReplacedEntitlementSnapshotState | null;
  resolved: ResolvedEntitlement;
  outcome: EntitlementSnapshotWriteOutcome;
}>;

/**
 * The same resolution without the cache refresh: the inputs read, the pure resolver, and the wire
 * mapper, and nothing else. It writes nothing at all - no snapshot upsert, and therefore no
 * `entitlement_changed` fact.
 *
 * Which of the two a caller takes is decided by whether it is allowed to change stored state, not by
 * convenience. A surface whose answer the person acts on calls the writing one below, so the cached row
 * keeps up and a real entitlement change is reported once, where it happened: the sync pull does, and a
 * paywall input would. A surface that only reports calls this one, and the agent usage tool
 * (`apps/backend/src/aiUsage/status.ts`) is the first: it is annotated read-only on every agent
 * surface, and an agent asking what it has left must neither be the discoverer of an entitlement change
 * nor time that fact to its own call.
 *
 * The two cannot disagree about the answer. Both publish `toEntitlementWire` over the same
 * `resolveEntitlement`, and the row the other one refreshes is a cache that may be truncated and
 * rebuilt at any time (docs/premium-entitlements.md, "Derivation is a pure function; the snapshot is a
 * cache"), so skipping the refresh costs a later reader one recomputation and nothing else.
 */
export async function resolveEntitlementForUserWithoutRefresh(
  userId: string,
  accountKind: AccountKind,
  now: Date,
): Promise<EntitlementWire> {
  const inputs = await loadEntitlementResolutionInputs(userId);
  return toEntitlementWire(resolveEntitlement(
    inputs.purchases,
    inputs.grants,
    accountKind,
    now,
  ));
}

/**
 * Resolve the person's entitlement, refresh the cached row when the answer moved, and return the wire
 * shape. This is the I/O boundary the pure resolver sits behind. A caller that must not write reads
 * through `resolveEntitlementForUserWithoutRefresh` above instead.
 *
 * A missing cached row is a cache miss rather than an error state, and an unchanged entitlement is not
 * rewritten, so the hot sync path runs one read and writes nothing for the overwhelming majority of
 * requests. The billing tables always win over this row: it is safe to TRUNCATE and rebuild, and
 * nothing may count from it.
 *
 * The writing branch is a compare-and-swap and resolves twice on purpose. The first resolution decides
 * only whether opening a write is worth it, and it is computed from a read on a pooled connection that
 * may already be out of date by the time the write runs. The second is computed inside the transaction,
 * from rows read after this person's snapshot row is locked, and it is the one that is stored and
 * reported - so what is stored can no longer be an older answer overwriting a newer one, and what is
 * reported is a transition that really happened. Only this branch pays the extra read, and it is the
 * rare one.
 */
export async function resolveEntitlementSnapshotForUser(
  userId: string,
  accountKind: AccountKind,
  now: Date,
): Promise<EntitlementWire> {
  const inputs = await loadEntitlementResolutionInputs(userId);
  const resolved = resolveEntitlement(
    inputs.purchases,
    inputs.grants,
    accountKind,
    now,
  );
  const cached = inputs.cached;
  if (cached === null || !matchesResolvedEntitlement(cached, resolved)) {
    // The entitlement looks changed for this person, which is the only branch that writes, and the one
    // place the entitlement change fact is reported from. The other four facts the billing layer
    // writes - a trial start, a paid purchase, a revoke and auto-renew disabled - belong to the writer
    // that records a provider's purchase transition, which does not exist yet
    // (../productAnalytics/serverFacts/billingFacts.ts).
    //
    // "Looks changed" is all the comparison above can say, and it is only used to decide whether to
    // open the transaction: being wrong costs one transaction that stores nothing. Everything that is
    // stored or reported is derived again below, behind the lock.
    const refresh = await unsafeTransaction(async (executor): Promise<EntitlementRefresh> => {
      const replaced = await lockEntitlementSnapshotInExecutor(executor, userId);
      const lockedInputs = await loadEntitlementResolutionInputsInExecutor(executor, userId);
      const lockedResolution = resolveEntitlement(
        lockedInputs.purchases,
        lockedInputs.grants,
        accountKind,
        now,
      );
      const outcome = await upsertEntitlementSnapshotInExecutor(
        executor,
        userId,
        lockedResolution,
        now,
      );
      return { replaced, resolved: lockedResolution, outcome };
    });

    const replaced = refresh.replaced;
    if (replaced !== null && refresh.outcome === "stored") {
      // Emitted after the transaction rather than inside it: the analytics writer holds its own
      // connection and commits at once, so a fact emitted inside would survive a rollback of the very
      // row it reports. Awaited, because this runs in a Lambda that stops executing once the response
      // is returned, and it cannot fail the pull: the shared emitter reports a refused write as a
      // warning and returns.
      await reportEntitlementChange(userId, replaced, refresh.resolved, now);
    }

    // The resolution behind the lock is the newer of the two, whether or not it won the write, so it is
    // the one published. A `superseded` outcome means another resolution's clock was ahead of this
    // request's start, not that this answer was derived from staler rows.
    return toEntitlementWire(refresh.resolved);
  }

  return toEntitlementWire(resolved);
}
