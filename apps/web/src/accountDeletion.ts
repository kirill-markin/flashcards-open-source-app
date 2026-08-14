import { INSTALLATION_ID_STORAGE_KEY } from "./clientIdentity";
import { LOCALE_PREFERENCE_STORAGE_KEY } from "./i18n/runtime";
import { clearWebSyncCacheForLocalBrowserDataCleanup } from "./localDb/cache";
import { isIndexedDbOpenRecoveryError } from "./localDb/core/indexedDbOpenRecovery";
import {
  addWebBreadcrumb,
  type LocalBrowserDataCleanupReason,
  type WebObservationScope,
} from "./observability/webObservability";
import { AI_CHAT_COMPOSER_SUGGESTIONS_STORAGE_KEY } from "./chat/preferences/AIChatPreferencesContext";
import { TEST_MODE_STORAGE_KEY } from "./testMode";

export type { LocalBrowserDataCleanupReason } from "./observability/webObservability";

export const deleteAccountConfirmationText: string = "delete my account";

const AUTH_RESET_REQUIRED_KEY = "flashcards-auth-reset-required";
const BROWSER_REAUTH_REQUIRED_KEY = "flashcards-browser-reauth-required";
const ACCOUNT_DELETION_PENDING_KEY = "flashcards-account-deletion-pending";
const ACCOUNT_DELETION_CSRF_TOKEN_KEY = "flashcards-account-deletion-csrf-token";
const ACCOUNT_DELETION_SERVER_CONFIRMED_KEY = "flashcards-account-deletion-server-confirmed";
const ACCOUNT_DELETION_ATTEMPT_DISPATCHED_KEY = "flashcards-account-deletion-attempt-dispatched";
const ACCOUNT_DELETION_EVENT_NAME = "flashcards-account-deletion-pending-change";
const ACCOUNT_DELETION_LOCK_NAME = "flashcards-account-deletion";
const APP_LOCAL_STORAGE_PREFIX = "flashcards-";
const APP_LOCAL_STORAGE_KEYS: ReadonlyArray<string> = [
  "selected-review-filter",
];
const APP_LOCAL_STORAGE_KEY_PREFIXES: ReadonlyArray<string> = [
  "selected-review-filter:",
];
const PRESERVED_BROWSER_LOCAL_STORAGE_KEYS: ReadonlyArray<string> = [
  INSTALLATION_ID_STORAGE_KEY,
  LOCALE_PREFERENCE_STORAGE_KEY,
  AI_CHAT_COMPOSER_SUGGESTIONS_STORAGE_KEY,
  TEST_MODE_STORAGE_KEY,
];

type AccountDeletionListener = () => void;
type BrowserStorageKeyPredicate = (storageKey: string) => boolean;

function getBrowserStorage(): Storage | null {
  const storageValue = window.localStorage;
  if (
    typeof storageValue?.getItem !== "function"
    || typeof storageValue.setItem !== "function"
    || typeof storageValue.removeItem !== "function"
  ) {
    return null;
  }

  return storageValue;
}

function dispatchAccountDeletionChange(): void {
  window.dispatchEvent(new Event(ACCOUNT_DELETION_EVENT_NAME));
}

export function isAccountDeletionPending(): boolean {
  return loadAccountDeletionAttemptId() !== null;
}

export function loadAccountDeletionAttemptId(): string | null {
  const attemptId = getBrowserStorage()?.getItem(ACCOUNT_DELETION_PENDING_KEY) ?? null;
  return attemptId === null || attemptId === "" ? null : attemptId;
}

