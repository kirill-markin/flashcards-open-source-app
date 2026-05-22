import type { TranslationKey } from "../../i18n";
import type { WorkspaceSummary } from "../../types";

export const defaultWorkspaceName: string = "Personal";
export const resumeRetryDelayMs: number = 750;
export const resumeRetryCount: number = 2;

const sessionAccountSwitchErrorName = "SessionAccountSwitchError";

export type SessionAccountSwitchError = Error & Readonly<{
  name: typeof sessionAccountSwitchErrorName;
}>;

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

export function consumeLoggedOutMarker(): boolean {
  const url = new URL(window.location.href);
  if (url.searchParams.get("logged_out") !== "1") {
    return false;
  }

  url.searchParams.delete("logged_out");
  const nextUrl = `${url.pathname}${url.search}${url.hash}`;
  window.history.replaceState({}, document.title, nextUrl);
  return true;
}

export function createRemoteActionLockedError(t: (key: TranslationKey) => string): Error {
  return new Error(t("app.sessionRestoringActionLocked"));
}

export function createSessionAccountSwitchError(errorMessage: string): SessionAccountSwitchError {
  const error = new Error(errorMessage);
  error.name = sessionAccountSwitchErrorName;
  return error as SessionAccountSwitchError;
}

export function isSessionAccountSwitchError(error: unknown): error is SessionAccountSwitchError {
  return error instanceof Error && error.name === sessionAccountSwitchErrorName;
}

export function waitForDelay(delayMs: number): Promise<void> {
  return new Promise((resolve) => {
    window.setTimeout(resolve, delayMs);
  });
}
