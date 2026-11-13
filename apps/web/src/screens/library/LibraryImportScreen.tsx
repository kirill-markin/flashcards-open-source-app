import type { ReactElement } from "react";
import { useI18n } from "../../i18n";
import {
  buildLibraryAiImportRoute,
  libraryImportRoute,
  libraryNibomoImportRoute,
  libraryRoute,
  librarySpreadsheetImportRoute,
} from "../../routes";
import { workspacePackageExportFilename } from "../../types";
import { useWorkspacePath } from "../../useWorkspacePath";
import {
  aiImportSources,
  aiImportSourceSubtitle,
  aiImportSourceTitle,
} from "../settings/workspace/packages/aiImportSources";
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
      <SettingsGroup title={t("workspaceImport.fromAnotherAppGroup")} testId="library-import-apps">
        <div className="settings-nav-list">
          {aiImportSources.map((source) => (
            <SettingsNavigationCard
              key={source.id}
              title={aiImportSourceTitle(source, t)}
              description={aiImportSourceSubtitle(source, t)}
              value={null}
              to={workspacePath(buildLibraryAiImportRoute(source.id))}
              parentPath={importPath}
              testId={`library-import-${source.id}`}
            />
          ))}
        </div>
      </SettingsGroup>
      <SettingsGroup title={t("workspaceImport.yourFilesGroup")} testId="library-import-formats">
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
