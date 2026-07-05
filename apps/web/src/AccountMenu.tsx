import { type FormEvent, type ReactElement, useCallback, useEffect, useRef, useState } from "react";
import { useAppErrorDialog } from "./appError/AppErrorContext";
import { AnchoredFloatingOverlay, useAnchoredFloatingOutsidePointerDismiss } from "./floating";
import { useI18n } from "./i18n";
import type { WorkspaceSummary } from "./types";
import { useTransientMessage } from "./useTransientMessage";

type Props = Readonly<{
  workspaces: ReadonlyArray<WorkspaceSummary>;
  currentWorkspaceId: string;
  currentWorkspaceName: string;
  isBusy: boolean;
  isWorkspaceManagementLocked: boolean;
  workspaceManagementLockedMessage: string;
  accountSettingsUrl: string;
  logoutUrl: string;
  onSelectWorkspace: (workspaceId: string) => Promise<void>;
  onCreateWorkspace: (name: string) => Promise<void>;
}>;

const accountMenuViewportPaddingPx: number = 12;
const accountMenuOffsetPx: number = 10;
const accountMenuMaxWidthPx: number = 280;
const accountMenuMaxHeightPx: number = 420;
const accountMenuFirstActionSelector: string = "button:not(:disabled), a[href], input:not(:disabled)";

