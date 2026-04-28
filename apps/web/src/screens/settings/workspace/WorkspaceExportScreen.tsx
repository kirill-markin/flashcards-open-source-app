import { useState, type ReactElement } from "react";
import { useAppData } from "../../../appData";
import { useI18n } from "../../../i18n";
import { exportWorkspaceCardsCsv } from "../../../workspaceExport";
import { SettingsShell } from "../SettingsShared";

export function WorkspaceExportScreen(): ReactElement {
  const { activeWorkspace } = useAppData();
  const { t } = useI18n();
  const [isExporting, setIsExporting] = useState<boolean>(false);
  const [errorMessage, setErrorMessage] = useState<string>("");
  const [successMessage, setSuccessMessage] = useState<string>("");

  async function exportCsv(): Promise<void> {
    if (activeWorkspace === null) {
      setErrorMessage(t("workspaceExport.workspaceUnavailable"));
      setSuccessMessage("");
      return;
    }

    setIsExporting(true);
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
      setErrorMessage(error instanceof Error ? error.message : String(error));
    } finally {
      setIsExporting(false);
    }
  }

  return (
    <SettingsShell
      title={t("workspaceExport.title")}
      subtitle={t("workspaceExport.subtitle")}
      activeTab="workspace"
    >
      <section className="settings-group">
        <h2 className="panel-subtitle">{t("workspaceExport.formatsTitle")}</h2>
        <article className="content-card">
          <div className="settings-nav-card-copy">
            <strong className="panel-subtitle">{t("workspaceExport.csvTitle")}</strong>
            <p className="subtitle">{t("workspaceExport.csvDescription")}</p>
          </div>
          {errorMessage !== "" ? <p className="error-banner">{errorMessage}</p> : null}
          {successMessage !== "" ? <p className="subtitle">{successMessage}</p> : null}
          <button className="primary-btn" type="button" disabled={isExporting} onClick={() => void exportCsv()}>
            {isExporting ? t("workspaceExport.exporting") : t("workspaceExport.exportButton")}
          </button>
        </article>
      </section>
    </SettingsShell>
  );
}
