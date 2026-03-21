import { useState, type ReactElement } from "react";
import { useAppData } from "../appData";
import { exportWorkspaceCardsCsv } from "../workspaceExport";
import { SettingsShell } from "./SettingsShared";

export function WorkspaceExportScreen(): ReactElement {
  const { activeWorkspace } = useAppData();
  const [isExporting, setIsExporting] = useState<boolean>(false);
  const [errorMessage, setErrorMessage] = useState<string>("");
  const [successMessage, setSuccessMessage] = useState<string>("");

  async function exportCsv(): Promise<void> {
    if (activeWorkspace === null) {
      setErrorMessage("Workspace is unavailable");
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
      setSuccessMessage("CSV download started.");
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : String(error));
    } finally {
      setIsExporting(false);
    }
  }

  return (
    <SettingsShell
      title="Export"
      subtitle="Export active cards from this workspace in a standard CSV file."
      activeTab="workspace"
    >
      <section className="settings-group">
        <h2 className="panel-subtitle">Available formats</h2>
        <article className="content-card">
          <div className="settings-nav-card-copy">
            <strong className="panel-subtitle">CSV</strong>
            <p className="subtitle">
              Exports front text, back text, and tags for all active cards in the current workspace.
            </p>
          </div>
          {errorMessage !== "" ? <p className="error-banner">{errorMessage}</p> : null}
          {successMessage !== "" ? <p className="subtitle">{successMessage}</p> : null}
          <button className="primary-btn" type="button" disabled={isExporting} onClick={() => void exportCsv()}>
            {isExporting ? "Exporting..." : "Export CSV"}
          </button>
        </article>
      </section>
    </SettingsShell>
  );
}
