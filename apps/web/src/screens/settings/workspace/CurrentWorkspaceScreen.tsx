import {
  type FormEvent,
  type ReactElement,
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";
import { ApiContractError } from "../../../api";
import { useAppData } from "../../../appData";
import {
  markIndexedDbOpenRecoveryFailureAndCheckActive,
  useAppErrorDialog,
} from "../../../appError/AppErrorContext";
import { useI18n } from "../../../i18n";
import { captureAppOperationError } from "../../../observability/appOperationObservation";
import { addWebBreadcrumb } from "../../../observability/webObservability";
import { useTransientMessage } from "../../../useTransientMessage";
import { isWorkspaceManagementLocked } from "../../../workspaceManagement";
import { SettingsActionCard, SettingsGroup, SettingsShell } from "../SettingsShared";
import { WorkspaceActionDialog } from "./WorkspaceActionDialog";

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
    errorMessage: workspaceActionErrorMessage,
    technicalError: workspaceActionTechnicalError,
    setErrorMessage: setWorkspaceActionErrorMessage,
  } = useAppData();
  const { indexedDbOpenRecoveryState, showCapturedTechnicalError } = useAppErrorDialog();
  const { t, formatDateTime } = useI18n();
  const [isChangeDialogOpen, setIsChangeDialogOpen] = useState<boolean>(false);
  const [isCreating, setIsCreating] = useState<boolean>(false);
  const [newWorkspaceName, setNewWorkspaceName] = useState<string>("");
  const [changeErrorMessage, setChangeErrorMessage] = useState<string>("");
  const [pendingWorkspaceId, setPendingWorkspaceId] = useState<string | null>(null);
  const [isRenameDialogOpen, setIsRenameDialogOpen] = useState<boolean>(false);
  const [workspaceName, setWorkspaceName] = useState<string>("");
  const [renameErrorMessage, setRenameErrorMessage] = useState<string>("");
  const [isRenameSubmitting, setIsRenameSubmitting] = useState<boolean>(false);
  const changeDialogInitialFocusRef = useRef<HTMLButtonElement | null>(null);
  const changeDialogOperationFocusRef = useRef<HTMLElement | null>(null);
  const newWorkspaceNameInputRef = useRef<HTMLInputElement | null>(null);
  const renameDialogOperationFocusRef = useRef<HTMLElement | null>(null);
  const renameInputRef = useRef<HTMLInputElement | null>(null);
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

  const closeChangeDialog = useCallback(function closeChangeDialog(): void {
    setIsChangeDialogOpen(false);
    setIsCreating(false);
    setNewWorkspaceName("");
    setChangeErrorMessage("");
    setPendingWorkspaceId(null);
    changeDialogOperationFocusRef.current = null;
  }, []);

  const closeRenameDialog = useCallback(function closeRenameDialog(): void {
    setIsRenameDialogOpen(false);
    setWorkspaceName(activeWorkspace?.name ?? "");
    setRenameErrorMessage("");
    renameDialogOperationFocusRef.current = null;
  }, [activeWorkspace?.name]);

  useEffect(() => {
    if (isCreating) {
      newWorkspaceNameInputRef.current?.focus();
      return;
    }

    if (isChangeDialogOpen) {
      changeDialogInitialFocusRef.current?.focus();
    }
  }, [isChangeDialogOpen, isCreating]);

  useEffect(() => {
    if (pendingWorkspaceId === null || isChoosingWorkspace) {
      return;
    }

    if (activeWorkspace?.workspaceId === pendingWorkspaceId) {
      closeChangeDialog();
      return;
    }

    if (workspaceActionErrorMessage !== "") {
      setChangeErrorMessage(
        workspaceActionTechnicalError === null ? workspaceActionErrorMessage : technicalErrorMessage,
      );
      setPendingWorkspaceId(null);
    }
  }, [
    activeWorkspace?.workspaceId,
    closeChangeDialog,
    isChoosingWorkspace,
    pendingWorkspaceId,
    technicalErrorMessage,
    workspaceActionErrorMessage,
    workspaceActionTechnicalError,
  ]);

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

  function showWorkspaceManagementLockedMessage(): void {
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
  }

  function runWorkspaceManagementAction(openDialog: () => void): void {
    if (isWorkspaceLocked) {
      showWorkspaceManagementLockedMessage();
      return;
    }

    openDialog();
  }

  function openChangeDialog(): void {
    setChangeErrorMessage("");
    setPendingWorkspaceId(null);
    setIsCreating(false);
    setNewWorkspaceName("");
    changeDialogOperationFocusRef.current = null;
    setIsChangeDialogOpen(true);
  }

  function openRenameDialog(): void {
    setWorkspaceName(activeWorkspace?.name ?? "");
    setRenameErrorMessage("");
    renameDialogOperationFocusRef.current = null;
    setIsRenameDialogOpen(true);
  }

  async function handleWorkspaceSelect(workspaceId: string, focusTarget: HTMLButtonElement): Promise<void> {
    if (indexedDbOpenRecoveryState.hasFailed()) {
      return;
    }

    setChangeErrorMessage("");
    setWorkspaceActionErrorMessage("");
    setPendingWorkspaceId(workspaceId);
    changeDialogOperationFocusRef.current = focusTarget;
    try {
      await chooseWorkspace(workspaceId);
      indexedDbOpenRecoveryState.throwIfFailed();
    } catch (error) {
      if (markIndexedDbOpenRecoveryFailureAndCheckActive(indexedDbOpenRecoveryState, error)) {
        return;
      }
      throw error;
    }
  }

  async function handleCreateWorkspace(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    if (indexedDbOpenRecoveryState.hasFailed()) {
      return;
    }

    const trimmedName = newWorkspaceName.trim();
    if (trimmedName === "") {
      setChangeErrorMessage(t("settingsCurrentWorkspace.workspaceNameRequired"));
      return;
    }

    try {
      setChangeErrorMessage("");
      setWorkspaceActionErrorMessage("");
      changeDialogOperationFocusRef.current = newWorkspaceNameInputRef.current;
      await createWorkspace(trimmedName);
      indexedDbOpenRecoveryState.throwIfFailed();
      closeChangeDialog();
    } catch (error) {
      if (markIndexedDbOpenRecoveryFailureAndCheckActive(indexedDbOpenRecoveryState, error)) {
        return;
      }
      const nextErrorMessage = error instanceof Error ? error.message : String(error);
      const isExpectedError = nextErrorMessage === t("app.sessionUnavailable")
        || nextErrorMessage === t("app.sessionRestoringActionLocked")
        || nextErrorMessage === t("settingsCurrentWorkspace.workspaceNameRequired");
      if (isExpectedError) {
        setChangeErrorMessage(nextErrorMessage);
        return;
      }

      showCapturedTechnicalError(error);
      setChangeErrorMessage(technicalErrorMessage);
    }
  }

  async function handleRenameSubmit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    if (indexedDbOpenRecoveryState.hasFailed()) {
      return;
    }

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
    renameDialogOperationFocusRef.current = renameInputRef.current;

    try {
      await renameWorkspace(activeWorkspace.workspaceId, trimmedWorkspaceName);
      indexedDbOpenRecoveryState.throwIfFailed();
      closeRenameDialog();
    } catch (error) {
      if (markIndexedDbOpenRecoveryFailureAndCheckActive(indexedDbOpenRecoveryState, error)) {
        return;
      }
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
      if (indexedDbOpenRecoveryState.hasFailed() === false) {
        setIsRenameSubmitting(false);
      }
    }
  }

  return (
    <>
      <SettingsShell
        title={t("settingsCurrentWorkspace.title")}
        subtitle={t("settingsCurrentWorkspace.subtitle")}
        activeTab="current-workspace"
      >
        {message === "" ? null : <p className="settings-temporary-banner" role="status">{message}</p>}

        <SettingsGroup>
          <article className="content-card settings-workspace-current-summary" data-testid="workspace-current-summary">
            <span className="cell-secondary">{t("settingsCurrentWorkspace.currentWorkspaceLabel")}</span>
            <strong className="panel-subtitle" data-testid="workspace-current-value">{currentWorkspaceName}</strong>
          </article>
        </SettingsGroup>

        <SettingsGroup>
          <div className="settings-nav-list">
            <SettingsActionCard
              title={t("settingsCurrentWorkspace.changeWorkspaceTitle")}
              description={t("settingsCurrentWorkspace.changeWorkspaceDescription")}
              value={currentWorkspaceName}
              onClick={() => runWorkspaceManagementAction(openChangeDialog)}
              testId="workspace-change-open"
              isMuted={isWorkspaceLocked}
              workspaceManagementState={workspaceManagementState}
            />
            <SettingsActionCard
              title={t("workspaceOverview.rename.title")}
              description={t("workspaceOverview.rename.description")}
              value={null}
              onClick={() => runWorkspaceManagementAction(openRenameDialog)}
              testId="workspace-rename-open"
              isMuted={isWorkspaceLocked}
              workspaceManagementState={workspaceManagementState}
            />
          </div>
        </SettingsGroup>
      </SettingsShell>

      <WorkspaceActionDialog
        isOpen={isChangeDialogOpen}
        titleId="workspace-change-dialog-title"
        title={t("settingsCurrentWorkspace.changeWorkspaceTitle")}
        descriptionId="workspace-change-dialog-description"
        description={t("settingsCurrentWorkspace.changeWorkspaceDialogDescription")}
        testId="workspace-change-dialog"
        initialFocusRef={changeDialogInitialFocusRef}
        operationReturnFocusRef={changeDialogOperationFocusRef}
        isOperationSubmitting={isChoosingWorkspace}
        onDismiss={closeChangeDialog}
      >
        <div className="settings-workspace-choice-list">
          {availableWorkspaces.map((workspace) => {
            const isCurrentWorkspace = workspace.workspaceId === activeWorkspace?.workspaceId;
            return (
              <button
                key={workspace.workspaceId}
                className={`settings-workspace-choice${isCurrentWorkspace ? " settings-workspace-choice-active" : ""}`}
                type="button"
                onClick={(event) => void handleWorkspaceSelect(workspace.workspaceId, event.currentTarget)}
                disabled={isChoosingWorkspace || isCurrentWorkspace}
                aria-current={isCurrentWorkspace ? "true" : undefined}
                data-testid="workspace-change-choice"
                data-workspace-id={workspace.workspaceId}
                data-workspace-name={workspace.name}
              >
                <span className="settings-workspace-choice-name">{workspace.name}</span>
                <span className="settings-workspace-choice-meta">{formatDateTime(workspace.createdAt)}</span>
              </button>
            );
          })}
        </div>

        {!isCreating ? (
          <button
            ref={changeDialogInitialFocusRef}
            className="ghost-btn"
            type="button"
            onClick={() => {
              setIsCreating(true);
              setChangeErrorMessage("");
            }}
            disabled={isChoosingWorkspace}
            data-testid="workspace-create-open"
          >
            {t("settingsCurrentWorkspace.newWorkspace")}
          </button>
        ) : (
          <form className="settings-workspace-create-form" onSubmit={(event) => void handleCreateWorkspace(event)}>
            <input
              ref={newWorkspaceNameInputRef}
              className="settings-input"
              type="text"
              placeholder={t("settingsCurrentWorkspace.workspaceNamePlaceholder")}
              value={newWorkspaceName}
              onChange={(event) => setNewWorkspaceName(event.target.value)}
              disabled={isChoosingWorkspace}
              data-testid="workspace-create-name-input"
            />
            <div className="settings-workspace-create-actions">
              <button
                className="primary-btn"
                type="submit"
                disabled={isChoosingWorkspace}
                data-testid="workspace-create-submit"
              >
                {t("settingsCurrentWorkspace.createWorkspace")}
              </button>
              <button
                className="ghost-btn"
                type="button"
                onClick={() => {
                  setIsCreating(false);
                  setNewWorkspaceName("");
                  setChangeErrorMessage("");
                }}
                disabled={isChoosingWorkspace}
                data-testid="workspace-create-cancel"
              >
                {t("common.cancel")}
              </button>
            </div>
          </form>
        )}

        {isChoosingWorkspace ? <p className="subtitle" role="status">{t("common.loading")}</p> : null}
        {changeErrorMessage === "" ? null : <p className="error-banner" role="alert">{changeErrorMessage}</p>}
        <div className="screen-actions">
          <button
            className="ghost-btn"
            type="button"
            onClick={closeChangeDialog}
            disabled={isChoosingWorkspace}
            data-testid="workspace-change-cancel"
          >
            {t("common.cancel")}
          </button>
        </div>
      </WorkspaceActionDialog>

      <WorkspaceActionDialog
        isOpen={isRenameDialogOpen}
        titleId="workspace-rename-dialog-title"
        title={t("workspaceOverview.rename.title")}
        descriptionId="workspace-rename-dialog-description"
        description={t("workspaceOverview.rename.description")}
        testId="workspace-rename-dialog"
        initialFocusRef={renameInputRef}
        operationReturnFocusRef={renameDialogOperationFocusRef}
        isOperationSubmitting={isRenameSubmitting}
        onDismiss={closeRenameDialog}
      >
        <form className="cell-stack" onSubmit={(event) => void handleRenameSubmit(event)}>
          <label className="cell-stack" htmlFor="current-workspace-name">
            <span className="cell-secondary">{t("workspaceOverview.rename.fieldLabel")}</span>
            <input
              ref={renameInputRef}
              id="current-workspace-name"
              className="settings-input"
              type="text"
              value={workspaceName}
              autoComplete="off"
              disabled={isWorkspaceLocked || isRenameSubmitting}
              onChange={(event) => {
                setWorkspaceName(event.target.value);
                setRenameErrorMessage("");
              }}
              data-testid="workspace-rename-name-input"
            />
          </label>
          {renameErrorMessage !== "" ? <p className="error-banner" role="alert">{renameErrorMessage}</p> : null}
          {isSessionVerified === false ? <p className="subtitle">{t("loading.restoringSession")}</p> : null}
          {isWorkspaceLocked ? <p className="subtitle">{workspaceManagementLockedMessage}</p> : null}
          <div className="screen-actions">
            <button
              className="ghost-btn"
              type="button"
              onClick={closeRenameDialog}
              disabled={isRenameSubmitting}
              data-testid="workspace-rename-cancel"
            >
              {t("common.cancel")}
            </button>
            <button
              className="primary-btn"
              type="submit"
              disabled={isRenameDisabled}
              data-testid="workspace-rename-save"
            >
              {isRenameSubmitting ? t("workspaceOverview.rename.saving") : t("workspaceOverview.rename.save")}
            </button>
          </div>
        </form>
      </WorkspaceActionDialog>
    </>
  );
}
