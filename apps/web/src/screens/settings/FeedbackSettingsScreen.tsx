import { useState, type FormEvent, type ReactElement } from "react";
import { submitFeedback } from "../../api";
import { useAppData } from "../../appData";
import {
  buildFeedbackSubmissionRequest,
  feedbackMaximumMessageLength,
  isFeedbackMessageSubmittable,
  normalizeFeedbackMessage,
} from "../../feedback/feedbackSubmission";
import { useI18n } from "../../i18n";
import {
  buildFeedbackPromptIdentityKey,
  storeFeedbackSubmittedAt,
} from "../../localDb/feedback/feedback";
import { captureAppOperationError } from "../../observability/appOperationObservation";
import type { FeedbackSubmissionRequest } from "../../types";
import { useTransientMessage } from "../../useTransientMessage";
import { SettingsGroup, SettingsShell } from "./SettingsShared";

export function FeedbackSettingsScreen(): ReactElement {
  const {
    activeWorkspace,
    cloudSettings,
    session,
  } = useAppData();
  const { locale, t } = useI18n();
  const { message, showMessage } = useTransientMessage(3000);
  const [feedbackMessage, setFeedbackMessage] = useState<string>("");
  const [feedbackErrorMessage, setFeedbackErrorMessage] = useState<string>("");
  const [isFeedbackSubmitting, setIsFeedbackSubmitting] = useState<boolean>(false);
  const feedbackPromptIdentityKey = buildFeedbackPromptIdentityKey({
    sessionUserId: session?.userId ?? null,
    linkedUserId: cloudSettings?.linkedUserId ?? null,
  });
  const isSubmitDisabled = isFeedbackSubmitting || isFeedbackMessageSubmittable(feedbackMessage) === false;

  async function submitSettingsFeedback(): Promise<void> {
    const normalizedMessage = normalizeFeedbackMessage(feedbackMessage);
    if (normalizedMessage === "") {
      setFeedbackErrorMessage(t("feedback.emptyError"));
      return;
    }

    if (normalizedMessage.length > feedbackMaximumMessageLength) {
      setFeedbackErrorMessage(t("feedback.tooLongError"));
      return;
    }

    let submissionRequest: FeedbackSubmissionRequest;
    try {
      submissionRequest = buildFeedbackSubmissionRequest({
        workspaceId: activeWorkspace?.workspaceId ?? null,
        locale,
        trigger: "settings",
        message: normalizedMessage,
        now: new Date(),
      });
    } catch (error) {
      captureAppOperationError(error, {
        feature: "feedback",
        operation: "feedback_submit",
        userId: session?.userId ?? null,
        workspaceId: activeWorkspace?.workspaceId ?? null,
        installationId: cloudSettings?.installationId ?? null,
        entityId: null,
      });
      setFeedbackErrorMessage(t("feedback.submitError"));
      return;
    }

    setIsFeedbackSubmitting(true);
    setFeedbackErrorMessage("");
    try {
      const feedbackState = await submitFeedback(submissionRequest);
      try {
        await storeFeedbackSubmittedAt({
          identityKey: feedbackPromptIdentityKey,
          feedbackState,
          submittedAt: submissionRequest.createdAtClient,
        });
      } catch (error) {
        captureAppOperationError(error, {
          feature: "feedback",
          operation: "feedback_submit",
          userId: session?.userId ?? null,
          workspaceId: activeWorkspace?.workspaceId ?? null,
          installationId: cloudSettings?.installationId ?? null,
          entityId: submissionRequest.feedbackSubmissionId,
        });
      }
      setFeedbackMessage("");
      showMessage(t("feedback.success"));
    } catch (error) {
      captureAppOperationError(error, {
        feature: "feedback",
        operation: "feedback_submit",
        userId: session?.userId ?? null,
        workspaceId: activeWorkspace?.workspaceId ?? null,
        installationId: cloudSettings?.installationId ?? null,
        entityId: submissionRequest.feedbackSubmissionId,
      });
      setFeedbackErrorMessage(t("feedback.submitError"));
    } finally {
      setIsFeedbackSubmitting(false);
    }
  }

  function handleSubmit(event: FormEvent<HTMLFormElement>): void {
    event.preventDefault();
    if (isSubmitDisabled) {
      return;
    }

    void submitSettingsFeedback();
  }

  return (
    <SettingsShell
      title={t("settingsHome.feedback.title")}
      subtitle={t("feedback.body")}
      activeTab="general"
    >
      {message === "" ? null : <p className="settings-temporary-banner" role="status">{message}</p>}

      <SettingsGroup>
        <form className="content-card settings-overview-card" onSubmit={handleSubmit}>
          <div className="cell-stack">
            <h2 className="panel-subtitle">{t("feedback.title")}</h2>
            <p className="subtitle">{t("feedback.body")}</p>
          </div>
          <label className="form-label feedback-dialog-field">
            <span>{t("feedback.fieldLabel")}</span>
            <textarea
              className="settings-input feedback-textarea"
              maxLength={feedbackMaximumMessageLength}
              rows={7}
              value={feedbackMessage}
              placeholder={t("feedback.placeholder")}
              disabled={isFeedbackSubmitting}
              onChange={(event) => {
                setFeedbackMessage(event.currentTarget.value);
                setFeedbackErrorMessage("");
              }}
              data-testid="feedback-message"
            />
          </label>

          {feedbackErrorMessage === "" ? null : <p className="error-banner" role="alert">{feedbackErrorMessage}</p>}

          <div className="screen-actions">
            <button
              type="submit"
              className="primary-btn"
              disabled={isSubmitDisabled}
              data-testid="feedback-submit"
            >
              {isFeedbackSubmitting ? t("feedback.sending") : t("feedback.send")}
            </button>
          </div>
        </form>
      </SettingsGroup>
    </SettingsShell>
  );
}
