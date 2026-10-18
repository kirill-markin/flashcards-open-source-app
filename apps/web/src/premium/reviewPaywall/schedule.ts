import type { PaywallState, ReviewPaywallTrigger } from "../../apiContracts/paywallState";
import { loadLocalProgressDailyReviews } from "../../localDb/progress/progress";
import { buildProgressDateContext, shiftLocalDate } from "../../progress/progressDates";
import type { EntitlementSnapshot } from "../../types/entitlement";

export type ReviewPaywallActivity = Readonly<{ today: string; todayReviewCount: number; totalReviewCount: number }>;
const weeklyCooldownMs = 7 * 24 * 60 * 60 * 1000;

export function isKnownFreeEntitlement(entitlement: EntitlementSnapshot | null): boolean {
  return entitlement !== null && entitlement.status === "none" && !entitlement.isTrial && entitlement.tierRank < 20;
}

export async function loadReviewPaywallActivity(workspaceIds: ReadonlyArray<string>, now: Date): Promise<ReviewPaywallActivity> {
  const dateContext = buildProgressDateContext(now);
  const reviews = await loadLocalProgressDailyReviews(workspaceIds, {
    timeZone: dateContext.timeZone, from: "0001-01-01", to: dateContext.today,
  });
  return {
    today: dateContext.today,
    todayReviewCount: reviews.find((point) => point.date === dateContext.today)?.reviewCount ?? 0,
    totalReviewCount: reviews.reduce((total, point) => total + point.reviewCount, 0),
  };
}

export function dueReviewPaywall(state: PaywallState, activity: ReviewPaywallActivity, now: Date): ReviewPaywallTrigger | null {
  if (activity.today !== buildProgressDateContext(now).today) return null;
  if (state.introShownAt === null) return activity.totalReviewCount >= 3 ? "initial" : null;
  if (activity.todayReviewCount < 2) return null;
  if (state.followUpShownAt === null) {
    return state.introLocalDate !== null && activity.today >= shiftLocalDate(state.introLocalDate, 2) ? "day3" : null;
  }
  return state.lastShownAt !== null && now.getTime() - Date.parse(state.lastShownAt) >= weeklyCooldownMs ? "weekly" : null;
}
