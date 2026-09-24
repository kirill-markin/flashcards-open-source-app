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
   * The monthly AI allowance in weighted tokens, in the unit the metering module sums the usage facts
   * into (apps/backend/src/aiUsage/cap.ts: input tokens plus a multiple of output tokens). `null` means
   * no monthly AI cap is enforced for this combination, and it is not a missing value.
   */
  aiMonthlyWeightedTokens: number | null;
}>;

/**
 * The guest allowance, in the weighted-token unit the metering module sums. It is the number the
 * production deployment already ran on: the retired `GUEST_AI_WEIGHTED_MONTHLY_TOKEN_CAP` environment
 * variable was fed from the `CDK_GUEST_AI_WEIGHTED_MONTHLY_TOKEN_CAP` GitHub Actions repository variable
 * through `AWS/Web Release`, and that variable holds 500000. The tree cannot show that value, which is
 * the reason this comment names where to cross-check it rather than asserting it alone.
 *
 * It moved here because a limit reaches clients resolved by backend code and changing one is a backend
 * deploy (docs/premium-entitlements.md, "Limits resolve on the backend"). Reading it from the environment
 * made the resolved entitlement depend on per-deployment configuration that no client and no report
 * could see.
 *
 * There is no override left, so this is what every deployment now runs guests at, a self-hosted fork
 * included, where an unset variable used to mean a fail-closed `0`. That is intended: an operator who
 * supplies their own provider key has opted into spending on it, and a guest allowance of zero would
 * make guest AI look broken rather than limited. Restoring a zero default would be a product change, not
 * a fix.
 *
 * The number itself is naive and tuning it is later work, together with the per-tier numbers that are
 * open by explicit decision (docs/premium-entitlements.md, "Decided later, on purpose").
 */
const guestAiMonthlyWeightedTokens = 500_000;

/**
 * Where the published allowance for one (tier, account kind) cell comes from. A cell names a source
 * rather than carrying a number so that two cells cannot drift apart while meaning the same thing, and
 * so that no cell can be filled in with a per-tier number that is still an open decision
 * (docs/premium-entitlements.md, "Decided later, on purpose").
 */
type AiMonthlyAllowanceSource = "uncapped" | "guest_allowance";

type AiMonthlyAllowanceSourceTable = Readonly<Record<
  EntitlementTier,
  Readonly<Record<AccountKind, AiMonthlyAllowanceSource>>
>>;

/**
 * Only guests are capped. Every guest cell reads the same allowance because a guest is capped for being
 * a guest rather than for the tier it holds, so a guest holding a paid tier is still counted against it;
 * a larger allowance for a paid guest is a product decision that has not been taken. Every account cell
 * is uncapped, which is what makes the free tier metered but never refused until a paywall arrives with
 * a number of its own.
 */
const aiMonthlyAllowanceSourceByTierAndAccountKind: AiMonthlyAllowanceSourceTable = {
  free: { account: "uncapped", guest: "guest_allowance" },
  premium: { account: "uncapped", guest: "guest_allowance" },
  lifetime: { account: "uncapped", guest: "guest_allowance" },
};

function resolveAiMonthlyWeightedTokens(
  source: AiMonthlyAllowanceSource,
): number | null {
  if (source === "uncapped") {
    return null;
  }

  return guestAiMonthlyWeightedTokens;
}

/**
 * Whether no tier at all is capped for this account kind, which is what lets the metering module skip a
 * refusal - and the reads behind it - for a caller nothing could refuse. It asks the table through the
 * same resolution every caller gets rather than restating which cells are uncapped, so filling one in
 * with a number switches the short-circuit off by itself.
 */
export function isAiMonthlyAllowanceUncappedForEveryTier(accountKind: AccountKind): boolean {
  return Object.values(aiMonthlyAllowanceSourceByTierAndAccountKind).every(
    (sourcesByAccountKind) => resolveAiMonthlyWeightedTokens(sourcesByAccountKind[accountKind]) === null,
  );
}

/**
 * Resolved numbers for one person, never the table. Keeping the table private is what stops another
 * module from branching on a tier to reach a limit, and it is why per-person overrides - deliberately
 * deferred - will be a change to this one function.
 *
 * It reads nothing but its arguments, which is what keeps the derivation a pure function
 * (docs/premium-entitlements.md, "Derivation is a pure function; the snapshot is a cache").
 */
export function resolveEntitlementLimits(
  tier: EntitlementTier,
  accountKind: AccountKind,
): EntitlementLimits {
  return {
    aiMonthlyWeightedTokens: resolveAiMonthlyWeightedTokens(
      aiMonthlyAllowanceSourceByTierAndAccountKind[tier][accountKind],
    ),
  };
}
