import { INSTALLATION_ID_STORAGE_KEY } from "./clientIdentity";
import { LOCALE_PREFERENCE_STORAGE_KEY } from "./i18n/runtime";
import { clearWebSyncCache } from "./localDb/cache";
import { TEST_MODE_STORAGE_KEY } from "./testMode";

export const deleteAccountConfirmationText: string = "delete my account";

const AUTH_RESET_REQUIRED_KEY = "flashcards-auth-reset-required";
const BROWSER_REAUTH_REQUIRED_KEY = "flashcards-browser-reauth-required";
const ACCOUNT_DELETION_PENDING_KEY = "flashcards-account-deletion-pending";
const ACCOUNT_DELETION_CSRF_TOKEN_KEY = "flashcards-account-deletion-csrf-token";
const ACCOUNT_DELETION_EVENT_NAME = "flashcards-account-deletion-pending-change";
const APP_LOCAL_STORAGE_PREFIX = "flashcards-";
const APP_LOCAL_STORAGE_KEYS: ReadonlyArray<string> = [
  "selected-review-filter",
];
const PRESERVED_BROWSER_LOCAL_STORAGE_KEYS: ReadonlyArray<string> = [
  INSTALLATION_ID_STORAGE_KEY,
  LOCALE_PREFERENCE_STORAGE_KEY,
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
  return getBrowserStorage()?.getItem(ACCOUNT_DELETION_PENDING_KEY) === "1";
}

export function setAccountDeletionPending(isPending: boolean): void {
  const browserStorage = getBrowserStorage();
  if (browserStorage === null) {
    dispatchAccountDeletionChange();
    return;
  }

  if (isPending) {
    browserStorage.setItem(ACCOUNT_DELETION_PENDING_KEY, "1");
  } else {
    browserStorage.removeItem(ACCOUNT_DELETION_PENDING_KEY);
    browserStorage.removeItem(ACCOUNT_DELETION_CSRF_TOKEN_KEY);
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

export function consumeAccountDeletedMarker(): boolean {
  const url = new URL(window.location.href);
  if (url.searchParams.get("account_deleted") !== "1") {
    return false;
  }

  url.searchParams.delete("account_deleted");
  const nextUrl = `${url.pathname}${url.search}${url.hash}`;
  window.history.replaceState({}, document.title, nextUrl);
  return true;
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

function normalizeCleanupError(error: unknown): Error {
  return error instanceof Error ? error : new Error(String(error));
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

  return storageKey.startsWith(APP_LOCAL_STORAGE_PREFIX) || APP_LOCAL_STORAGE_KEYS.includes(storageKey);
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
 * The stable installation id, explicit locale preference, and hidden test-mode
 * flag are intentionally retained because they are browser-scoped preferences
 * rather than user-scoped session state. Keeping them preserves device identity,
 * UI language, and local tester tooling across re-login while still clearing
 * application data.
 */
export async function clearAllLocalBrowserData(): Promise<void> {
  const browserStorage = getBrowserStorage();
  let indexedDbError: Error | null = null;

  try {
    await clearWebSyncCache();
  } catch (error) {
    indexedDbError = normalizeCleanupError(error);
  }

  if (browserStorage !== null) {
    const shouldRemoveStorageKey = indexedDbError === null
      ? shouldRemoveAppLocalStorageKey
      : shouldRemoveAppLocalStorageKeyAfterIncompleteIndexedDbCleanup;
    clearUserScopedBrowserStorage(browserStorage, shouldRemoveStorageKey);
  }

  if (indexedDbError !== null) {
    throw indexedDbError;
  }
}
