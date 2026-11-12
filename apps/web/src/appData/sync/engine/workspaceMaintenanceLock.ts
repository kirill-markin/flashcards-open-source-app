export class WorkspaceMaintenancePendingError extends Error {}

export type WorkspaceMaintenanceOwner = Readonly<{ userId: string; workspaceId: string }>;

export function workspaceMaintenanceKey({ userId, workspaceId }: WorkspaceMaintenanceOwner): string {
  return `flashcards-workspace-maintenance:${JSON.stringify([userId, workspaceId])}`;
}

export function supportsWorkspaceMaintenanceLock(): boolean {
  return typeof navigator.locks?.request === "function";
}

export async function runWithWorkspaceWriteLock<T>(owner: WorkspaceMaintenanceOwner, action: () => Promise<T>): Promise<T> {
  if (!supportsWorkspaceMaintenanceLock()) return action();
  return navigator.locks.request(workspaceMaintenanceKey(owner), { mode: "shared" }, action);
}

export async function runWithWorkspaceSyncLock<T>(
  owner: WorkspaceMaintenanceOwner,
  action: () => Promise<T>,
): Promise<T | "contended"> {
  if (!supportsWorkspaceMaintenanceLock()) return action();
  return navigator.locks.request(workspaceMaintenanceKey(owner), { mode: "shared", ifAvailable: true }, (lock) => (
    lock === null ? "contended" : action()
  ));
}

export async function runWithExclusiveWorkspaceMaintenance<T>(owner: WorkspaceMaintenanceOwner, action: () => Promise<T>): Promise<T> {
  if (!supportsWorkspaceMaintenanceLock()) {
    throw new Error("This browser cannot coordinate workspace maintenance between tabs (Web Locks unavailable).");
  }
  return navigator.locks.request(workspaceMaintenanceKey(owner), { mode: "exclusive" }, action);
}
