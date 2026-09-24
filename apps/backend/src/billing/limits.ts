import type { EntitlementTier } from "./tiers";

/**
 * Limits are keyed by (tier, account kind) and reach clients already resolved to numbers, so
 * changing one is a backend deploy that applies to every shipped client at once
 * (docs/premium-entitlements.md, "Limits resolve on the backend").
 *
 * `guest` is an account property rather than a tier: a guest can hold any tier, and a free guest and
 * a free signed-in person can carry different limits without either becoming a tier.
 */
export type AccountKind = "account" | "guest";

export type EntitlementLimits = Readonly<{
  /**
   * The monthly AI allowance in weighted tokens, in the unit the guest quota already counts
   * (apps/backend/src/guestAiQuota/index.ts: input tokens plus a multiple of output tokens, and a
   * per-KiB weight for uploaded audio). `null` means no monthly AI cap is enforced for this
   * combination.
   */
  aiMonthlyWeightedTokens: number | null;
}>;

/**
 * Where the published allowance for one (tier, account kind) cell comes from. A cell names a source
 * rather than carrying a number because the only monthly AI allowance this repository enforces today
 * is the guest quota cap, and concrete per-tier numbers are open by explicit decision
 * (docs/premium-entitlements.md, "Decided later, on purpose"). Filling these cells with real numbers
 * belongs to the AI metering cutover, which also moves enforcement off the guest quota table.
 */
type AiMonthlyAllowanceSource = "uncapped" | "guest_quota_cap";

type AiMonthlyAllowanceSourceTable = Readonly<Record<
  EntitlementTier,
  Readonly<Record<AccountKind, AiMonthlyAllowanceSource>>
>>;

/**
 * Every guest cell reads the guest quota cap because that cap is enforced by guest transport rather
 * than by tier today, so a guest holding a paid tier is still counted against it. A larger allowance
 * for a paid guest is a product decision, and it lands with the metering cutover that owns
 * enforcement.
 */
const aiMonthlyAllowanceSourceByTierAndAccountKind: AiMonthlyAllowanceSourceTable = {
  free: { account: "uncapped", guest: "guest_quota_cap" },
  premium: { account: "uncapped", guest: "guest_quota_cap" },
  lifetime: { account: "uncapped", guest: "guest_quota_cap" },
};

function resolveAiMonthlyWeightedTokens(
  source: AiMonthlyAllowanceSource,
  guestAiWeightedMonthlyTokenCap: number,
): number | null {
  if (source === "uncapped") {
    return null;
  }

  return guestAiWeightedMonthlyTokenCap;
}

/**
 * The only exported behaviour: resolved numbers for one person, never the table. Keeping the table
 * private is what stops another module from branching on a tier to reach a limit, and it is why
 * per-person overrides - deliberately deferred - will be a change to this one function.
 *
 * The guest quota cap is a parameter rather than a read of getGuestAiWeightedMonthlyTokenCap, which
 * parses GUEST_AI_WEIGHTED_MONTHLY_TOKEN_CAP into module state: reading it here would make the
 * resolved entitlement depend on something other than its arguments, and the derivation is specified
 * as a pure function (docs/premium-entitlements.md, "Derivation is a pure function; the snapshot is a
 * cache"). The caller that touches the database reads the environment.
 */
export function resolveEntitlementLimits(
  tier: EntitlementTier,
  accountKind: AccountKind,
  guestAiWeightedMonthlyTokenCap: number,
): EntitlementLimits {
  return {
    aiMonthlyWeightedTokens: resolveAiMonthlyWeightedTokens(
      aiMonthlyAllowanceSourceByTierAndAccountKind[tier][accountKind],
      guestAiWeightedMonthlyTokenCap,
    ),
  };
}
