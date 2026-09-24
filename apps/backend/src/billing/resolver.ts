import {
  freeEntitlementTier,
  getEntitlementTierRank,
  type EntitlementTier,
} from "./tiers";
import {
  resolveEntitlementLimits,
  type AccountKind,
  type EntitlementLimits,
} from "./limits";

/**
 * The status stored on one purchase, in the vocabulary every provider is mapped into
 * (docs/premium-entitlements.md, "Access status"). Constrained in the schema, so these four are the
 * only values billing.purchases.status can hold.
 */
export type PurchaseStatus = "active" | "in_grace" | "expired" | "revoked";

/**
 * The status of a resolved entitlement, which is not a copy of a purchase status: only a purchase or
 * grant that currently grants access can become the effective entitlement, so `expired` and
 * `revoked` cannot appear here, and `none` is needed to express holding nothing.
 */
export type EntitlementStatus = "none" | "active" | "in_grace";

/**
 * Whether a stored string is one of those three. The cached snapshot keeps its status as text and is
 * healed by comparison (store.ts), so this is how a reader that has to name the status it read - and
 * not merely compare it - finds out whether it can.
 */
export function isEntitlementStatus(value: string): value is EntitlementStatus {
  return value === "none" || value === "active" || value === "in_grace";
}

export type EntitlementSource = "none" | "purchase" | "grant";

/**
 * A purchase attached to the person being resolved. A purchase with no `user_id` is not an input at
 * all: an unattached purchase has no account to grant to
 * (docs/premium-entitlements.md, "A purchase belongs to the store transaction, not to our account").
 */
export type EntitlementPurchaseInput = Readonly<{
  purchaseId: string;
  tier: EntitlementTier;
  status: PurchaseStatus;
  isTrial: boolean;
  willRenew: boolean;
  until: Date | null;
  graceUntil: Date | null;
}>;

export type EntitlementGrantInput = Readonly<{
  grantId: string;
  tier: EntitlementTier;
  expiresAt: Date | null;
  revokedAt: Date | null;
}>;

export type ResolvedEntitlement = Readonly<{
  tier: EntitlementTier;
  status: EntitlementStatus;
  until: Date | null;
  isTrial: boolean;
  willRenew: boolean;
  source: EntitlementSource;
  limits: EntitlementLimits;
}>;

type GrantingCandidate = Readonly<{
  candidateId: string;
  tier: EntitlementTier;
  status: "active" | "in_grace";
  until: Date | null;
  isTrial: boolean;
  willRenew: boolean;
  source: "purchase" | "grant";
}>;

/**
 * Expiry is decided here, by comparing the stored dates with the injected `now`, which is why no
 * expiry worker exists and why a stored row never has to be rewritten when it lapses.
 *
 * A missing end date is treated as "no end we know of" rather than as "already over", both for an
 * active purchase - which is the shape of a one-time lifetime purchase - and for a purchase the
 * provider has put in grace without telling us when the grace ends. Withdrawing access from a person
 * the provider says is paid up is the worse of the two mistakes.
 */
function toPurchaseCandidate(
  purchase: EntitlementPurchaseInput,
  now: Date,
): GrantingCandidate | null {
  if (purchase.status === "revoked" || purchase.status === "expired") {
    return null;
  }

  if (purchase.status === "in_grace") {
    if (purchase.graceUntil !== null && purchase.graceUntil.getTime() <= now.getTime()) {
      return null;
    }

    return {
      candidateId: purchase.purchaseId,
      tier: purchase.tier,
      status: "in_grace",
      until: purchase.graceUntil,
      isTrial: purchase.isTrial,
      willRenew: purchase.willRenew,
      source: "purchase",
    };
  }

  if (purchase.until !== null && purchase.until.getTime() <= now.getTime()) {
    return null;
  }

  return {
    candidateId: purchase.purchaseId,
    tier: purchase.tier,
    status: "active",
    until: purchase.until,
    isTrial: purchase.isTrial,
    willRenew: purchase.willRenew,
    source: "purchase",
  };
}

/**
 * A grant stands beside a purchase rather than modifying one, and it carries neither a trial nor a
 * renewal: nobody is going to be charged for it. Revocation is terminal and is not compared with
 * `now`: a revoked grant never grants again, whatever date the revocation carries.
 */
function toGrantCandidate(
  grant: EntitlementGrantInput,
  now: Date,
): GrantingCandidate | null {
  if (grant.revokedAt !== null) {
    return null;
  }

  if (grant.expiresAt !== null && grant.expiresAt.getTime() <= now.getTime()) {
    return null;
  }

  return {
    candidateId: grant.grantId,
    tier: grant.tier,
    status: "active",
    until: grant.expiresAt,
    isTrial: false,
    willRenew: false,
    source: "grant",
  };
}

