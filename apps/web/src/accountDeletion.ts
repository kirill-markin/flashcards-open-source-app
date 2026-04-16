import { INSTALLATION_ID_STORAGE_KEY } from "./clientIdentity";
import { LOCALE_PREFERENCE_STORAGE_KEY } from "./i18n/runtime";
import { clearWebSyncCache } from "./localDb/cache";

export const deleteAccountConfirmationText: string = "delete my account";

const AUTH_RESET_REQUIRED_KEY = "flashcards-auth-reset-required";
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
];

type AccountDeletionListener = () => void;

type AuthResetCleanupResult = Readonly<{
  completed: boolean;
  error: Error | null;
}>;

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

function isBlockedIndexedDbDeleteError(error: Error): boolean {
  return error.message === "Failed to delete IndexedDB: delete request was blocked";
}

function clearUserScopedBrowserStorage(browserStorage: Storage): void {
  const storageKeysToRemove: Array<string> = [];
  for (let index = 0; index < browserStorage.length; index += 1) {
    const storageKey = browserStorage.key(index);
    if (storageKey === null) {
      continue;
    }

    if (shouldRemoveAppLocalStorageKey(storageKey)) {
      storageKeysToRemove.push(storageKey);
    }
  }

  for (const storageKey of storageKeysToRemove) {
    browserStorage.removeItem(storageKey);
  }
}

function shouldRemoveAppLocalStorageKey(storageKey: string): boolean {
  if (storageKey === AUTH_RESET_REQUIRED_KEY) {
    return false;
  }

  if (PRESERVED_BROWSER_LOCAL_STORAGE_KEYS.includes(storageKey)) {
    return false;
  }

  return storageKey.startsWith(APP_LOCAL_STORAGE_PREFIX) || APP_LOCAL_STORAGE_KEYS.includes(storageKey);
}

export function markAuthResetRequired(): void {
  getBrowserStorage()?.setItem(AUTH_RESET_REQUIRED_KEY, "1");
}

export function isAuthResetRequired(): boolean {
  return getBrowserStorage()?.getItem(AUTH_RESET_REQUIRED_KEY) === "1";
}

export function clearAuthResetRequired(): void {
  getBrowserStorage()?.removeItem(AUTH_RESET_REQUIRED_KEY);
}

/**
 * Clears browser-local user state aggressively after logout, account deletion,
 * or an unrecoverable session recovery failure.
 *
 * Once refresh-based auth recovery fails, the web client intentionally stops
 * trusting every user-bound browser artifact, including warm state, sync
 * caches, and resumable account-deletion markers. The next interactive login
 * must start from a full bootstrap instead of inheriting data that may belong
 * to a different human user on the same browser.
 *
 * The stable installation id and explicit locale preference are intentionally
 * retained because both are browser-scoped preferences rather than user-scoped
 * session state. Keeping them preserves device identity and UI language across
 * re-login while still clearing application data.
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
    clearUserScopedBrowserStorage(browserStorage);
  }

  if (indexedDbError !== null) {
    throw indexedDbError;
  }
}

export async function runPendingAuthResetCleanup(): Promise<AuthResetCleanupResult> {
  if (isAuthResetRequired() === false) {
    return {
      completed: true,
      error: null,
    };
  }

  try {
    await clearAllLocalBrowserData();
    clearAuthResetRequired();
    return {
      completed: true,
      error: null,
    };
  } catch (error) {
    const normalizedError = normalizeCleanupError(error);
    if (isBlockedIndexedDbDeleteError(normalizedError)) {
      // Future improvement: notify sibling tabs via BroadcastChannel or a
      // storage signal so they release IndexedDB handles and join the reset.
      console.warn("auth_reset_cleanup_deferred", {
        errorMessage: normalizedError.message,
      });
    } else {
      console.error("auth_reset_cleanup_failed", {
        errorMessage: normalizedError.message,
      });
    }

    return {
      completed: false,
      error: normalizedError,
    };
  }
}