export function setAccountDeletionPending(isPending: boolean): void {
  const browserStorage = getBrowserStorage();
  if (browserStorage === null) {
    dispatchAccountDeletionChange();
    return;
  }

  if (isPending) {
    browserStorage.setItem(ACCOUNT_DELETION_PENDING_KEY, crypto.randomUUID());
    browserStorage.removeItem(ACCOUNT_DELETION_SERVER_CONFIRMED_KEY);
    browserStorage.removeItem(ACCOUNT_DELETION_ATTEMPT_DISPATCHED_KEY);
  } else {
    browserStorage.removeItem(ACCOUNT_DELETION_PENDING_KEY);
    browserStorage.removeItem(ACCOUNT_DELETION_CSRF_TOKEN_KEY);
    browserStorage.removeItem(ACCOUNT_DELETION_SERVER_CONFIRMED_KEY);
    browserStorage.removeItem(ACCOUNT_DELETION_ATTEMPT_DISPATCHED_KEY);
  }

  dispatchAccountDeletionChange();
}

export function subscribeToAccountDeletionPending(listener: AccountDeletionListener): () => void {
  const handleStorage = (event: StorageEvent): void => {
    if (event.key === ACCOUNT_DELETION_PENDING_KEY) {
      listener();
    }
  };

  window.addEventListener("storage", handleStorage);
  window.addEventListener(ACCOUNT_DELETION_EVENT_NAME, listener);

  return (): void => {
    window.removeEventListener("storage", handleStorage);
    window.removeEventListener(ACCOUNT_DELETION_EVENT_NAME, listener);
  };
}

export function hasAccountDeletedMarker(): boolean {
  return new URL(window.location.href).searchParams.get("account_deleted") === "1";
}

export function removeAccountDeletedMarker(): void {
  const url = new URL(window.location.href);
  if (url.searchParams.get("account_deleted") !== "1") {
    return;
  }

  url.searchParams.delete("account_deleted");
  const nextUrl = `${url.pathname}${url.search}${url.hash}`;
  window.history.replaceState({}, document.title, nextUrl);
}

export function storeAccountDeletionCsrfToken(csrfToken: string | null): void {
  const browserStorage = getBrowserStorage();
  if (browserStorage === null) {
    return;
  }

  if (csrfToken === null || csrfToken === "") {
    browserStorage.removeItem(ACCOUNT_DELETION_CSRF_TOKEN_KEY);
    return;
  }

  browserStorage.setItem(ACCOUNT_DELETION_CSRF_TOKEN_KEY, csrfToken);
}

export function loadAccountDeletionCsrfToken(): string | null {
  const csrfToken = getBrowserStorage()?.getItem(ACCOUNT_DELETION_CSRF_TOKEN_KEY) ?? null;
  return csrfToken === null || csrfToken === "" ? null : csrfToken;
}

export function isAccountDeletionServerConfirmed(): boolean {
  return getBrowserStorage()?.getItem(ACCOUNT_DELETION_SERVER_CONFIRMED_KEY) === "1";
}

export function markAccountDeletionServerConfirmed(): void {
  getBrowserStorage()?.setItem(ACCOUNT_DELETION_SERVER_CONFIRMED_KEY, "1");
}

export function hasAccountDeletionAttemptDispatched(): boolean {
  const browserStorage = getBrowserStorage();
  const attemptId = loadAccountDeletionAttemptId();
  return attemptId !== null
    && browserStorage?.getItem(ACCOUNT_DELETION_ATTEMPT_DISPATCHED_KEY) === attemptId;
}

export function markAccountDeletionAttemptDispatched(): void {
  const browserStorage = getBrowserStorage();
  const attemptId = loadAccountDeletionAttemptId();
  if (browserStorage === null || attemptId === null) {
    throw new Error("Cannot dispatch account deletion without a pending attempt");
  }

  browserStorage.setItem(ACCOUNT_DELETION_ATTEMPT_DISPATCHED_KEY, attemptId);
}

export function beginAccountDeletionRetryAttempt(expectedAttemptId: string): boolean {
  const browserStorage = getBrowserStorage();
  if (
    browserStorage?.getItem(ACCOUNT_DELETION_PENDING_KEY) !== expectedAttemptId
    || browserStorage.getItem(ACCOUNT_DELETION_ATTEMPT_DISPATCHED_KEY) !== expectedAttemptId
  ) {
    return false;
  }

  browserStorage.setItem(ACCOUNT_DELETION_PENDING_KEY, crypto.randomUUID());
  browserStorage.removeItem(ACCOUNT_DELETION_ATTEMPT_DISPATCHED_KEY);
  return true;
}

