import type { TranslationKey } from "../../../i18n";
import type { WorkspaceSummary } from "../../../types";

export function replaceWorkspaceSummary(
  workspaces: ReadonlyArray<WorkspaceSummary>,
  workspace: WorkspaceSummary,
): ReadonlyArray<WorkspaceSummary> {
  let didReplace = false;
  const nextWorkspaces = workspaces.map((currentWorkspace) => {
    if (currentWorkspace.workspaceId !== workspace.workspaceId) {
      return currentWorkspace;
    }

    didReplace = true;
    return workspace;
  });

  return didReplace ? nextWorkspaces : [...workspaces, workspace];
}

export function createRemoteActionLockedError(t: (key: TranslationKey) => string): Error {
  return new Error(t("app.sessionRestoringActionLocked"));
}
