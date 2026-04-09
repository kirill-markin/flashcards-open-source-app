import { useEffect, useState, type ReactElement } from "react";
import { useAppData } from "../appData";
import {
  deleteAccountConfirmationText,
  setAccountDeletionPending,
  storeAccountDeletionCsrfToken,
} from "../accountDeletion";
import { getCachedSessionCsrfToken } from "../api";
import { useI18n } from "../i18n";
import { SettingsShell } from "./SettingsShared";

export function DangerZoneScreen(): ReactElement {
  const { isSessionVerified } = useAppData();
  const { t } = useI18n();
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
        title={t("dangerZone.title")}
        subtitle={t("dangerZone.subtitle")}
        activeTab="account"
      >
        <section className="content-card settings-danger-card">
          <div className="cell-stack">
            <h2 className="panel-subtitle">{t("dangerZone.deleteTitle")}</h2>
            <p className="subtitle">
              {isSessionVerified
                ? t("dangerZone.deleteDescription")
                : t("dangerZone.restoringDescription")}
            </p>
          </div>
          <div className="screen-actions">
            <button
              className="ghost-btn settings-danger-btn"
              type="button"
              onClick={openDeleteDialog}
              disabled={isSessionVerified === false}
            >
              {t("dangerZone.deleteButton")}
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
              <h2 id="delete-account-title" className="panel-subtitle">{t("dangerZone.dialogTitle")}</h2>
              <p className="error-banner settings-delete-warning">
                {t("dangerZone.dialogWarning")}
              </p>
              <p className="subtitle settings-delete-phrase" aria-label="confirmation phrase">
                {deleteAccountConfirmationText}
              </p>
              <label className="cell-stack" htmlFor="delete-account-confirmation">
                <span className="cell-secondary">{t("dangerZone.typePhrase")}</span>
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
                {t("common.cancel")}
              </button>
              <button
                className="ghost-btn settings-danger-btn"
                type="button"
                disabled={!isDeleteConfirmationMatched}
                onClick={startAccountDeletion}
              >
                {t("dangerZone.deleteButton")}
              </button>
            </div>
          </div>
        </section>
      ) : null}
    </>
  );
}