export function runWithAccountDeletionLock<Result>(
  signal: AbortSignal,
  action: () => Promise<Result>,
): Promise<Result> {
  return navigator.locks.request(
    ACCOUNT_DELETION_LOCK_NAME,
    { mode: "exclusive", signal },
    action,
  );
}

function normalizeCleanupError(error: unknown): Error {
  return error instanceof Error ? error : new Error(String(error));
}

function readCleanupErrorName(error: Error): string {
  const metadata = error as Readonly<{ indexedDbErrorName?: unknown }>;
  if (typeof metadata.indexedDbErrorName === "string" && metadata.indexedDbErrorName.trim() !== "") {
    return metadata.indexedDbErrorName;
  }

  return error.name;
}

function getCurrentRoute(): string | null {
  if (typeof window === "undefined") {
    return null;
  }

  return `${window.location.pathname}${window.location.search}${window.location.hash}`;
}

function buildCleanupObservationScope(browserStorage: Storage | null): WebObservationScope {
  return {
    app: "web",
    feature: "auth",
    userId: null,
    workspaceId: null,
    installationId: browserStorage?.getItem(INSTALLATION_ID_STORAGE_KEY) ?? null,
    route: getCurrentRoute(),
    requestId: null,
    statusCode: null,
    code: null,
  };
}

function logLocalBrowserDataCleanup(
  browserStorage: Storage | null,
  input: Readonly<{
    eventName:
      | "local_browser_data_cleanup_started"
      | "local_browser_data_cleanup_succeeded"
      | "local_browser_data_cleanup_failed";
    reason: LocalBrowserDataCleanupReason;
    indexedDbCleared: boolean;
    localStorageCleared: boolean;
    errorName: string | null;
    errorMessage: string | null;
  }>,
): void {
  addWebBreadcrumb({
    action: "local_browser_data_cleanup",
    scope: buildCleanupObservationScope(browserStorage),
    details: input,
  });
}

function clearUserScopedBrowserStorage(browserStorage: Storage, shouldRemoveStorageKey: BrowserStorageKeyPredicate): void {
  const storageKeysToRemove: Array<string> = [];
  for (let index = 0; index < browserStorage.length; index += 1) {
    const storageKey = browserStorage.key(index);
    if (storageKey === null) {
      continue;
    }

    if (shouldRemoveStorageKey(storageKey)) {
      storageKeysToRemove.push(storageKey);
    }
  }

  for (const storageKey of storageKeysToRemove) {
    browserStorage.removeItem(storageKey);
  }
}

function shouldRemoveAppLocalStorageKey(storageKey: string): boolean {
  if (PRESERVED_BROWSER_LOCAL_STORAGE_KEYS.includes(storageKey)) {
    return false;
  }

  return storageKey.startsWith(APP_LOCAL_STORAGE_PREFIX)
    || APP_LOCAL_STORAGE_KEYS.includes(storageKey)
    || APP_LOCAL_STORAGE_KEY_PREFIXES.some((prefix) => storageKey.startsWith(prefix));
}

function isReauthMarkerStorageKey(storageKey: string): boolean {
  return storageKey === BROWSER_REAUTH_REQUIRED_KEY || storageKey === AUTH_RESET_REQUIRED_KEY;
}

function shouldRemoveAppLocalStorageKeyAfterIncompleteIndexedDbCleanup(storageKey: string): boolean {
  if (isReauthMarkerStorageKey(storageKey)) {
    return false;
  }

  return shouldRemoveAppLocalStorageKey(storageKey);
}

function isPendingAccountDeletionStorageKey(storageKey: string): boolean {
  return storageKey === ACCOUNT_DELETION_PENDING_KEY
    || storageKey === ACCOUNT_DELETION_CSRF_TOKEN_KEY
    || storageKey === ACCOUNT_DELETION_SERVER_CONFIRMED_KEY
    || storageKey === ACCOUNT_DELETION_ATTEMPT_DISPATCHED_KEY;
}

