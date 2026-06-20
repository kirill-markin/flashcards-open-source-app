import { useState, type FormEvent, type ReactElement } from "react";
import { ApiError, submitFeedback } from "../../api";
import { useAppData } from "../../appData";
import { useAppErrorDialog } from "../../appError/AppErrorContext";
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

function isExpectedFeedbackSubmitError(error: unknown): error is ApiError {
  return error instanceof ApiError
    && error.statusCode >= 400
    && error.statusCode < 500
    && (
      error.code === "FEEDBACK_BODY_TOO_LARGE"
      || error.code === "FEEDBACK_HUMAN_AUTH_REQUIRED"
      || error.code === "FEEDBACK_INSTALLATION_FORBIDDEN"
      || error.code === "FEEDBACK_INVALID_INPUT"
      || error.code === "FEEDBACK_SUBMISSION_ID_CONFLICT"
      || error.code === "FEEDBACK_WORKSPACE_FORBIDDEN"
    );
}

export function FeedbackSettingsScreen(): ReactElement {
  const {
    activeWorkspace,
    cloudSettings,
    session,
  } = useAppData();
  const { showCapturedTechnicalError } = useAppErrorDialog();
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
  const technicalErrorMessage = t("appError.technicalError.message");

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
      const wasCaptured = captureAppOperationError(error, {
        feature: "feedback",
        operation: "feedback_submit",
        userId: session?.userId ?? null,
        workspaceId: activeWorkspace?.workspaceId ?? null,
        installationId: cloudSettings?.installationId ?? null,
        entityId: null,
      });
      if (wasCaptured) {
        showCapturedTechnicalError(error);
      }
      setFeedbackErrorMessage(wasCaptured ? technicalErrorMessage : t("feedback.submitError"));
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
        const wasCaptured = captureAppOperationError(error, {
          feature: "feedback",
          operation: "feedback_submit",
          userId: session?.userId ?? null,
          workspaceId: activeWorkspace?.workspaceId ?? null,
          installationId: cloudSettings?.installationId ?? null,
          entityId: submissionRequest.feedbackSubmissionId,
        });
        if (wasCaptured) {
          showCapturedTechnicalError(error);
        }
      }
      setFeedbackMessage("");
      showMessage(t("feedback.success"));
    } catch (error) {
      if (isExpectedFeedbackSubmitError(error)) {
        setFeedbackErrorMessage(t("feedback.submitError"));
        return;
      }

      const wasCaptured = captureAppOperationError(error, {
        feature: "feedback",
        operation: "feedback_submit",
        userId: session?.userId ?? null,
        workspaceId: activeWorkspace?.workspaceId ?? null,
        installationId: cloudSettings?.installationId ?? null,
        entityId: submissionRequest.feedbackSubmissionId,
      });
      if (wasCaptured) {
        showCapturedTechnicalError(error);
      }
      setFeedbackErrorMessage(wasCaptured ? technicalErrorMessage : t("feedback.submitError"));
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
