import { type FormEvent, type ReactElement, useState } from "react";
import { useAppData } from "../appData";
import { useI18n } from "../i18n";
import { useTransientMessage } from "../useTransientMessage";
import { isWorkspaceManagementLocked } from "../workspaceManagement";
import { SettingsActionCard, SettingsGroup, SettingsShell } from "./SettingsShared";

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
  } = useAppData();
  const { t, formatDateTime } = useI18n();
  const [isExpanded, setIsExpanded] = useState<boolean>(false);
  const [isCreating, setIsCreating] = useState<boolean>(false);
  const [newWorkspaceName, setNewWorkspaceName] = useState<string>("");
  const [errorMessage, setErrorMessage] = useState<string>("");
  const { message, showMessage } = useTransientMessage(3000);
  const isWorkspaceLocked = isWorkspaceManagementLocked(isSessionVerified, cloudSettings);
  const currentWorkspaceName = activeWorkspace?.name ?? t("common.unavailable");
  const workspaceManagementState = isWorkspaceLocked ? "locked" : "ready";
  const workspaceManagementLockedMessage = t("workspaceManagement.lockedMessage");

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
      setErrorMessage(error instanceof Error ? error.message : String(error));
    }
  }

  function handleWorkspaceRowClick(): void {
    if (isWorkspaceLocked) {
      console.info("workspace_management_interaction_blocked", buildWorkspaceInteractionLogDetails(null, null));
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
    </SettingsShell>
  );
}
