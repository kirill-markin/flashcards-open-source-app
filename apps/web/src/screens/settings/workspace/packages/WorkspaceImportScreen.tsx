import type { ReactElement } from "react";
import { useI18n } from "../../../../i18n";
import { WorkspaceImportPresentation } from "./fileImport/WorkspaceImportPresentation";
import { useWorkspacePackageImportController } from "./fileImport/useWorkspacePackageImportController";
import { WorkspaceImportShell } from "./WorkspaceImportShell";
import { useWorkspaceImportActions } from "./useWorkspaceImportActions";

export function WorkspaceImportScreen(): ReactElement {
  const actions = useWorkspaceImportActions();
  const { t } = useI18n();

  return (
    <WorkspaceImportShell title={t("workspaceImport.nibomoTitle")}>
      <WorkspacePackageImportForm
        key={JSON.stringify([actions.appData.session?.userId, actions.workspaceId, actions.installationId])}
        actions={actions}
      />
    </WorkspaceImportShell>
  );
}

function WorkspacePackageImportForm({ actions }: Readonly<{
  actions: ReturnType<typeof useWorkspaceImportActions>;
}>): ReactElement {
  const { state, commands } = useWorkspacePackageImportController(actions);
  return <WorkspaceImportPresentation state={state} commands={commands} />;
}
