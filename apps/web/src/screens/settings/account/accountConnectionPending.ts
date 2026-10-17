import { AccountMethodError, accountMethodHandle } from "../../../api/accountMethods";
import { parseConnectionConsent, parseConnectionPreview, type ConnectionConsent, type ConnectionPreview } from "../../../api/accountConnection";

const storageKey = "nibomo-account-connection-pending";
type PendingBinding = Readonly<{ userId: string; csrfToken: string; expiresAt: number }>;
export type PendingConnection = PendingBinding & (Readonly<{ phase: "source" }>
  | Readonly<{ phase: "suggestion"; suggestion: string }>
  | Readonly<{ phase: "operation"; operation: string; operationId: string; preview: ConnectionPreview | null; consent: ConnectionConsent | null }>);
export function readPendingConnection(userId: string): PendingConnection | null {
  let stored: string | null;
  try { stored = sessionStorage.getItem(storageKey); }
  catch { throw new AccountMethodError("BROWSER_STORAGE_UNAVAILABLE"); }
  if (stored === null) return null;
  try {
    const fields = JSON.parse(stored) as PendingConnection;
    if (fields.userId !== userId || !Number.isFinite(fields.expiresAt) || fields.expiresAt <= Date.now()) {
      throw new AccountMethodError("ACCOUNT_CONNECTION_RESTART_REQUIRED");
    }
    const binding = { userId, csrfToken: accountMethodHandle(fields.csrfToken), expiresAt: fields.expiresAt };
    if (fields.phase === "source") return { ...binding, phase: "source" };
    if (fields.phase === "suggestion") return { ...binding, phase: "suggestion", suggestion: accountMethodHandle(fields.suggestion) };
    if (fields.phase !== "operation") throw new AccountMethodError("ACCOUNT_CONNECTION_RESTART_REQUIRED");
    const operation = accountMethodHandle(fields.operation);
    if (typeof fields.operationId !== "string" || fields.operationId.length === 0) throw new AccountMethodError("ACCOUNT_CONNECTION_RESTART_REQUIRED");
    const preview = fields.preview === null ? null : parseConnectionPreview(fields.preview);
    const consent = fields.consent === null ? null : parseConnectionConsent(fields.consent);
    if ((preview !== null && (preview.operation !== operation || preview.choices.operationId !== fields.operationId)) || (consent !== null && (preview === null
      || consent.operation !== operation || consent.previewDigest !== preview.choices.digest
      || JSON.stringify(consent.omittedWorkspaceIds) !== JSON.stringify(preview.choices.omittedWorkspaceIds)))) {
      throw new AccountMethodError("ACCOUNT_CONNECTION_RESTART_REQUIRED");
    }
    return { ...binding, phase: "operation", operation, operationId: fields.operationId, preview, consent };
  } catch {
    throw new AccountMethodError("ACCOUNT_CONNECTION_RESTART_REQUIRED");
  }
}
export function storePendingConnection(pending: PendingConnection): void {
  try { sessionStorage.setItem(storageKey, JSON.stringify(pending)); }
  catch { throw new AccountMethodError("BROWSER_STORAGE_UNAVAILABLE"); }
}
export function clearPendingConnection(): void {
  try { sessionStorage.removeItem(storageKey); }
  catch { throw new AccountMethodError("BROWSER_STORAGE_UNAVAILABLE"); }
}
