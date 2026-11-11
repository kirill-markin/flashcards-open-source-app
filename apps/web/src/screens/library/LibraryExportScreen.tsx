import type { ReactElement } from "react";
import { useI18n } from "../../i18n";
import { libraryAnkiExportRoute, libraryExportRoute, libraryNibomoExportRoute, libraryRoute } from "../../routes";
import { workspaceAnkiExportFilename, workspacePackageExportFilename } from "../../types";
import { useWorkspacePath } from "../../useWorkspacePath";
import { SettingsGroup, SettingsNavigationCard, SettingsShell } from "../settings/SettingsShared";

export function LibraryExportScreen(): ReactElement {
  const { t } = useI18n();
  const workspacePath = useWorkspacePath();
  const exportPath = workspacePath(libraryExportRoute);

  return (
    <SettingsShell
      title={t("settingsWorkspace.export.title")}
      subtitle={null}
      activeTab="workspace"
      backLink={{ label: t("deckDetail.actions.back"), to: workspacePath(libraryRoute), testId: "library-export-back" }}
    >
      <SettingsGroup testId="library-export-formats">
        <div className="settings-nav-list">
          <SettingsNavigationCard
            title={t("workspaceExport.title")}
            description={workspacePackageExportFilename}
            value={null}
            to={workspacePath(libraryNibomoExportRoute)}
            parentPath={exportPath}
            testId="library-export-nibomo"
          />
          <SettingsNavigationCard
            title={t("workspaceExport.ankiTitle")}
            description={workspaceAnkiExportFilename}
            value={null}
            to={workspacePath(libraryAnkiExportRoute)}
            parentPath={exportPath}
            testId="library-export-anki"
          />
        </div>
      </SettingsGroup>
    </SettingsShell>
  );
}
