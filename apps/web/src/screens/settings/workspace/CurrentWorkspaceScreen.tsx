import { type FormEvent, type ReactElement, useEffect, useState } from "react";
import { ApiContractError } from "../../../api";
import { useAppData } from "../../../appData";
import { useAppErrorDialog } from "../../../appError/AppErrorContext";
import { useI18n } from "../../../i18n";
import { captureAppOperationError } from "../../../observability/appOperationObservation";
import { addWebBreadcrumb } from "../../../observability/webObservability";
import { useTransientMessage } from "../../../useTransientMessage";
import { isWorkspaceManagementLocked } from "../../../workspaceManagement";
import { SettingsActionCard, SettingsGroup, SettingsShell } from "../SettingsShared";

export function CurrentWorkspaceScreen(): ReactElement {
  const {
    sessionVerificationState,
    session,
    activeWorkspace,
    availableWorkspaces,
    chooseWorkspace,
    createWorkspace,
    isChoosingWorkspace,
    isSessionVerified,
    cloudSettings,
    renameWorkspace,
  } = useAppData();
  const { showCapturedTechnicalError } = useAppErrorDialog();
  const { t, formatDateTime } = useI18n();
  const [isExpanded, setIsExpanded] = useState<boolean>(false);
  const [isCreating, setIsCreating] = useState<boolean>(false);
  const [newWorkspaceName, setNewWorkspaceName] = useState<string>("");
  const [errorMessage, setErrorMessage] = useState<string>("");
  const [workspaceName, setWorkspaceName] = useState<string>("");
  const [renameErrorMessage, setRenameErrorMessage] = useState<string>("");
  const [isRenameSubmitting, setIsRenameSubmitting] = useState<boolean>(false);
  const { message, showMessage } = useTransientMessage(3000);
  const isWorkspaceLocked = isWorkspaceManagementLocked(isSessionVerified, cloudSettings);
  const currentWorkspaceName = activeWorkspace?.name ?? t("common.unavailable");
  const workspaceManagementState = isWorkspaceLocked ? "locked" : "ready";
  const workspaceManagementLockedMessage = t("workspaceManagement.lockedMessage");
  const trimmedWorkspaceName = workspaceName.trim();
  const isRenameDisabled = activeWorkspace === null
    || isSessionVerified === false
    || isWorkspaceLocked
    || trimmedWorkspaceName === ""
    || trimmedWorkspaceName === activeWorkspace.name
    || isRenameSubmitting;
  const technicalErrorMessage = t("appError.technicalError.message");

  useEffect(() => {
    setWorkspaceName(activeWorkspace?.name ?? "");
    setRenameErrorMessage("");
  }, [activeWorkspace?.name, activeWorkspace?.workspaceId]);

  function buildWorkspaceInteractionLogDetails(workspaceId: string | null, errorMessage: string | null): Readonly<{
    sessionVerificationState: string;
    isSessionVerified: boolean;
    cloudState: string | null;
    selectedWorkspaceId: string | null;
    activeWorkspaceId: string | null;
    workspaceId: string | null;
    availableWorkspaceIds: ReadonlyArray<string>;
    errorMessage: string | null;
  }> {
    return {
      sessionVerificationState,
      isSessionVerified,
      cloudState: cloudSettings?.cloudState ?? null,
      selectedWorkspaceId: session?.selectedWorkspaceId ?? null,
      activeWorkspaceId: activeWorkspace?.workspaceId ?? null,
      workspaceId,
      availableWorkspaceIds: availableWorkspaces.map((workspace) => workspace.workspaceId),
      errorMessage,
    };
  }

  async function handleWorkspaceSelect(workspaceId: string): Promise<void> {
    setErrorMessage("");
    await chooseWorkspace(workspaceId);
    setIsExpanded(false);
    setIsCreating(false);
    setNewWorkspaceName("");
  }

  async function handleCreateWorkspace(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();

    const trimmedName = newWorkspaceName.trim();
    if (trimmedName === "") {
      setErrorMessage(t("settingsCurrentWorkspace.workspaceNameRequired"));
      return;
    }

    try {
      setErrorMessage("");
      await createWorkspace(trimmedName);
      setIsExpanded(false);
      setIsCreating(false);
      setNewWorkspaceName("");
    } catch (error) {
      const nextErrorMessage = error instanceof Error ? error.message : String(error);
      const isExpectedError = nextErrorMessage === t("app.sessionUnavailable")
        || nextErrorMessage === t("app.sessionRestoringActionLocked")
        || nextErrorMessage === t("settingsCurrentWorkspace.workspaceNameRequired");
      if (isExpectedError) {
        setErrorMessage(nextErrorMessage);
        return;
      }

      showCapturedTechnicalError(error);
      setErrorMessage(technicalErrorMessage);
    }
  }

  async function handleRenameSubmit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();

    if (activeWorkspace === null) {
      setRenameErrorMessage(t("workspaceOverview.rename.workspaceUnavailable"));
      return;
    }

    if (isWorkspaceLocked) {
      setRenameErrorMessage(workspaceManagementLockedMessage);
      return;
    }

    if (isSessionVerified === false) {
      setRenameErrorMessage(t("workspaceOverview.rename.restoringSession"));
      return;
    }

    if (trimmedWorkspaceName === "") {
      setRenameErrorMessage(t("workspaceOverview.rename.workspaceNameRequired"));
      return;
    }

    setIsRenameSubmitting(true);
    setRenameErrorMessage("");

    try {
      await renameWorkspace(activeWorkspace.workspaceId, trimmedWorkspaceName);
    } catch (error) {
      if (error instanceof ApiContractError === false) {
        const wasCaptured = captureAppOperationError(error, {
          feature: "settings",
          operation: "workspace_rename",
          userId: session?.userId ?? null,
          workspaceId: activeWorkspace.workspaceId,
          installationId: cloudSettings?.installationId ?? null,
          entityId: activeWorkspace.workspaceId,
          expectedErrorMessages: [
            t("app.sessionUnavailable"),
            t("app.sessionRestoringActionLocked"),
            t("settingsCurrentWorkspace.workspaceNameRequired"),
          ],
        });
        if (wasCaptured) {
          showCapturedTechnicalError(error);
          setRenameErrorMessage(technicalErrorMessage);
          return;
        }
      } else {
        showCapturedTechnicalError(error);
        setRenameErrorMessage(technicalErrorMessage);
        return;
      }
      setRenameErrorMessage(error instanceof Error ? error.message : String(error));
    } finally {
      setIsRenameSubmitting(false);
    }
  }

  function handleWorkspaceRowClick(): void {
    if (isWorkspaceLocked) {
      const details = buildWorkspaceInteractionLogDetails(null, null);
      addWebBreadcrumb({
        action: "workspace_transition",
        scope: {
          app: "web",
          feature: "workspace",
          userId: session?.userId ?? null,
          workspaceId: activeWorkspace?.workspaceId ?? null,
          installationId: cloudSettings?.installationId ?? null,
          route: `${window.location.pathname}${window.location.search}${window.location.hash}`,
          requestId: null,
          statusCode: null,
          code: null,
        },
        details: {
          eventName: "workspace_management_interaction_blocked",
          sessionVerificationState: details.sessionVerificationState,
          isSessionVerified: details.isSessionVerified,
          cloudState: details.cloudState,
          workspaceId: details.workspaceId,
          deletedWorkspaceId: null,
          replacementWorkspaceId: null,
          selectedWorkspaceId: details.selectedWorkspaceId,
          activeWorkspaceId: details.activeWorkspaceId,
          availableWorkspaceIds: details.availableWorkspaceIds,
          nextWorkspaceIds: [],
          redirected: false,
          errorMessage: details.errorMessage,
          bootstrapPhase: null,
          syncRunId: null,
        },
      });
      showMessage(workspaceManagementLockedMessage);
      return;
    }

    setErrorMessage("");
    setIsExpanded((currentValue) => !currentValue);
  }

  return (
    <SettingsShell
      title={t("settingsCurrentWorkspace.title")}
      subtitle={t("settingsCurrentWorkspace.subtitle")}
      activeTab="current-workspace"
    >
      {message === "" ? null : <p className="settings-temporary-banner" role="status">{message}</p>}

      <SettingsGroup>
        <div className="settings-nav-list">
          <SettingsActionCard
            title={t("settingsCurrentWorkspace.workspaceCardTitle")}
            description={t("settingsCurrentWorkspace.workspaceCardDescription")}
            value={currentWorkspaceName}
            onClick={handleWorkspaceRowClick}
            isMuted={isWorkspaceLocked}
            workspaceManagementState={workspaceManagementState}
          />
        </div>

        {isExpanded && isWorkspaceLocked === false ? (
          <div className="settings-workspace-picker">
            <div className="settings-workspace-choice-list">
              {availableWorkspaces.map((workspace) => (
                <button
                  key={workspace.workspaceId}
                  className={`settings-workspace-choice${workspace.workspaceId === activeWorkspace?.workspaceId ? " settings-workspace-choice-active" : ""}`}
                  type="button"
                  onClick={() => void handleWorkspaceSelect(workspace.workspaceId)}
                  disabled={isChoosingWorkspace}
                >
                  <span className="settings-workspace-choice-name">{workspace.name}</span>
                  <span className="settings-workspace-choice-meta">{formatDateTime(workspace.createdAt)}</span>
                </button>
              ))}
            </div>

            {!isCreating ? (
              <button
                className="ghost-btn"
                type="button"
                onClick={() => {
                  setIsCreating(true);
                  setErrorMessage("");
                }}
                disabled={isChoosingWorkspace}
              >
                {t("settingsCurrentWorkspace.newWorkspace")}
              </button>
            ) : (
              <form className="settings-workspace-create-form" onSubmit={(event) => void handleCreateWorkspace(event)}>
                <input
                  className="settings-workspace-create-input"
                  type="text"
                  placeholder={t("settingsCurrentWorkspace.workspaceNamePlaceholder")}
                  value={newWorkspaceName}
                  onChange={(event) => setNewWorkspaceName(event.target.value)}
                  disabled={isChoosingWorkspace}
                />
                <div className="settings-workspace-create-actions">
                  <button className="primary-btn" type="submit" disabled={isChoosingWorkspace}>
                    {t("settingsCurrentWorkspace.createWorkspace")}
                  </button>
                  <button
                    className="ghost-btn"
                    type="button"
                    onClick={() => {
                      setIsCreating(false);
                      setNewWorkspaceName("");
                      setErrorMessage("");
                    }}
                    disabled={isChoosingWorkspace}
                  >
                    {t("common.cancel")}
                  </button>
                </div>
              </form>
            )}

            {errorMessage === "" ? null : <p className="error-banner">{errorMessage}</p>}
          </div>
        ) : null}
      </SettingsGroup>

      <SettingsGroup>
        <article className="content-card settings-overview-card">
          <form className="cell-stack" onSubmit={(event) => void handleRenameSubmit(event)}>
            <div className="cell-stack">
              <h2 className="panel-subtitle">{t("workspaceOverview.rename.title")}</h2>
              <p className="subtitle">{t("workspaceOverview.rename.description")}</p>
            </div>
            <label className="cell-stack" htmlFor="current-workspace-name">
              <span className="cell-secondary">{t("workspaceOverview.rename.fieldLabel")}</span>
              <input
                id="current-workspace-name"
                className="settings-input"
                type="text"
                value={workspaceName}
                autoComplete="off"
                disabled={isWorkspaceLocked}
                onChange={(event) => {
                  setWorkspaceName(event.target.value);
                  setRenameErrorMessage("");
                }}
              />
            </label>
            {renameErrorMessage !== "" ? <p className="error-banner">{renameErrorMessage}</p> : null}
            {isSessionVerified === false ? <p className="subtitle">{t("loading.restoringSession")}</p> : null}
            {isWorkspaceLocked ? <p className="subtitle">{workspaceManagementLockedMessage}</p> : null}
            <div className="screen-actions">
              <button className="primary-btn" type="submit" disabled={isRenameDisabled}>
                {isRenameSubmitting ? t("workspaceOverview.rename.saving") : t("workspaceOverview.rename.save")}
              </button>
            </div>
          </form>
        </article>
      </SettingsGroup>
    </SettingsShell>
  );
}
