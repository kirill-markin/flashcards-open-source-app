export class WorkspaceMaintenancePendingError extends Error {}

type WorkspaceOwner = Readonly<{ userId: string; workspaceId: string }>;

type PendingWorkspaceMaintenance =
  | Readonly<{ stage: "unresolved"; previewFingerprint: string }>
  | Readonly<{ stage: "confirmed" }>;

const unresolvedPrefix = "unresolved:";

function lockName({ userId, workspaceId }: WorkspaceOwner): string {
  return `flashcards-workspace-maintenance:${JSON.stringify([userId, workspaceId])}`;
}

export function supportsWorkspaceMaintenanceLock(): boolean {
  return typeof navigator.locks?.request === "function";
}

export function hasPendingWorkspaceMaintenance(owner: WorkspaceOwner): boolean {
  return window.localStorage.getItem(lockName(owner)) !== null;
}

export function readPendingWorkspaceMaintenance(owner: WorkspaceOwner): PendingWorkspaceMaintenance | null {
  const value = window.localStorage.getItem(lockName(owner));
  if (value === null) return null;
  if (value === "confirmed") return { stage: "confirmed" };
  if (value.startsWith(unresolvedPrefix) && value.length > unresolvedPrefix.length) {
    return { stage: "unresolved", previewFingerprint: value.slice(unresolvedPrefix.length) };
  }

  throw new Error("The saved workspace maintenance confirmation could not be read.");
}

export function markWorkspaceMaintenanceUnresolved(owner: WorkspaceOwner, previewFingerprint: string): void {
  window.localStorage.setItem(lockName(owner), `${unresolvedPrefix}${previewFingerprint}`);
}

export function markWorkspaceMaintenanceConfirmed(owner: WorkspaceOwner): void {
  window.localStorage.setItem(lockName(owner), "confirmed");
}

export function clearPendingWorkspaceMaintenance(owner: WorkspaceOwner): void {
  window.localStorage.removeItem(lockName(owner));
}

export async function runWithWorkspaceWriteLock<T>(owner: WorkspaceOwner, action: () => Promise<T>): Promise<T> {
  if (!supportsWorkspaceMaintenanceLock()) return action();
  return navigator.locks.request(lockName(owner), { mode: "shared" }, action);
}

export async function runWithWorkspaceSyncLock<T>(
  owner: WorkspaceOwner,
  action: () => Promise<T>,
): Promise<T | "contended"> {
  if (!supportsWorkspaceMaintenanceLock()) return action();
  return navigator.locks.request(lockName(owner), { mode: "shared", ifAvailable: true }, (lock) => (
    lock === null ? "contended" : action()
  ));
}

export async function runWithExclusiveWorkspaceMaintenance<T>(owner: WorkspaceOwner, action: () => Promise<T>): Promise<T> {
  if (!supportsWorkspaceMaintenanceLock()) {
    throw new Error("This browser cannot coordinate workspace maintenance between tabs (Web Locks unavailable).");
  }
  return navigator.locks.request(lockName(owner), { mode: "exclusive" }, action);
}
