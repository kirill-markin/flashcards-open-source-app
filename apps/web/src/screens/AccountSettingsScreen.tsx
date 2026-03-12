import { useEffect, useState, type ReactElement } from "react";
import {
  deleteAccountConfirmationText,
  setAccountDeletionPending,
  storeAccountDeletionCsrfToken,
} from "../accountDeletion";
import { getCachedSessionCsrfToken, listAgentApiKeys, revokeAgentApiKey } from "../api";
import type { AgentApiKeyConnection } from "../types";

export function AccountSettingsScreen(): ReactElement {
  const [connections, setConnections] = useState<ReadonlyArray<AgentApiKeyConnection>>([]);
  const [instructions, setInstructions] = useState<string>("");
  const [errorMessage, setErrorMessage] = useState<string>("");
  const [busyConnectionId, setBusyConnectionId] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [isDeleteDialogOpen, setIsDeleteDialogOpen] = useState<boolean>(false);
  const [deleteConfirmationValue, setDeleteConfirmationValue] = useState<string>("");

  useEffect(() => {
    void loadConnections();
  }, []);

  useEffect(() => {
    if (!isDeleteDialogOpen) {
      return;
    }

    const handleKeyDown = (event: KeyboardEvent): void => {
      if (event.key === "Escape") {
        closeDeleteDialog();
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return (): void => {
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [isDeleteDialogOpen]);

  async function loadConnections(): Promise<void> {
    setIsLoading(true);
    try {
      const result = await listAgentApiKeys();
      setConnections(result.connections);
      setInstructions(result.instructions);
      setErrorMessage("");
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : String(error));
    } finally {
      setIsLoading(false);
    }
  }

  async function handleRevoke(connectionId: string): Promise<void> {
    setBusyConnectionId(connectionId);
    try {
      const result = await revokeAgentApiKey(connectionId);
      setConnections((currentConnections) => currentConnections.map((connection) => (
        connection.connectionId === result.connection.connectionId ? result.connection : connection
      )));
      setInstructions(result.instructions);
      setErrorMessage("");
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : String(error));
    } finally {
      setBusyConnectionId(null);
    }
  }

  function openDeleteDialog(): void {
    setDeleteConfirmationValue("");
    setIsDeleteDialogOpen(true);
  }

  function closeDeleteDialog(): void {
    setDeleteConfirmationValue("");
    setIsDeleteDialogOpen(false);
  }

  function startAccountDeletion(): void {
    storeAccountDeletionCsrfToken(getCachedSessionCsrfToken());
    setAccountDeletionPending(true);
  }

  const isDeleteConfirmationMatched = deleteConfirmationValue === deleteAccountConfirmationText;

  return (
    <main className="container settings-page">
      <section className="panel settings-panel">
        <div className="screen-head">
          <div>
            <h1 className="panel-subtitle">Account settings</h1>
            <p className="subtitle">Manage long-lived bot connections for this account.</p>
          </div>
        </div>
        {errorMessage !== "" ? <p className="error-banner">{errorMessage}</p> : null}
        {instructions !== "" ? <p className="subtitle">{instructions}</p> : null}
        <div className="settings-connections-list">
          {isLoading ? <div className="content-card">Loading connections…</div> : null}
          {!isLoading && connections.length === 0 ? (
            <div className="content-card">No bot connections have been created yet.</div>
          ) : null}
          {!isLoading ? connections.map((connection) => (
            <article key={connection.connectionId} className="content-card settings-connection-card">
              <div className="settings-connection-header">
                <div className="cell-stack">
                  <strong className="cell-primary">{connection.label}</strong>
                  <span className="txn-cell-mono">{connection.connectionId}</span>
                </div>
                <span className="badge">{connection.revokedAt === null ? "Active" : "Revoked"}</span>
              </div>
              <div className="settings-connection-meta">
                <div className="cell-stack">
                  <span className="cell-secondary">Created</span>
                  <span className="txn-cell-mono">{connection.createdAt}</span>
                </div>
                <div className="cell-stack">
                  <span className="cell-secondary">Last used</span>
                  <span className="txn-cell-mono">{connection.lastUsedAt ?? "Never"}</span>
                </div>
                <div className="cell-stack">
                  <span className="cell-secondary">Revoked</span>
                  <span className="txn-cell-mono">{connection.revokedAt ?? "Not revoked"}</span>
                </div>
              </div>
              <div className="screen-actions">
                <button
                  className="ghost-btn"
                  type="button"
                  onClick={() => void handleRevoke(connection.connectionId)}
                  disabled={connection.revokedAt !== null || busyConnectionId === connection.connectionId}
                >
                  Revoke
                </button>
              </div>
            </article>
          )) : null}
        </div>
        <section className="content-card settings-danger-card">
          <div className="cell-stack">
            <h2 className="panel-subtitle">Delete account</h2>
            <p className="subtitle">
              Permanently delete this account and all cloud data.
            </p>
          </div>
          <div className="screen-actions">
            <button className="ghost-btn settings-danger-btn" type="button" onClick={openDeleteDialog}>
              Delete my account
            </button>
          </div>
        </section>
      </section>
      {isDeleteDialogOpen ? (
        <section
          className="settings-delete-dialog-backdrop"
          role="dialog"
          aria-modal="true"
          aria-labelledby="delete-account-title"
        >
          <div className="panel settings-delete-dialog">
            <div className="cell-stack">
              <h2 id="delete-account-title" className="panel-subtitle">Delete my account</h2>
              <p className="error-banner settings-delete-warning">
                Warning! This action is permanent. You will lose all your data forever, and we will not be able to restore it.
              </p>
              <p className="subtitle settings-delete-phrase" aria-label="confirmation phrase">
                {deleteAccountConfirmationText}
              </p>
              <label className="cell-stack" htmlFor="delete-account-confirmation">
                <span className="cell-secondary">Type the phrase exactly to continue.</span>
                <input
                  id="delete-account-confirmation"
                  className="settings-input"
                  type="text"
                  value={deleteConfirmationValue}
                  autoFocus
                  autoCapitalize="none"
                  autoComplete="off"
                  autoCorrect="off"
                  spellCheck={false}
                  onChange={(event) => {
                    setDeleteConfirmationValue(event.target.value);
                  }}
                  onPaste={(event) => {
                    event.preventDefault();
                  }}
                  onDrop={(event) => {
                    event.preventDefault();
                  }}
                />
              </label>
            </div>
            <div className="screen-actions">
              <button className="ghost-btn" type="button" onClick={closeDeleteDialog}>
                Cancel
              </button>
              <button
                className="ghost-btn settings-danger-btn"
                type="button"
                disabled={!isDeleteConfirmationMatched}
                onClick={startAccountDeletion}
              >
                Delete my account
              </button>
            </div>
          </div>
        </section>
      ) : null}
    </main>
  );
}
