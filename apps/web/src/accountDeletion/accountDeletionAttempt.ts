export const deleteAccountConfirmationText: string = "delete my account";

const ACCOUNT_DELETION_PENDING_KEY = "flashcards-account-deletion-pending";
const ACCOUNT_DELETION_CSRF_TOKEN_KEY = "flashcards-account-deletion-csrf-token";
const ACCOUNT_DELETION_SERVER_CONFIRMED_KEY = "flashcards-account-deletion-server-confirmed";
const ACCOUNT_DELETION_ATTEMPT_DISPATCHED_KEY = "flashcards-account-deletion-attempt-dispatched";
const ACCOUNT_DELETION_EVENT_NAME = "flashcards-account-deletion-pending-change";
const ACCOUNT_DELETION_LOCK_NAME = "flashcards-account-deletion";

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

export function isAccountDeletionAttemptStorageKey(storageKey: string): boolean {
  return storageKey === ACCOUNT_DELETION_PENDING_KEY
    || storageKey === ACCOUNT_DELETION_CSRF_TOKEN_KEY
    || storageKey === ACCOUNT_DELETION_SERVER_CONFIRMED_KEY
    || storageKey === ACCOUNT_DELETION_ATTEMPT_DISPATCHED_KEY;
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
