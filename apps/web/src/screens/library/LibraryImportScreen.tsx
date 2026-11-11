import type { ReactElement } from "react";
import { useI18n } from "../../i18n";
import {
  libraryAnkiImportRoute,
  libraryImportRoute,
  libraryNibomoImportRoute,
  libraryRoute,
  librarySpreadsheetImportRoute,
} from "../../routes";
import { workspacePackageExportFilename } from "../../types";
import { useWorkspacePath } from "../../useWorkspacePath";
import { SettingsGroup, SettingsNavigationCard, SettingsShell } from "../settings/SettingsShared";

export function LibraryImportScreen(): ReactElement {
  const { t } = useI18n();
  const workspacePath = useWorkspacePath();
  const importPath = workspacePath(libraryImportRoute);

  return (
    <SettingsShell
      title={t("workspaceImport.title")}
      subtitle={null}
      activeTab="workspace"
      backLink={{ label: t("deckDetail.actions.back"), to: workspacePath(libraryRoute), testId: "library-import-back" }}
    >
      <SettingsGroup testId="library-import-formats">
        <div className="settings-nav-list">
          <SettingsNavigationCard
            title={t("workspaceImport.nibomoTitle")}
            description={workspacePackageExportFilename}
            value={null}
            to={workspacePath(libraryNibomoImportRoute)}
            parentPath={importPath}
            testId="library-import-nibomo"
          />
          <SettingsNavigationCard
            title={t("workspaceImport.anki.title")}
            description=".apkg"
            value={null}
            to={workspacePath(libraryAnkiImportRoute)}
            parentPath={importPath}
            testId="library-import-anki"
          />
          <SettingsNavigationCard
            title={t("workspaceImport.spreadsheetTitle")}
            description={t("workspaceImport.textTitle")}
            value={null}
            to={workspacePath(librarySpreadsheetImportRoute)}
            parentPath={importPath}
            testId="library-import-spreadsheet"
          />
        </div>
      </SettingsGroup>
    </SettingsShell>
  );
}
