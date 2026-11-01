import { useState, type ReactElement } from "react";
import { reviewPromptConfig } from "../../../../backend/src/reviewPrompts/reviewPromptConfig";
import {
  markIndexedDbOpenRecoveryFailureAndCheckActive,
  useAppErrorDialog,
} from "../../appError/AppErrorContext";
import { webReviewMobilePromptStoreLinks } from "../../appPlatformLinks";
import { FeedbackDialog } from "../../feedback/FeedbackDialog";
import { useI18n } from "../../i18n";
import { usePremiumPresenter } from "../../premium/PremiumProvider";
import { GuestSignInAfterReviewPrompt } from "../review/guest/GuestSignInAfterReviewPrompt";
import { ReviewHardReminderDialog } from "../review/hardReminder/ReviewHardReminderDialog";
import { MobileAppPromotionDialog } from "../review/mobileAppPromo/MobileAppPromotionDialog";
import { resetReviewPromptLocalState } from "../review/prompts/resetReviewPromptLocalState";
import { listWebReviewPromptOrder, type WebReviewPromptId } from "../review/prompts/reviewPromptRules";
import { SettingsActionCard, SettingsGroup } from "./SettingsShared";

type ResetStatus = "idle" | "resetting" | "done";

const webReviewPromptOrder = listWebReviewPromptOrder(reviewPromptConfig);
// The reset keeps the paywall cache, which mirrors server history.
const paywallPromptIds: ReadonlySet<WebReviewPromptId> = new Set<WebReviewPromptId>([
  "paywall-initial",
  "paywall-second",
  "paywall-periodic",
]);
const resetPromptIds = webReviewPromptOrder.filter((promptId) => !paywallPromptIds.has(promptId));

/**
 * Previews show each real prompt with working buttons but record nothing: no shown state, cooldown,
 * prompt analytics or server prompt event, and the feedback preview sends nothing.
 */
export function TestReviewPromptsGroup(): ReactElement {
  const { t } = useI18n();
  const presentPremium = usePremiumPresenter();
  const { indexedDbOpenRecoveryState, showCapturedTechnicalError } = useAppErrorDialog();
  const [previewPromptId, setPreviewPromptId] = useState<WebReviewPromptId | null>(null);
  const [feedbackMessage, setFeedbackMessage] = useState<string>("");
  const [resetStatus, setResetStatus] = useState<ResetStatus>("idle");

  function openPreview(promptId: WebReviewPromptId): void {
    switch (promptId) {
      case "paywall-initial":
      case "paywall-second":
      case "paywall-periodic":
        presentPremium?.({ reason: "offer", isTestPreview: true, entryPoint: null });
        return;
      case "automatic-feedback":
        setFeedbackMessage("");
        setPreviewPromptId(promptId);
        return;
      case "hard-reminder":
      case "web-mobile-app-promo":
      case "guest-sign-in":
        setPreviewPromptId(promptId);
        return;
    }
  }

  function closePreview(): void {
    setPreviewPromptId(null);
  }

  async function resetPromptState(): Promise<void> {
    setResetStatus("resetting");
    try {
      indexedDbOpenRecoveryState.throwIfFailed();
      await resetReviewPromptLocalState(indexedDbOpenRecoveryState.throwIfFailed);
      setResetStatus("done");
    } catch (error) {
      if (markIndexedDbOpenRecoveryFailureAndCheckActive(indexedDbOpenRecoveryState, error)) {
        return;
      }
      setResetStatus("idle");
      showCapturedTechnicalError(error);
    }
  }

  return (
    <>
      <SettingsGroup title={t("settingsTest.reviewPrompts.title")} testId="test-settings-review-prompts">
        <p className="subtitle">
          <code data-testid="test-settings-review-prompts-config">
            {JSON.stringify({ schemaVersion: reviewPromptConfig.schemaVersion, version: reviewPromptConfig.version })}
          </code>
        </p>
        <div className="settings-nav-list">
          {webReviewPromptOrder.map((promptId) => (
            <SettingsActionCard
              key={promptId}
              title={promptId}
              description={JSON.stringify(reviewPromptConfig.prompts[promptId])}
              value={null}
              onClick={() => openPreview(promptId)}
              testId={`test-settings-review-prompt-${promptId}`}
            />
          ))}
          <SettingsActionCard
            title={t("settingsTest.reviewPrompts.resetAll")}
            description={resetPromptIds.join(", ")}
            value={resetStatus === "resetting" ? t("common.loading") : resetStatus === "done" ? t("common.ok") : null}
            onClick={() => void resetPromptState()}
            disabled={resetStatus === "resetting"}
            testId="test-settings-review-prompts-reset"
          />
        </div>
      </SettingsGroup>
      <ReviewHardReminderDialog isOpen={previewPromptId === "hard-reminder"} onDismiss={closePreview} />
      <MobileAppPromotionDialog
        isOpen={previewPromptId === "web-mobile-app-promo"}
        onDismiss={closePreview}
        onStoreLinkClick={null}
        storeLinks={webReviewMobilePromptStoreLinks}
      />
      <GuestSignInAfterReviewPrompt
        isOpen={previewPromptId === "guest-sign-in"}
        onLater={closePreview}
        onSignInPressed={() => undefined}
      />
      <FeedbackDialog
        isOpen={previewPromptId === "automatic-feedback"}
        message={feedbackMessage}
        errorMessage=""
        isSubmitting={false}
        onMessageChange={setFeedbackMessage}
        onSubmit={async () => closePreview()}
        onDismiss={closePreview}
      />
    </>
  );
}