export function markBrowserReauthRequired(): void {
  getBrowserStorage()?.setItem(BROWSER_REAUTH_REQUIRED_KEY, "1");
}

export function isBrowserReauthRequired(): boolean {
  const browserStorage = getBrowserStorage();
  return browserStorage?.getItem(BROWSER_REAUTH_REQUIRED_KEY) === "1"
    || browserStorage?.getItem(AUTH_RESET_REQUIRED_KEY) === "1";
}

export function clearBrowserReauthRequired(): void {
  const browserStorage = getBrowserStorage();
  browserStorage?.removeItem(BROWSER_REAUTH_REQUIRED_KEY);
  browserStorage?.removeItem(AUTH_RESET_REQUIRED_KEY);
}

export function markAuthResetRequired(): void {
  markBrowserReauthRequired();
}

export function isAuthResetRequired(): boolean {
  return isBrowserReauthRequired();
}

export function clearAuthResetRequired(): void {
  clearBrowserReauthRequired();
}

/**
 * Clears browser-local user state aggressively after logout, account deletion,
 * or a confirmed account switch.
 *
 * The stable installation id, explicit locale preference, AI chat suggestions
 * setting, and hidden test-mode flag are intentionally retained because they are
 * browser-scoped preferences rather than user-scoped session state. Keeping them
 * preserves device identity, UI language, local chat UI preferences, and local
 * tester tooling across re-login while still clearing application data.
 */
export async function clearAllLocalBrowserData(
  reason: LocalBrowserDataCleanupReason,
  throwIfIndexedDbOpenRecoveryFailed: () => void,
): Promise<void> {
  const browserStorage = getBrowserStorage();
  let indexedDbError: Error | null = null;

  logLocalBrowserDataCleanup(browserStorage, {
    eventName: "local_browser_data_cleanup_started",
    reason,
    indexedDbCleared: false,
    localStorageCleared: false,
    errorName: null,
    errorMessage: null,
  });

  throwIfIndexedDbOpenRecoveryFailed();
  try {
    await clearWebSyncCacheForLocalBrowserDataCleanup(throwIfIndexedDbOpenRecoveryFailed);
    throwIfIndexedDbOpenRecoveryFailed();
  } catch (error) {
    throwIfIndexedDbOpenRecoveryFailed();
    if (isIndexedDbOpenRecoveryError(error)) {
      throw error;
    }
    indexedDbError = normalizeCleanupError(error);
  }

  throwIfIndexedDbOpenRecoveryFailed();
  if (browserStorage !== null) {
    const shouldRemoveBaseStorageKey: BrowserStorageKeyPredicate = indexedDbError === null
      ? shouldRemoveAppLocalStorageKey
      : shouldRemoveAppLocalStorageKeyAfterIncompleteIndexedDbCleanup;
    const shouldRemoveStorageKey: BrowserStorageKeyPredicate = reason === "account_deletion_submit"
      ? (storageKey: string): boolean => (
        isPendingAccountDeletionStorageKey(storageKey) === false
        && shouldRemoveBaseStorageKey(storageKey)
      )
      : shouldRemoveBaseStorageKey;
    clearUserScopedBrowserStorage(browserStorage, shouldRemoveStorageKey);
  }

  if (indexedDbError !== null) {
    logLocalBrowserDataCleanup(browserStorage, {
      eventName: "local_browser_data_cleanup_failed",
      reason,
      indexedDbCleared: false,
      localStorageCleared: browserStorage !== null,
      // The privacy sanitizer redacts errorMessage; errorName stays readable
      // in Sentry and carries the underlying IndexedDB error name when the
      // failure originated in the local database layer.
      errorName: readCleanupErrorName(indexedDbError),
      errorMessage: indexedDbError.message,
    });
    throw indexedDbError;
  }

  logLocalBrowserDataCleanup(browserStorage, {
    eventName: "local_browser_data_cleanup_succeeded",
    reason,
    indexedDbCleared: true,
    localStorageCleared: browserStorage !== null,
    errorName: null,
    errorMessage: null,
  });
}
