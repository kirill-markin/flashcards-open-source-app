import type { ReactElement, ReactNode } from "react";
import { useI18n } from "../../../../i18n";
import { libraryImportRoute } from "../../../../routes";
import { useWorkspacePath } from "../../../../useWorkspacePath";
import { SettingsGroup, SettingsShell } from "../../SettingsShared";

type WorkspaceImportShellProps = Readonly<{
  title: string;
  children: ReactNode;
}>;

export function WorkspaceImportShell({ title, children }: WorkspaceImportShellProps): ReactElement {
  const { t } = useI18n();
  const workspacePath = useWorkspacePath();

  return (
    <SettingsShell
      title={title}
      subtitle={null}
      activeTab="workspace"
      backLink={{ label: t("deckDetail.actions.back"), to: workspacePath(libraryImportRoute), testId: "workspace-import-back" }}
    >
      <SettingsGroup>{children}</SettingsGroup>
    </SettingsShell>
  );
}
