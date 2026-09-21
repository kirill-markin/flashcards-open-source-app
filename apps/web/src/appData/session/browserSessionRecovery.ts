import { isAccountDeletionAttemptStorageKey } from "../../accountDeletion/accountDeletionAttempt";
import { analyticsEnabledStorageKey } from "../../analytics/identity";
import { AI_CHAT_COMPOSER_SUGGESTIONS_STORAGE_KEY } from "../../chat/preferences/AIChatPreferencesContext";
import { INSTALLATION_ID_STORAGE_KEY } from "../../clientIdentity";
import { LOCALE_PREFERENCE_STORAGE_KEY } from "../../i18n/runtime";
import { clearWebSyncCacheForLocalBrowserDataCleanup } from "../../localDb/cache";
import { isIndexedDbOpenRecoveryError } from "../../localDb/core/indexedDbOpenRecovery";
import {
  addWebBreadcrumb,
  type LocalBrowserDataCleanupReason,
  type WebObservationScope,
} from "../../observability/webObservability";
import { TEST_MODE_STORAGE_KEY } from "../../testMode";

export type { LocalBrowserDataCleanupReason } from "../../observability/webObservability";

const AUTH_RESET_REQUIRED_KEY = "flashcards-auth-reset-required";
const BROWSER_REAUTH_REQUIRED_KEY = "flashcards-browser-reauth-required";
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
  analyticsEnabledStorageKey,
];

type BrowserStorageKeyPredicate = (storageKey: string) => boolean;

function getBrowserStorage(): Storage | null {
  try {
    const storageValue = window.localStorage;
    if (
      typeof storageValue?.getItem !== "function"
      || typeof storageValue.setItem !== "function"
      || typeof storageValue.removeItem !== "function"
    ) {
      return null;
    }

    return storageValue;
  } catch {
    // Browsers with blocked site data throw on the localStorage getter itself; treat that as
    // storage being unavailable.
    return null;
  }
}

function readStoredValue(browserStorage: Storage | null, storageKey: string): string | null {
  if (browserStorage === null) {
    return null;
  }

  try {
    return browserStorage.getItem(storageKey);
  } catch {
    return null;
  }
}

function writeStoredValue(browserStorage: Storage | null, storageKey: string, storageValue: string): boolean {
  if (browserStorage === null) {
    return false;
  }

  try {
    browserStorage.setItem(storageKey, storageValue);

    return true;
  } catch {
    return false;
  }
}

function removeStoredValue(browserStorage: Storage | null, storageKey: string): boolean {
  if (browserStorage === null) {
    return false;
  }

  try {
    browserStorage.removeItem(storageKey);

    return true;
  } catch {
    return false;
  }
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
    installationId: readStoredValue(browserStorage, INSTALLATION_ID_STORAGE_KEY),
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

// Returns whether every matching key was removed.
function clearUserScopedBrowserStorage(browserStorage: Storage, shouldRemoveStorageKey: BrowserStorageKeyPredicate): boolean {
  const storageKeysToRemove: Array<string> = [];
  try {
    for (let index = 0; index < browserStorage.length; index += 1) {
      const storageKey = browserStorage.key(index);
      if (storageKey === null) {
        continue;
      }

      if (shouldRemoveStorageKey(storageKey)) {
        storageKeysToRemove.push(storageKey);
      }
    }
  } catch {
    return false;
  }

  return storageKeysToRemove
    .map((storageKey) => removeStoredValue(browserStorage, storageKey))
    .every((isRemoved) => isRemoved);
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

export function markBrowserReauthRequired(): void {
  writeStoredValue(getBrowserStorage(), BROWSER_REAUTH_REQUIRED_KEY, "1");
}

export function isBrowserReauthRequired(): boolean {
  const browserStorage = getBrowserStorage();
  return readStoredValue(browserStorage, BROWSER_REAUTH_REQUIRED_KEY) === "1"
    || readStoredValue(browserStorage, AUTH_RESET_REQUIRED_KEY) === "1";
}

export function clearBrowserReauthRequired(): void {
  const browserStorage = getBrowserStorage();
  removeStoredValue(browserStorage, BROWSER_REAUTH_REQUIRED_KEY);
  removeStoredValue(browserStorage, AUTH_RESET_REQUIRED_KEY);
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
 * setting, hidden test-mode flag, and analytics kill switch are intentionally
 * retained because they are browser-scoped preferences rather than user-scoped
 * session state. Keeping them preserves device identity, UI language, local chat
 * UI preferences, local tester tooling, and an explicit analytics opt-out across
 * re-login while still clearing application data.
 *
 * The stored analytics consent answer is retained for the same reason, account
 * deletion included: it is this browser's answer rather than the account's, it is
 * given by visitors who have no account at all, and discarding it would make a
 * browser that refused askable and re-mintable again
 * (docs/analytics-visitor-identity.md).
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
  let localStorageCleared = false;
  if (browserStorage !== null) {
    const shouldRemoveBaseStorageKey: BrowserStorageKeyPredicate = indexedDbError === null
      ? shouldRemoveAppLocalStorageKey
      : shouldRemoveAppLocalStorageKeyAfterIncompleteIndexedDbCleanup;
    const shouldRemoveStorageKey: BrowserStorageKeyPredicate = reason === "account_deletion_submit"
      ? (storageKey: string): boolean => (
        isAccountDeletionAttemptStorageKey(storageKey) === false
        && shouldRemoveBaseStorageKey(storageKey)
      )
      : shouldRemoveBaseStorageKey;
    localStorageCleared = clearUserScopedBrowserStorage(browserStorage, shouldRemoveStorageKey);
  }

  if (indexedDbError !== null) {
    logLocalBrowserDataCleanup(browserStorage, {
      eventName: "local_browser_data_cleanup_failed",
      reason,
      indexedDbCleared: false,
      localStorageCleared,
      // errorName carries the underlying IndexedDB error name when the failure
      // originated in the local database layer, next to the raw errorMessage.
      errorName: readCleanupErrorName(indexedDbError),
      errorMessage: indexedDbError.message,
    });
    throw indexedDbError;
  }

  if (browserStorage !== null && localStorageCleared === false) {
    // A key that survived cleanup can leak the previous account's data into the next session, so stop the flow.
    const localStorageError = new Error("Local storage cleanup could not remove every user-scoped key");
    logLocalBrowserDataCleanup(browserStorage, {
      eventName: "local_browser_data_cleanup_failed",
      reason,
      indexedDbCleared: true,
      localStorageCleared,
      errorName: localStorageError.name,
      errorMessage: localStorageError.message,
    });
    throw localStorageError;
  }

  logLocalBrowserDataCleanup(browserStorage, {
    eventName: "local_browser_data_cleanup_succeeded",
    reason,
    indexedDbCleared: true,
    localStorageCleared,
    errorName: null,
    errorMessage: null,
  });
}
