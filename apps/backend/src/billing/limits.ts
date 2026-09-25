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
   * The monthly AI allowance in in-app chat messages, counted by the metering module
   * (apps/backend/src/aiUsage/cap.ts). `null` means no monthly AI cap is enforced for this combination,
   * and it is not a missing value.
   */
  aiMonthlyMessages: number | null;
  /**
   * Always `null`: weighted tokens are metered and watched, never refused. The field stays because the
   * sync pull already publishes it to released clients.
   */
  aiMonthlyWeightedTokens: null;
}>;

/** Only the free guest cell: a guest holding a paid tier gets that tier's allowance. */
const freeGuestAiMonthlyMessages = 15;

/**
 * Every paid tier shares one allowance, so two paid cells cannot drift apart while meaning the same
 * thing.
 */
const paidAiMonthlyMessages = 1000;

type AiMonthlyMessagesTable = Readonly<Record<
  EntitlementTier,
  Readonly<Record<AccountKind, number | null>>
>>;

/**
 * A free signed-in account is uncapped until the paywall launches, which gives that cell a number of its
 * own. Every cell is metered either way.
 */
const aiMonthlyMessagesByTierAndAccountKind: AiMonthlyMessagesTable = {
  free: { account: null, guest: freeGuestAiMonthlyMessages },
  premium: { account: paidAiMonthlyMessages, guest: paidAiMonthlyMessages },
  lifetime: { account: paidAiMonthlyMessages, guest: paidAiMonthlyMessages },
};

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
    aiMonthlyMessages: aiMonthlyMessagesByTierAndAccountKind[tier][accountKind],
    aiMonthlyWeightedTokens: null,
  };
}
