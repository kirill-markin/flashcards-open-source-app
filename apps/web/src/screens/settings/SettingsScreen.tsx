import { useState, type ReactElement } from "react";
import { submitFeedback } from "../../api";
import { useAppData } from "../../appData";
import { FeedbackDialog } from "../../feedback/FeedbackDialog";
import {
  buildFeedbackSubmissionRequest,
  feedbackMaximumMessageLength,
  normalizeFeedbackMessage,
} from "../../feedback/feedbackSubmission";
import { useI18n } from "../../i18n";
import { storeFeedbackSubmittedAt } from "../../localDb/feedback";
import { captureAppOperationError } from "../../observability/appOperationObservation";
import {
  accountSettingsRoute,
  settingsAccessRoute,
  settingsCurrentWorkspaceRoute,
  settingsDeviceRoute,
  settingsTestRoute,
  workspaceSettingsRoute,
} from "../../routes";
import { useTestMode } from "../../testMode";
import type { FeedbackSubmissionRequest } from "../../types";
import { useTransientMessage } from "../../useTransientMessage";
import { isWorkspaceManagementLocked } from "../../workspaceManagement";
import {
  SettingsActionCard,
  SettingsGroup,
  SettingsNavigationCard,
  SettingsShell,
} from "./SettingsShared";

export function SettingsScreen(): ReactElement {
  const {
    activeWorkspace,
    cloudSettings,
    isSessionVerified,
    session,
  } = useAppData();
  const { locale, t } = useI18n();
  const { isTestModeEnabled } = useTestMode();
  const { message, showMessage } = useTransientMessage(3000);
  const [isFeedbackDialogOpen, setIsFeedbackDialogOpen] = useState<boolean>(false);
  const [feedbackMessage, setFeedbackMessage] = useState<string>("");
  const [feedbackErrorMessage, setFeedbackErrorMessage] = useState<string>("");
  const [isFeedbackSubmitting, setIsFeedbackSubmitting] = useState<boolean>(false);
  const isWorkspaceLocked = isWorkspaceManagementLocked(isSessionVerified, cloudSettings);
  const currentWorkspaceName = activeWorkspace?.name ?? t("common.unavailable");
  const workspaceManagementLockedMessage = t("workspaceManagement.lockedMessage");

  function openFeedbackDialog(): void {
    setFeedbackMessage("");
    setFeedbackErrorMessage("");
    setIsFeedbackDialogOpen(true);
  }

  function closeFeedbackDialog(): void {
    setIsFeedbackDialogOpen(false);
    setFeedbackMessage("");
    setFeedbackErrorMessage("");
  }

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
      closeFeedbackDialog();
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

  return (
    <>
      <SettingsShell
        title={t("settingsHome.title")}
        subtitle={t("settingsHome.subtitle")}
        activeTab="general"
      >
        {message === "" ? null : <p className="settings-temporary-banner" role="status">{message}</p>}

        <SettingsGroup>
          <div className="settings-nav-list">
            {isWorkspaceLocked ? (
              <SettingsActionCard
                title={t("settingsHome.currentWorkspace.title")}
                description={t("settingsHome.currentWorkspace.description")}
                value={currentWorkspaceName}
                onClick={() => showMessage(workspaceManagementLockedMessage)}
                isMuted
              />
            ) : (
              <SettingsNavigationCard
                title={t("settingsHome.currentWorkspace.title")}
                description={t("settingsHome.currentWorkspace.description")}
                value={currentWorkspaceName}
                to={settingsCurrentWorkspaceRoute}
              />
            )}
            <SettingsActionCard
              title={t("settingsHome.feedback.title")}
              description={t("settingsHome.feedback.description")}
              value={t("settingsHome.feedback.value")}
              onClick={openFeedbackDialog}
              testId="settings-feedback-row"
            />
          </div>
        </SettingsGroup>

        <SettingsGroup>
          <div className="settings-nav-list">
            <SettingsNavigationCard
              title={t("settingsHome.workspaceSettings.title")}
              description={t("settingsHome.workspaceSettings.description")}
              value={t("settingsHome.workspaceSettings.value")}
              to={workspaceSettingsRoute}
            />
            <SettingsNavigationCard
              title={t("settingsHome.accountSettings.title")}
              description={t("settingsHome.accountSettings.description")}
              value={t("settingsHome.accountSettings.value")}
              to={accountSettingsRoute}
            />
          </div>
        </SettingsGroup>

        <SettingsGroup>
          <div className="settings-inline-nav-list">
            <SettingsNavigationCard
              title={t("settingsHome.device.title")}
              description={t("settingsHome.device.description")}
              value={t("settingsHome.device.value")}
              to={settingsDeviceRoute}
            />
            <SettingsNavigationCard
              title={t("settingsHome.access.title")}
              description={t("settingsHome.access.description")}
              value={t("settingsHome.access.value")}
              to={settingsAccessRoute}
            />
          </div>
        </SettingsGroup>

        {isTestModeEnabled ? (
          <SettingsGroup title={t("settingsHome.testGroupTitle")}>
            <div className="settings-nav-list">
              <SettingsNavigationCard
                title={t("settingsHome.test.title")}
                description={t("settingsHome.test.description")}
                value={t("settingsHome.test.value")}
                to={settingsTestRoute}
                testId="settings-test-row"
              />
            </div>
          </SettingsGroup>
        ) : null}
      </SettingsShell>
      <FeedbackDialog
        isOpen={isFeedbackDialogOpen}
        message={feedbackMessage}
        errorMessage={feedbackErrorMessage}
        isSubmitting={isFeedbackSubmitting}
        onMessageChange={(nextMessage) => setFeedbackMessage(nextMessage)}
        onSubmit={submitSettingsFeedback}
        onDismiss={closeFeedbackDialog}
      />
    </>
  );
}
