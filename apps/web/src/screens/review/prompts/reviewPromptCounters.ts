import { loadLocalProgressDailyReviews } from "../../../localDb/progress/progress";
import { buildProgressDateContext } from "../../../progress/progressDates";
import { buildReviewPromptCounters, type ReviewPromptCounters } from "./reviewPromptRules";

export async function loadReviewPromptCounters(
  workspaceIds: ReadonlyArray<string>,
  now: Date,
): Promise<ReviewPromptCounters> {
  const dateContext = buildProgressDateContext(now);
  const dailyReviews = await loadLocalProgressDailyReviews(workspaceIds, {
    timeZone: dateContext.timeZone,
    from: "0001-01-01",
    to: dateContext.today,
  });
  return buildReviewPromptCounters(dailyReviews, dateContext.today);
}
