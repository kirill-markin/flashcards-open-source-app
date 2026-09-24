import type { AuthTransport } from "../auth";
import { unsafeTransaction } from "../database/unsafe";
import type { AccountKind, EntitlementLimits } from "./limits";
import {
  resolveEntitlement,
  type EntitlementStatus,
  type ResolvedEntitlement,
} from "./resolver";
import {
  loadEntitlementResolutionInputs,
  matchesResolvedEntitlement,
  upsertEntitlementSnapshotInExecutor,
} from "./store";
import {
  getEntitlementTierDisplayName,
  getEntitlementTierRank,
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
 * Resolve the person's entitlement, refresh the cached row when the answer moved, and return the wire
 * shape. This is the I/O boundary the pure resolver sits behind.
 *
 * A missing cached row is a cache miss rather than an error state, and an unchanged entitlement is not
 * rewritten, so the hot sync path runs one read and writes nothing for the overwhelming majority of
 * requests. The billing tables always win over this row: it is safe to TRUNCATE and rebuild, and
 * nothing may count from it.
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
  if (inputs.cached === null || !matchesResolvedEntitlement(inputs.cached, resolved)) {
    // The entitlement changed for this person, which is the only branch that writes: a transaction is
    // opened here rather than around the read because this is where the product analytics facts the
    // billing layer writes - an entitlement change, a trial start, a first paid purchase, a revoke,
    // auto-renew disabled - are emitted once they are added to the event catalog, and they have to
    // commit with the row. That is a separate change.
    await unsafeTransaction(async (executor) => {
      await upsertEntitlementSnapshotInExecutor(executor, userId, resolved, now);
    });
  }

  return toEntitlementWire(resolved);
}
