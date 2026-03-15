import { type FormEvent, type ReactElement, useEffect, useRef, useState } from "react";
import type { WorkspaceSummary } from "./types";

type Props = Readonly<{
  workspaces: ReadonlyArray<WorkspaceSummary>;
  currentWorkspaceId: string;
  isBusy: boolean;
  accountSettingsUrl: string;
  logoutUrl: string;
  onSelectWorkspace: (workspaceId: string) => Promise<void>;
  onCreateWorkspace: (name: string) => Promise<void>;
}>;

export function AccountMenu(props: Props): ReactElement {
  const {
    workspaces,
    currentWorkspaceId,
    isBusy,
    accountSettingsUrl,
    logoutUrl,
    onSelectWorkspace,
    onCreateWorkspace,
  } = props;
  const [isOpen, setIsOpen] = useState<boolean>(false);
  const [isCreating, setIsCreating] = useState<boolean>(false);
  const [newWorkspaceName, setNewWorkspaceName] = useState<string>("");
  const [errorMessage, setErrorMessage] = useState<string>("");
  const menuRef = useRef<HTMLDivElement | null>(null);
  const buttonRef = useRef<HTMLButtonElement | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    if (!isOpen) {
      return;
    }

    function handleMouseDown(event: MouseEvent): void {
      const target = event.target as Node;
      if (
        menuRef.current !== null && !menuRef.current.contains(target)
        && buttonRef.current !== null && !buttonRef.current.contains(target)
      ) {
        setIsOpen(false);
        setIsCreating(false);
        setNewWorkspaceName("");
        setErrorMessage("");
      }
    }

    document.addEventListener("mousedown", handleMouseDown);
    return () => document.removeEventListener("mousedown", handleMouseDown);
  }, [isOpen]);

  useEffect(() => {
    if (!isOpen) {
      return;
    }

    function handleKeyDown(event: KeyboardEvent): void {
      if (event.key === "Escape") {
        setIsOpen(false);
        setIsCreating(false);
        setNewWorkspaceName("");
        setErrorMessage("");
      }
    }

    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [isOpen]);

  useEffect(() => {
    if (isCreating && inputRef.current !== null) {
      inputRef.current.focus();
    }
  }, [isCreating]);

  async function handleWorkspaceSelect(workspaceId: string): Promise<void> {
    setErrorMessage("");
    await onSelectWorkspace(workspaceId);
    setIsOpen(false);
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
      await onCreateWorkspace(trimmedName);
      setIsOpen(false);
      setIsCreating(false);
      setNewWorkspaceName("");
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : String(error));
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
        aria-label="Open account menu"
        disabled={isBusy}
      >
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <circle cx="12" cy="8" r="4" />
          <path d="M20 21a8 8 0 0 0-16 0" />
        </svg>
      </button>
      {isOpen ? (
        <div ref={menuRef} className="account-menu-dropdown">
          {workspaces.length > 0 ? (
            <>
              <div className="account-menu-section-label">Workspaces</div>
              {workspaces.map((workspace) => (
                <button
                  key={workspace.workspaceId}
                  className={`account-menu-item${workspace.workspaceId === currentWorkspaceId ? " account-menu-item-active" : ""}`}
                  type="button"
                  onClick={() => void handleWorkspaceSelect(workspace.workspaceId)}
                  disabled={isBusy}
                >
                  {workspace.name}
                </button>
              ))}
            </>
          ) : null}
          {!isCreating ? (
            <button
              className="account-menu-item account-menu-item-create"
              type="button"
              onClick={() => {
                setIsCreating(true);
                setErrorMessage("");
              }}
              disabled={isBusy}
            >
              + New workspace
            </button>
          ) : (
            <form className="account-menu-create-form" onSubmit={(event) => void handleCreateWorkspace(event)}>
              <input
                ref={inputRef}
                className="account-menu-create-input"
                type="text"
                placeholder="Workspace name"
                value={newWorkspaceName}
                onChange={(event) => setNewWorkspaceName(event.target.value)}
                disabled={isBusy}
              />
              {errorMessage !== "" ? <div className="account-menu-error">{errorMessage}</div> : null}
            </form>
          )}
          <div className="account-menu-separator" />
          <a className="account-menu-item account-menu-link" href={accountSettingsUrl}>
            Account settings
          </a>
          <a className="account-menu-item account-menu-link" href={logoutUrl}>
            Logout
          </a>
        </div>
      ) : null}
    </div>
  );
}