/**
 * How long a candidate's access lasts, as one comparable number. A missing end date means two
 * different things, so it cannot map to one value: on an `active` candidate it is a purchase or grant
 * with no end at all, which is the shape of a lifetime purchase, while on an `in_grace` candidate it
 * is a provider that has not told us when the grace ends. Only the first is unbounded. An unknown
 * grace end therefore sorts below every known one rather than above all of them, so wherever there is
 * a choice the candidate carrying a real date wins. This orders candidates and nothing more: a lone
 * `in_grace` candidate with no grace end is still published as `until: null`, and what a null end
 * means is settled for clients by the status beside it
 * (docs/premium-entitlements.md, "What a client receives"). Because the status is compared first, an
 * unknown grace end is only ever compared with another grace period.
 */
function getAccessDurationOrder(candidate: GrantingCandidate): number {
  if (candidate.until !== null) {
    return candidate.until.getTime();
  }

  return candidate.status === "active" ? Number.POSITIVE_INFINITY : Number.NEGATIVE_INFINITY;
}

/**
 * Highest rank wins. There is deliberately no uniqueness rule of one active purchase per person, so
 * the remaining comparisons exist to make the winner deterministic when two candidates tie on rank:
 * the one whose access is not already in grace, then the one that lasts longer, then the one that
 * will renew, then the one that is not a trial, then a purchase over a grant, and finally the lower
 * identifier. Every step after the rank picks the reading most favourable to the person, so that two
 * candidates of the same tier can never leave them worse off than either one alone.
 *
 * The status is compared before the duration because the published status is what a client shows the
 * person. Someone holding an `active` subscription with a real paid-through date and an `in_grace` row
 * of the same tier would otherwise be told they have a payment problem while they are paid up, since a
 * grace period whose end the provider never sent lasts longer than any date.
 */
function isBetterCandidate(candidate: GrantingCandidate, best: GrantingCandidate): boolean {
  const candidateRank = getEntitlementTierRank(candidate.tier);
  const bestRank = getEntitlementTierRank(best.tier);
  if (candidateRank !== bestRank) {
    return candidateRank > bestRank;
  }

  if (candidate.status !== best.status) {
    return candidate.status === "active";
  }

  const candidateAccessDurationOrder = getAccessDurationOrder(candidate);
  const bestAccessDurationOrder = getAccessDurationOrder(best);
  if (candidateAccessDurationOrder !== bestAccessDurationOrder) {
    return candidateAccessDurationOrder > bestAccessDurationOrder;
  }

  if (candidate.willRenew !== best.willRenew) {
    return candidate.willRenew;
  }

  if (candidate.isTrial !== best.isTrial) {
    return best.isTrial;
  }

  if (candidate.source !== best.source) {
    return candidate.source === "purchase";
  }

  return candidate.candidateId < best.candidateId;
}

/**
 * The pure derivation: stored purchases and grants in, one effective entitlement out, no I/O and no
 * clock read beyond the injected `now` (docs/premium-entitlements.md, "Derivation is a pure function;
 * the snapshot is a cache"). Every field of the result is resolved together, so no caller can publish
 * a half-resolved entitlement. The guest AI cap is an argument for the same reason the clock is: it is
 * parsed from the environment into module state, so reading it here would make the result depend on
 * something the arguments do not carry.
 *
 * `environment` is not consulted. Whether a purchase marked `sandbox` grants entitlement outside a
 * sandbox context is still open, and no purchase row exists yet, so the question has no observable
 * answer to encode here; it belongs to the change that adds the first store rail.
 */
export function resolveEntitlement(
  purchases: ReadonlyArray<EntitlementPurchaseInput>,
  grants: ReadonlyArray<EntitlementGrantInput>,
  accountKind: AccountKind,
  guestAiWeightedMonthlyTokenCap: number,
  now: Date,
): ResolvedEntitlement {
  const candidates: ReadonlyArray<GrantingCandidate> = [
    ...purchases.flatMap((purchase) => {
      const candidate = toPurchaseCandidate(purchase, now);
      return candidate === null ? [] : [candidate];
    }),
    ...grants.flatMap((grant) => {
      const candidate = toGrantCandidate(grant, now);
      return candidate === null ? [] : [candidate];
    }),
  ];

  const winner = candidates.reduce<GrantingCandidate | null>(
    (best, candidate) => (best === null || isBetterCandidate(candidate, best) ? candidate : best),
    null,
  );

  if (winner === null) {
    return {
      tier: freeEntitlementTier,
      status: "none",
      until: null,
      isTrial: false,
      willRenew: false,
      source: "none",
      limits: resolveEntitlementLimits(freeEntitlementTier, accountKind, guestAiWeightedMonthlyTokenCap),
    };
  }

  return {
    tier: winner.tier,
    status: winner.status,
    until: winner.until,
    isTrial: winner.isTrial,
    willRenew: winner.willRenew,
    source: winner.source,
    limits: resolveEntitlementLimits(winner.tier, accountKind, guestAiWeightedMonthlyTokenCap),
  };
}
