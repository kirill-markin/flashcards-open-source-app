import { AccountMethodError, accountMethodHandle, parseMethodOperation, parseProviderTarget, type ProviderTarget, type AccountProvider, type MethodOperation } from "../../../api/accountMethods";

const storageKey = "nibomo-account-method-pending";
export type PendingMethod = Readonly<{ userId: string; operation: MethodOperation; csrfToken: string;
  phase: "reauth" | "mutation"; provider: AccountProvider; baseline: ReadonlyArray<ProviderTarget>; expiresAt: number }>;
export function readPendingMethod(userId: string): PendingMethod | null {
  let stored: string | null;
  try { stored = sessionStorage.getItem(storageKey); }
  catch { throw new AccountMethodError("BROWSER_STORAGE_UNAVAILABLE"); }
  if (stored === null) return null;
  try {
    const fields = JSON.parse(stored) as PendingMethod;
    if (fields.userId !== userId || !Number.isFinite(fields.expiresAt) || fields.expiresAt <= Date.now()
      || (fields.provider !== "apple" && fields.provider !== "google") || !Array.isArray(fields.baseline)
      || (fields.phase !== "reauth" && fields.phase !== "mutation")) throw new AccountMethodError("AUTH_ATTEMPT_RESTART_REQUIRED");
    return { userId, operation: parseMethodOperation(fields.operation), csrfToken: accountMethodHandle(fields.csrfToken),
      phase: fields.phase, provider: fields.provider, baseline: fields.baseline.map(parseProviderTarget), expiresAt: fields.expiresAt };
  } catch {
    clearPendingMethod();
    throw new AccountMethodError("AUTH_ATTEMPT_RESTART_REQUIRED");
  }
}
export function storePendingMethod(pending: PendingMethod): void {
  try { sessionStorage.setItem(storageKey, JSON.stringify(pending)); }
  catch { throw new AccountMethodError("BROWSER_STORAGE_UNAVAILABLE"); }
}
export function clearPendingMethod(): void {
  try { sessionStorage.removeItem(storageKey); }
  catch { throw new AccountMethodError("BROWSER_STORAGE_UNAVAILABLE"); }
}
