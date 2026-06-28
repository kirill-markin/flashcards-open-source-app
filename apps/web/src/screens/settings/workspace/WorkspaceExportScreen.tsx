import { useRef, useState, type ReactElement } from "react";
import { useAppData } from "../../../appData";
import { importWorkspacePackageCardsLocally } from "../../../appData/sync/local/syncLocalMutations";
import { useAppErrorDialog } from "../../../appError/AppErrorContext";
import { useI18n } from "../../../i18n";
import { loadAllActiveCardsForSql } from "../../../localDb/cards/cards";
import { captureAppOperationError } from "../../../observability/appOperationObservation";
import {
  FlashcardsPackageError,
  prepareFlashcardsPackageImportWithTag,
  prepareFlashcardsPackageImportWithoutTag,
  readFlashcardsPackageZip,
} from "../../../workspacePackage";
import { exportWorkspaceCardsCsv, exportWorkspaceCardsPackage } from "../../../workspaceExport";
import { SettingsShell } from "../SettingsShared";

export function WorkspaceExportScreen(): ReactElement {
  const { activeWorkspace, cloudSettings, refreshLocalData, session } = useAppData();
  const { showCapturedTechnicalError } = useAppErrorDialog();
  const { t } = useI18n();
  const packageImportInputRef = useRef<HTMLInputElement | null>(null);
  const [isCsvExporting, setIsCsvExporting] = useState<boolean>(false);
  const [isPackageExporting, setIsPackageExporting] = useState<boolean>(false);
  const [isPackageImporting, setIsPackageImporting] = useState<boolean>(false);
  const [shouldTagPackageImport, setShouldTagPackageImport] = useState<boolean>(true);
  const [errorMessage, setErrorMessage] = useState<string>("");
  const [successMessage, setSuccessMessage] = useState<string>("");
  const technicalErrorMessage = t("appError.technicalError.message");

  function captureWorkspaceOperationError(error: unknown, operation: "workspace_export" | "workspace_import"): boolean {
    return captureAppOperationError(error, {
      feature: "settings",
      operation,
      userId: session?.userId ?? null,
      workspaceId: activeWorkspace?.workspaceId ?? null,
      installationId: cloudSettings?.installationId ?? null,
      entityId: activeWorkspace?.workspaceId ?? null,
    });
  }

  function refreshAfterPackageImport(): void {
    void refreshLocalData().catch((error: unknown) => {
      captureWorkspaceOperationError(error, "workspace_import");
    });
  }

  async function exportCsv(): Promise<void> {
    if (activeWorkspace === null) {
      setErrorMessage(t("workspaceExport.workspaceUnavailable"));
      setSuccessMessage("");
      return;
    }

    setIsCsvExporting(true);
    setErrorMessage("");
    setSuccessMessage("");

    try {
      await exportWorkspaceCardsCsv({
        workspaceId: activeWorkspace.workspaceId,
        workspaceName: activeWorkspace.name,
        now: new Date(),
        document: window.document,
        urlApi: URL,
      });
      setSuccessMessage(t("workspaceExport.success"));
    } catch (error) {
      const wasCaptured = captureWorkspaceOperationError(error, "workspace_export");
      if (wasCaptured) {
        showCapturedTechnicalError(error);
        setErrorMessage(technicalErrorMessage);
      } else {
        setErrorMessage(error instanceof Error ? error.message : String(error));
      }
    } finally {
      setIsCsvExporting(false);
    }
  }

  async function exportPackage(): Promise<void> {
    if (activeWorkspace === null) {
      setErrorMessage(t("workspaceExport.workspaceUnavailable"));
      setSuccessMessage("");
      return;
    }

    setIsPackageExporting(true);
    setErrorMessage("");
    setSuccessMessage("");

    try {
      await exportWorkspaceCardsPackage({
        workspaceId: activeWorkspace.workspaceId,
        document: window.document,
        urlApi: URL,
      });
      setSuccessMessage(t("workspaceExport.packageExportSuccess"));
    } catch (error) {
      const wasCaptured = captureWorkspaceOperationError(error, "workspace_export");
      if (wasCaptured) {
        showCapturedTechnicalError(error);
        setErrorMessage(technicalErrorMessage);
      } else {
        setErrorMessage(error instanceof Error ? error.message : String(error));
      }
    } finally {
      setIsPackageExporting(false);
    }
  }

  async function importPackageFile(file: File): Promise<void> {
    if (activeWorkspace === null) {
      setErrorMessage(t("workspaceExport.workspaceUnavailable"));
      setSuccessMessage("");
      return;
    }

    setIsPackageImporting(true);
    setErrorMessage("");
    setSuccessMessage("");

    try {
      const now = new Date();
      const importedAt = now.toISOString();
      const zipBytes = new Uint8Array(await file.arrayBuffer());
      const packageData = readFlashcardsPackageZip(zipBytes);
      const existingCards = await loadAllActiveCardsForSql(activeWorkspace.workspaceId);
      const existingTags = existingCards.flatMap((card) => card.tags);
      const importId = crypto.randomUUID().toLowerCase();
      const preparedImport = shouldTagPackageImport
        ? prepareFlashcardsPackageImportWithTag({
          packageData,
          existingTags,
          now,
          importId,
          importedAt,
        })
        : prepareFlashcardsPackageImportWithoutTag({
          packageData,
          importId,
          importedAt,
        });

      await importWorkspacePackageCardsLocally({
        workspaceId: activeWorkspace.workspaceId,
        cards: preparedImport.cards,
        clientUpdatedAt: importedAt,
      });
      setSuccessMessage(preparedImport.importTag === null
        ? t("workspaceExport.packageImportSuccess", { count: preparedImport.cards.length })
        : t("workspaceExport.packageImportSuccessWithTag", {
          count: preparedImport.cards.length,
          tag: preparedImport.importTag,
        }));
      refreshAfterPackageImport();
    } catch (error) {
      if (error instanceof FlashcardsPackageError) {
        setErrorMessage(error.message);
        return;
      }

      const wasCaptured = captureWorkspaceOperationError(error, "workspace_import");
      if (wasCaptured) {
        showCapturedTechnicalError(error);
        setErrorMessage(technicalErrorMessage);
      } else {
        setErrorMessage(error instanceof Error ? error.message : String(error));
      }
    } finally {
      setIsPackageImporting(false);
      if (packageImportInputRef.current !== null) {
        packageImportInputRef.current.value = "";
      }
    }
  }

  function handlePackageImportInputChange(): void {
    const file = packageImportInputRef.current?.files?.[0] ?? null;
    if (file === null) {
      return;
    }

    void importPackageFile(file);
  }

  return (
    <SettingsShell
      title={t("workspaceExport.title")}
      subtitle={t("workspaceExport.subtitle")}
      activeTab="workspace"
    >
      <section className="settings-group">
        <h2 className="panel-subtitle">{t("workspaceExport.formatsTitle")}</h2>
        <article className="content-card workspace-export-format-card">
          <div className="settings-nav-card-copy">
            <strong className="panel-subtitle">{t("workspaceExport.packageTitle")}</strong>
            <p className="subtitle">{t("workspaceExport.packageDescription")}</p>
          </div>
          <label className="workspace-import-tag-control">
            <input
              type="checkbox"
              checked={shouldTagPackageImport}
              disabled={isPackageImporting}
              data-testid="workspace-package-import-tag-checkbox"
              onChange={(event) => setShouldTagPackageImport(event.currentTarget.checked)}
            />
            <span className="workspace-import-tag-copy">
              <span>{t("workspaceExport.importTagLabel")}</span>
              <span className="subtitle">{t("workspaceExport.importTagDescription")}</span>
            </span>
          </label>
          <input
            ref={packageImportInputRef}
            type="file"
            accept=".zip,application/zip,application/x-zip-compressed"
            disabled={isPackageImporting}
            data-testid="workspace-package-import-file-input"
            style={{ display: "none" }}
            onChange={handlePackageImportInputChange}
          />
          <div className="workspace-export-actions">
            <button
              className="primary-btn"
              type="button"
              disabled={isPackageExporting}
              data-testid="workspace-package-export-button"
              onClick={() => void exportPackage()}
            >
              {isPackageExporting ? t("workspaceExport.packageExporting") : t("workspaceExport.packageExportButton")}
            </button>
            <button
              className="ghost-btn"
              type="button"
              disabled={isPackageImporting}
              data-testid="workspace-package-import-button"
              onClick={() => packageImportInputRef.current?.click()}
            >
              {isPackageImporting ? t("workspaceExport.packageImporting") : t("workspaceExport.packageImportButton")}
            </button>
          </div>
        </article>
        <article className="content-card workspace-export-format-card">
          <div className="settings-nav-card-copy">
            <strong className="panel-subtitle">{t("workspaceExport.csvTitle")}</strong>
            <p className="subtitle">{t("workspaceExport.csvDescription")}</p>
          </div>
          <button
            className="primary-btn"
            type="button"
            disabled={isCsvExporting}
            data-testid="workspace-csv-export-button"
            onClick={() => void exportCsv()}
          >
            {isCsvExporting ? t("workspaceExport.exporting") : t("workspaceExport.exportButton")}
          </button>
        </article>
        {errorMessage !== "" ? <p className="error-banner" role="alert" data-testid="workspace-export-error">{errorMessage}</p> : null}
        {successMessage !== "" ? <p className="subtitle" data-testid="workspace-export-success">{successMessage}</p> : null}
      </section>
    </SettingsShell>
  );
}