export function AccountMenu(props: Props): ReactElement {
  const {
    workspaces,
    currentWorkspaceId,
    currentWorkspaceName,
    isBusy,
    isWorkspaceManagementLocked,
    workspaceManagementLockedMessage,
    accountSettingsUrl,
    logoutUrl,
    onSelectWorkspace,
    onCreateWorkspace,
  } = props;
  const { showCapturedTechnicalError } = useAppErrorDialog();
  const { t, formatDateTime } = useI18n();
  const [isOpen, setIsOpen] = useState<boolean>(false);
  const [isCreating, setIsCreating] = useState<boolean>(false);
  const [newWorkspaceName, setNewWorkspaceName] = useState<string>("");
  const [errorMessage, setErrorMessage] = useState<string>("");
  const menuRef = useRef<HTMLDivElement | null>(null);
  const buttonRef = useRef<HTMLButtonElement | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const { message, showMessage } = useTransientMessage(3000);
  const technicalErrorMessage = t("appError.technicalError.message");

  const closeAndResetMenu = useCallback(function closeAndResetMenu(): void {
    setIsOpen(false);
    setIsCreating(false);
    setNewWorkspaceName("");
    setErrorMessage("");
  }, []);

  const focusFirstMenuAction = useCallback(function focusFirstMenuAction(): void {
    const firstMenuAction = menuRef.current?.querySelector<HTMLElement>(accountMenuFirstActionSelector) ?? null;
    firstMenuAction?.focus();
  }, []);

  const closeAndResetMenuAndFocusButton = useCallback(function closeAndResetMenuAndFocusButton(): void {
    closeAndResetMenu();
    buttonRef.current?.focus();
  }, [closeAndResetMenu]);

  useAnchoredFloatingOutsidePointerDismiss({
    triggerRef: buttonRef,
    overlayRef: menuRef,
    enabled: isOpen,
    onClose: closeAndResetMenu,
  });

  useEffect(() => {
    if (!isOpen) {
      return;
    }

    focusFirstMenuAction();
  }, [focusFirstMenuAction, isOpen]);

  useEffect(() => {
    if (!isOpen) {
      return;
    }

    function handleKeyDown(event: KeyboardEvent): void {
      if (event.key === "Escape") {
        closeAndResetMenuAndFocusButton();
      }
    }

    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [closeAndResetMenuAndFocusButton, isOpen]);

  useEffect(() => {
    if (isCreating && inputRef.current !== null) {
      inputRef.current.focus();
    }
  }, [isCreating]);

  async function handleWorkspaceSelect(workspaceId: string): Promise<void> {
    if (isWorkspaceManagementLocked) {
      showMessage(workspaceManagementLockedMessage);
      return;
    }

    setErrorMessage("");
    await onSelectWorkspace(workspaceId);
    setIsOpen(false);
    setIsCreating(false);
    setNewWorkspaceName("");
  }

  async function handleCreateWorkspace(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();

    if (isWorkspaceManagementLocked) {
      showMessage(workspaceManagementLockedMessage);
      return;
    }

    const trimmedName = newWorkspaceName.trim();
    if (trimmedName === "") {
      setErrorMessage(t("accountMenu.workspaceNameRequired"));
      return;
    }

    try {
      setErrorMessage("");
      await onCreateWorkspace(trimmedName);
      setIsOpen(false);
      setIsCreating(false);
      setNewWorkspaceName("");
    } catch (error) {
      const nextErrorMessage = error instanceof Error ? error.message : String(error);
      const isExpectedError = nextErrorMessage === t("app.sessionUnavailable")
        || nextErrorMessage === t("app.sessionRestoringActionLocked")
        || nextErrorMessage === t("accountMenu.workspaceNameRequired")
        || nextErrorMessage === t("settingsCurrentWorkspace.workspaceNameRequired");
      if (isExpectedError) {
        setErrorMessage(nextErrorMessage);
        return;
      }

      showCapturedTechnicalError(error);
      setErrorMessage(technicalErrorMessage);
    }
  }

  return (
    <div className="account-menu-wrap">
      <button
        ref={buttonRef}
        className="account-menu-button"
        type="button"
        onClick={() => setIsOpen((currentValue) => !currentValue)}
        aria-expanded={isOpen}
        aria-haspopup="true"
        aria-label={t("accountMenu.openButtonLabel")}
      >
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <circle cx="12" cy="8" r="4" />
          <path d="M20 21a8 8 0 0 0-16 0" />
        </svg>
      </button>
      <AnchoredFloatingOverlay
        isOpen={isOpen}
        referenceRef={buttonRef}
        floatingRef={menuRef}
        placement="bottom-end"
        viewportPaddingPx={accountMenuViewportPaddingPx}
        offsetPx={accountMenuOffsetPx}
        minimumWidth={null}
        maxWidthPx={accountMenuMaxWidthPx}
        maxHeightPx={accountMenuMaxHeightPx}
        className="account-menu-dropdown"
        id={null}
        role={null}
        ariaLabel={null}
        ariaLabelledBy={null}
        ariaDescribedBy={null}
        ariaModal={null}
      >
        {message === "" ? null : <div className="account-menu-banner" role="status">{message}</div>}
        <div className="account-menu-section-label">{t("accountMenu.currentWorkspaceSection")}</div>
        {isWorkspaceManagementLocked ? (
          <button
            className="account-menu-item account-menu-item-muted"
            type="button"
            onClick={() => showMessage(workspaceManagementLockedMessage)}
          >
            {currentWorkspaceName}
          </button>
        ) : workspaces.length > 0 ? (
          <>
            {workspaces.map((workspace) => (
              <button
                key={workspace.workspaceId}
                className={`account-menu-item${workspace.workspaceId === currentWorkspaceId ? " account-menu-item-active" : ""}`}
                type="button"
                onClick={() => void handleWorkspaceSelect(workspace.workspaceId)}
                disabled={isBusy}
              >
                <span className="cell-stack">
                  <span>{workspace.name}</span>
                  <span className="cell-secondary">{formatDateTime(workspace.createdAt)}</span>
                </span>
              </button>
            ))}
          </>
        ) : null}
        {isWorkspaceManagementLocked ? null : !isCreating ? (
          <button
            className="account-menu-item account-menu-item-create"
            type="button"
            onClick={() => {
              setIsCreating(true);
              setErrorMessage("");
            }}
            disabled={isBusy}
          >
            + {t("accountMenu.newWorkspace")}
          </button>
        ) : (
          <form className="account-menu-create-form" onSubmit={(event) => void handleCreateWorkspace(event)}>
            <input
              ref={inputRef}
              className="account-menu-create-input"
              type="text"
              placeholder={t("accountMenu.workspaceNamePlaceholder")}
              value={newWorkspaceName}
              onChange={(event) => setNewWorkspaceName(event.target.value)}
              disabled={isBusy}
            />
            {errorMessage !== "" ? <div className="account-menu-error">{errorMessage}</div> : null}
          </form>
        )}
        <div className="account-menu-separator" />
        <a className="account-menu-item account-menu-link" href={accountSettingsUrl}>
          {t("navigation.settings")}
        </a>
        <a className="account-menu-item account-menu-link" href={logoutUrl}>
          {t("accountMenu.logout")}
        </a>
      </AnchoredFloatingOverlay>
    </div>
  );
}
