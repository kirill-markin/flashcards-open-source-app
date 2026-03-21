import { type FormEvent, type ReactElement, useState } from "react";
import { useAppData } from "../appData";
import { useTransientMessage } from "../useTransientMessage";
import { isWorkspaceManagementLocked, workspaceManagementLockedBannerMessage } from "../workspaceManagement";
import { SettingsActionCard, SettingsGroup, SettingsShell } from "./SettingsShared";

export function CurrentWorkspaceScreen(): ReactElement {
  const {
    activeWorkspace,
    availableWorkspaces,
    chooseWorkspace,
    createWorkspace,
    isChoosingWorkspace,
    isSessionVerified,
    cloudSettings,
  } = useAppData();
  const [isExpanded, setIsExpanded] = useState<boolean>(false);
  const [isCreating, setIsCreating] = useState<boolean>(false);
  const [newWorkspaceName, setNewWorkspaceName] = useState<string>("");
  const [errorMessage, setErrorMessage] = useState<string>("");
  const { message, showMessage } = useTransientMessage(3000);
  const isWorkspaceLocked = isWorkspaceManagementLocked(isSessionVerified, cloudSettings);
  const currentWorkspaceName = activeWorkspace?.name ?? "Unavailable";

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
      setErrorMessage("Workspace name is required");
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
      showMessage(workspaceManagementLockedBannerMessage);
      return;
    }

    setErrorMessage("");
    setIsExpanded((currentValue) => !currentValue);
  }

  return (
    <SettingsShell
      title="Current Workspace"
      subtitle="Choose which workspace is active in this browser or create a new workspace for this account."
      activeSection={null}
    >
      {message === "" ? null : <p className="settings-temporary-banner" role="status">{message}</p>}

      <SettingsGroup>
        <div className="settings-nav-list">
          <SettingsActionCard
            title="Workspace"
            description="Change the active workspace or create a new workspace for this account."
            value={currentWorkspaceName}
            onClick={handleWorkspaceRowClick}
            isMuted={isWorkspaceLocked}
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
                  <span className="settings-workspace-choice-meta">{workspace.createdAt}</span>
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
                New Workspace
              </button>
            ) : (
              <form className="settings-workspace-create-form" onSubmit={(event) => void handleCreateWorkspace(event)}>
                <input
                  className="settings-workspace-create-input"
                  type="text"
                  placeholder="Workspace name"
                  value={newWorkspaceName}
                  onChange={(event) => setNewWorkspaceName(event.target.value)}
                  disabled={isChoosingWorkspace}
                />
                <div className="settings-workspace-create-actions">
                  <button className="primary-btn" type="submit" disabled={isChoosingWorkspace}>
                    Create Workspace
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
                    Cancel
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
