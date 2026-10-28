import { deleteAllFeedbackPromptStates } from "../../../localDb/feedback/feedback";
import { deleteAllMobileAppPromotionStates } from "../../../localDb/mobileAppPromotion/mobileAppPromotion";
import { clearAllGuestSignInAfterReviewLastShownAt } from "../guest/guestSignInAfterReviewStorage";
import { clearReviewHardReminderLastShownAt } from "../hardReminder/reviewHardReminder";

/**
 * Clears this browser's state of every web after-review prompt, for every identity it holds.
 * The paywall cache stays: it mirrors server history, and only a later sync would refill it.
 */
export async function resetReviewPromptLocalState(throwIfIndexedDbOpenRecoveryFailed: () => void): Promise<void> {
  clearReviewHardReminderLastShownAt();
  clearAllGuestSignInAfterReviewLastShownAt();
  await deleteAllMobileAppPromotionStates();
  throwIfIndexedDbOpenRecoveryFailed();
  await deleteAllFeedbackPromptStates();
  throwIfIndexedDbOpenRecoveryFailed();
}
