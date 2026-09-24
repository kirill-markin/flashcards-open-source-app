import type { AccountKind } from "../billing/limits";
import { resolveEntitlementForUserWithoutRefresh, type EntitlementWire } from "../billing/snapshot";
import {
  aiWeightedOutputTokenMultiplier,
  getAiUsageMonthWindow,
  loadAiUsageWeightedTokensForMonth,
} from "./cap";

/**
 * What this month has cost so far, in the weighted-token unit the allowance is expressed in.
 *
 * `remainingWeightedTokens` is `null` when no monthly AI cap is enforced for this person, the way the
 * limits table expresses "uncapped" (`apps/backend/src/billing/limits.ts`). It is not a missing value
 * and must never be read as zero: every signed-in cell is uncapped today, so a caller that turned
 * `null` into a number would invent a limit nothing enforces.
 *
 * The window is a calendar month in UTC for everybody, resolved by `getAiUsageMonthWindow` rather
 * than restated here, and `monthEndsAt` is therefore also when the allowance resets.
 */
export type AiMonthlyUsage = Readonly<{
  monthStartsAt: string;
  monthEndsAt: string;
  usedWeightedTokens: number;
  remainingWeightedTokens: number | null;
  weightedOutputTokenMultiplier: number;
}>;

/**
 * Everything one caller needs to answer "what am I on, and how much have I used". The entitlement is
 * the same object the sync pull publishes (`EntitlementWire`), and the usage beside it is what that
 * object deliberately leaves out (docs/premium-entitlements.md, "What a client receives").
 *
 * `accountKind` travels with it because a limit is keyed by (tier, account kind): a free guest and a
 * free signed-in person can carry different allowances without either becoming a tier, so the tier
 * alone does not explain the number.
 */
export type AiUsageStatus = Readonly<{
  accountKind: AccountKind;
  entitlement: EntitlementWire;
  usage: AiMonthlyUsage;
}>;

/**
 * Reads the person's tier, the limits resolved for it, and the month's consumption. It derives none
 * of the three: the tier and its limits come from the billing module and the sum and the window from
 * the metering module, so this composition can never disagree with what enforcement uses.
 *
 * Every statement on this path is a read. The entitlement is resolved through the billing module's
 * non-writing resolution, so reporting an allowance cannot upsert the snapshot cache or emit an
 * entitlement-change fact - which is what lets the agent surfaces annotate the tool that serves this
 * as read-only and mean it.
 *
 * The sum is read even when the allowance is uncapped, unlike the enforcement path, which skips it
 * because nothing could be refused (`resolveAiUsageAllowanceForEnforcement`). Here the consumption is
 * the answer rather than an input to a refusal, and it is the only way to learn it: the sync snapshot
 * publishes the entitlement without it.
 *
 * `remainingWeightedTokens` is clamped at zero because the call that crosses the allowance completes
 * and only the next one is refused, so a used total may exceed the allowance by one call's cost.
 */
export async function loadAiUsageStatus(
  userId: string,
  accountKind: AccountKind,
  now: Date,
): Promise<AiUsageStatus> {
  const entitlement = await resolveEntitlementForUserWithoutRefresh(userId, accountKind, now);
  const month = getAiUsageMonthWindow(now);
  const usedWeightedTokens = await loadAiUsageWeightedTokensForMonth(userId, month);
  const monthlyWeightedTokens = entitlement.limits.aiMonthlyWeightedTokens;

  return {
    accountKind,
    entitlement,
    usage: {
      monthStartsAt: month.startsAt.toISOString(),
      monthEndsAt: month.endsAt.toISOString(),
      usedWeightedTokens,
      remainingWeightedTokens: monthlyWeightedTokens === null
        ? null
        : Math.max(0, monthlyWeightedTokens - usedWeightedTokens),
      weightedOutputTokenMultiplier: aiWeightedOutputTokenMultiplier,
    },
  };
}
