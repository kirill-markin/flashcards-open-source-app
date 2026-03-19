import { useEffect, useState, type ReactElement } from "react";
import { useAppData } from "../appData";
import {
  deleteAccountConfirmationText,
  setAccountDeletionPending,
  storeAccountDeletionCsrfToken,
} from "../accountDeletion";
import { getCachedSessionCsrfToken } from "../api";
import { SettingsShell } from "./SettingsShared";

export function DangerZoneScreen(): ReactElement {
  const { isSessionVerified } = useAppData();
  const [isDeleteDialogOpen, setIsDeleteDialogOpen] = useState<boolean>(false);
  const [deleteConfirmationValue, setDeleteConfirmationValue] = useState<string>("");

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

  function openDeleteDialog(): void {
    if (isSessionVerified === false) {
      return;
    }

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
    <>
      <SettingsShell
        title="Danger Zone"
        subtitle="Delete the account and all cloud data."
        activeSection="account"
      >
        <section className="content-card settings-danger-card">
          <div className="cell-stack">
            <h2 className="panel-subtitle">Delete account</h2>
            <p className="subtitle">
              {isSessionVerified
                ? "Permanently delete this account and all cloud data."
                : "Restoring session before account deletion..."}
            </p>
          </div>
          <div className="screen-actions">
            <button
              className="ghost-btn settings-danger-btn"
              type="button"
              onClick={openDeleteDialog}
              disabled={isSessionVerified === false}
            >
              Delete my account
            </button>
          </div>
        </section>
      </SettingsShell>

      {isDeleteDialogOpen && isSessionVerified ? (
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
    </>
  );
}
