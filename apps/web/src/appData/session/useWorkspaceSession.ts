import { useWorkspaceActions } from "./actions/useWorkspaceActions";
import { useWorkspaceActivation } from "./activation/useWorkspaceActivation";
import { useWorkspaceLifecycle } from "./lifecycle/useWorkspaceLifecycle";
import type {
  UseWorkspaceSessionParams,
  WorkspaceSession,
} from "./workspaceSessionTypes";

export function useWorkspaceSession(params: UseWorkspaceSessionParams): WorkspaceSession {
  const activation = useWorkspaceActivation(params);
  const { initialize } = useWorkspaceLifecycle({
    ...params,
    resolveInitialWorkspace: activation.resolveInitialWorkspace,
    clearConfirmedUserScopedState: activation.clearConfirmedUserScopedState,
  });
  const actions = useWorkspaceActions({
    ...params,
    activateWorkspace: activation.activateWorkspace,
  });

  return {
    initialize,
    chooseWorkspace: actions.chooseWorkspace,
    createWorkspace: actions.createWorkspace,
    renameWorkspace: actions.renameWorkspace,
    deleteWorkspace: actions.deleteWorkspace,
    loadWorkspaceResetProgressPreview: actions.loadWorkspaceResetProgressPreview,
    resetWorkspaceProgress: actions.resetWorkspaceProgress,
  };
}
