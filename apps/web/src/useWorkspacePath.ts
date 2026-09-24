import { useCallback } from "react";
import { useAppData } from "./appData";
import { buildWorkspaceRoute } from "./routes";

export type WorkspacePathBuilder = (appPath: string) => string;

/**
 * Builds an in-app address under the active workspace, so a link or a `navigate` target lands on
 * `/w/<workspaceId><appPath>` directly instead of on the flat path the legacy redirect forwards.
 *
 * Callers are `AppShell` and the screens it serves under the workspace route table, where the
 * session gates have already turned every workspace-less state away before a path is built, so a
 * missing active workspace is a mounting bug rather than a case to paper over: emitting a
 * workspace-less address here would send the click through the redirect this exists to avoid, or
 * nowhere at all. A surface `App.tsx` mounts above `AuthenticatedApp` — catalog import, friend
 * invite, share, the friend-invite dev preview — never passes those gates, so none of them may
 * call this hook: the shell has no error boundary of its own, so a throw from either side reaches
 * the root `AppErrorBoundary` in `App.tsx` and the same full-page `AppCrashFallback`, and only the
 * page it takes down differs. Only catalog import takes the workspace from its own data instead,
 * because only it has one. Share and friend invite address a different account, so they stay flat —
 * a workspace segment would aim the recipient at the sender's workspace — while the friend-invite
 * dev preview navigates flat because it mounts above `AuthenticatedApp` with no `AppDataProvider`,
 * so it has no workspace to build a segment from at all.
 */
export function useWorkspacePath(): WorkspacePathBuilder {
  const { activeWorkspace } = useAppData();
  const activeWorkspaceId: string | null = activeWorkspace?.workspaceId ?? null;

  return useCallback(function buildPath(appPath: string): string {
    if (activeWorkspaceId === null) {
      throw new Error(`Workspace-scoped path built with no active workspace: ${appPath}`);
    }

    return buildWorkspaceRoute(activeWorkspaceId, appPath);
  }, [activeWorkspaceId]);
}
