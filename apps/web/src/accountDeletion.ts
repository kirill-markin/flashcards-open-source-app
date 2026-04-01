import { clearWebSyncCache } from "./localDb/cache";
import { INSTALLATION_ID_STORAGE_KEY, LEGACY_DEVICE_ID_STORAGE_KEY } from "./clientIdentity";
import { WARM_START_SNAPSHOT_STORAGE_KEY } from "./appData/warmStart";

export const deleteAccountConfirmationText: string = "delete my account";

const ACCOUNT_DELETION_PENDING_KEY = "flashcards-account-deletion-pending";
const ACCOUNT_DELETION_CSRF_TOKEN_KEY = "flashcards-account-deletion-csrf-token";
const ACCOUNT_DELETION_EVENT_NAME = "flashcards-account-deletion-pending-change";
const APP_LOCAL_STORAGE_KEYS: ReadonlyArray<string> = [
  "flashcards-account-deletion-pending",
  "flashcards-account-deletion-csrf-token",
  LEGACY_DEVICE_ID_STORAGE_KEY,
  INSTALLATION_ID_STORAGE_KEY,
  "flashcards-sync-device-ids",
  "selected-review-filter",
  "flashcards-chat-messages",
  "flashcards-chat-session-snapshot",
  "flashcards-chat-open",
  "flashcards-chat-width",
  "flashcards-chat-model",
  WARM_START_SNAPSHOT_STORAGE_KEY,
];

type AccountDeletionListener = () => void;

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

/**
 * Clears every browser-local app artifact so the next session always starts
 * from a full sync bootstrap instead of inheriting another user's state.
 */
export async function clearAllLocalBrowserData(): Promise<void> {
  await clearWebSyncCache();

  const browserStorage = getBrowserStorage();
  if (browserStorage === null) {
    return;
  }

  for (const storageKey of APP_LOCAL_STORAGE_KEYS) {
    browserStorage.removeItem(storageKey);
  }
}
