/**
 * The tier catalogue: the stable id is the identity, and the rank is an explicit integer with gaps
 * so a later tier can land between two existing ones without renumbering the others
 * (docs/premium-entitlements.md, "Tiers").
 *
 * Comparison is by rank only. Nothing may branch on a single tier id to mean "has paid", because a
 * `lifetime` holder fails that test: ask isEntitlementTierAtLeast for the rank a feature requires.
 *
 * The display name is sent on the wire beside the stable id so a client renders a tier shipped after
 * its own release instead of falling back to "unknown", and never holds a tier table of its own.
 * These names are the tier ids in title case on purpose: customer-facing plan names are a product
 * decision that is deliberately still open, and nothing here may be read as one.
 */
export type EntitlementTier = "free" | "premium" | "lifetime";

type EntitlementTierDefinition = Readonly<{
  rank: number;
  displayName: string;
}>;

const entitlementTierDefinitions: Readonly<Record<EntitlementTier, EntitlementTierDefinition>> = {
  free: { rank: 10, displayName: "Free" },
  premium: { rank: 20, displayName: "Premium" },
  lifetime: { rank: 30, displayName: "Lifetime" },
};

export const freeEntitlementTier: EntitlementTier = "free";

export function getEntitlementTierRank(tier: EntitlementTier): number {
  return entitlementTierDefinitions[tier].rank;
}

export function getEntitlementTierDisplayName(tier: EntitlementTier): string {
  return entitlementTierDefinitions[tier].displayName;
}

export function isEntitlementTierAtLeast(
  tier: EntitlementTier,
  requiredTier: EntitlementTier,
): boolean {
  return getEntitlementTierRank(tier) >= getEntitlementTierRank(requiredTier);
}

/**
 * billing.purchases.tier and billing.grants.tier are unconstrained TEXT, because the catalogue lives
 * here rather than in db/migrations/0151_billing_schema.sql. This is the one place a stored value
 * becomes a tier.
 */
export function isEntitlementTier(value: string): value is EntitlementTier {
  return Object.hasOwn(entitlementTierDefinitions, value);
}
