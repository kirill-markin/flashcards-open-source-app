import { ApiError } from "../../../api";
import { executeCardMaintenance, reconcileCardMaintenance } from "../../../api/endpoints/cardMaintenance";
import type { CardMaintenanceExecution } from "../../../apiContracts/cardMaintenance";
import { workspaceMaintenanceKey, type WorkspaceMaintenanceOwner } from "./workspaceMaintenanceLock";

type WorkspaceMaintenanceConfirmation =
  | Readonly<{ outcome: "confirmed"; persistConfirmation: () => void }>
  | Readonly<{ outcome: "uncertain"; error: unknown }>;

type WorkspaceMaintenanceRecovery = Readonly<{ retireAfterSync: () => void }> & (
  | Readonly<{ stage: "confirmed" }>
  | Readonly<{ stage: "unresolved"; reconcile: (signal: AbortSignal) => Promise<boolean> }>
);

const unresolvedPrefix = "unresolved:";
const confirmedValue = "confirmed";

function isDefiniteMaintenanceRejection(error: unknown): error is ApiError {
  return error instanceof ApiError && error.statusCode >= 400 && error.statusCode < 500 && (
    error.code === "CARD_MAINTENANCE_PREVIEW_CHANGED"
    || error.code === "CARD_MAINTENANCE_TARGET_NOT_FOUND"
    || error.code === "CARD_MAINTENANCE_CONFIRMATION_INVALID"
    || error.code === "CARD_MAINTENANCE_SHARED"
    || error.code === "CARD_MAINTENANCE_INPUT_INVALID"
  );
}

export async function confirmWorkspaceMaintenance(
  owner: WorkspaceMaintenanceOwner,
  execution: CardMaintenanceExecution,
): Promise<WorkspaceMaintenanceConfirmation> {
  const key = workspaceMaintenanceKey(owner);
  window.localStorage.setItem(key, `${unresolvedPrefix}${execution.previewFingerprint}`);
  try {
    await executeCardMaintenance(owner.workspaceId, owner.userId, execution);
  } catch (error) {
    if (isDefiniteMaintenanceRejection(error)) {
      window.localStorage.removeItem(key);
      throw error;
    }
    return { outcome: "uncertain", error };
  }

  // A failure to persist an accepted execution belongs to sync recovery.
  return {
    outcome: "confirmed",
    persistConfirmation: () => window.localStorage.setItem(key, confirmedValue),
  };
}

export function hasPendingWorkspaceMaintenance(owner: WorkspaceMaintenanceOwner): boolean {
  return window.localStorage.getItem(workspaceMaintenanceKey(owner)) !== null;
}

export function readWorkspaceMaintenanceRecovery(owner: WorkspaceMaintenanceOwner): WorkspaceMaintenanceRecovery | null {
  const key = workspaceMaintenanceKey(owner);
  const value = window.localStorage.getItem(key);
  if (value === null) return null;

  const retireAfterSync = (): void => window.localStorage.removeItem(key);
  if (value === confirmedValue) return { stage: "confirmed", retireAfterSync };
  if (value.startsWith(unresolvedPrefix) && value.length > unresolvedPrefix.length) {
    const previewFingerprint = value.slice(unresolvedPrefix.length);
    return {
      stage: "unresolved",
      // A pull can reach the server before the lost execute request takes the workspace lock.
      reconcile: (signal) => reconcileCardMaintenance(owner.workspaceId, owner.userId, previewFingerprint, signal),
      retireAfterSync,
    };
  }

  throw new Error("The saved workspace maintenance confirmation could not be read.");
}
