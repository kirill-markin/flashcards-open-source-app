// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  beginAccountDeletionRetryAttempt,
  hasAccountDeletionAttemptDispatched,
  isAccountDeletionPending,
  isAccountDeletionServerConfirmed,
  loadAccountDeletionAttemptId,
  loadAccountDeletionCsrfToken,
  markAccountDeletionAttemptDispatched,
  markAccountDeletionServerConfirmed,
  runWithAccountDeletionLock,
  setAccountDeletionPending,
  storeAccountDeletionCsrfToken,
} from "./accountDeletionAttempt";

function installSerialAccountDeletionLockMock(): void {
  let previousRequest: Promise<void> = Promise.resolve();
  Object.defineProperty(window.navigator, "locks", {
    configurable: true,
    value: {
      request<Result>(
        _name: string,
        _options: Readonly<{ signal: AbortSignal }>,
        action: () => Promise<Result>,
      ): Promise<Result> {
        const result = previousRequest.then(action);
        previousRequest = result.then(
          (): void => undefined,
          (): void => undefined,
        );
        return result;
      },
    },
  });
}

function createStorageMock(): Storage {
  const state = new Map<string, string>();

  return {
    get length(): number {
      return state.size;
    },
    clear(): void {
      state.clear();
    },
    getItem(key: string): string | null {
      return state.get(key) ?? null;
    },
    key(index: number): string | null {
      return [...state.keys()][index] ?? null;
    },
    removeItem(key: string): void {
      state.delete(key);
    },
    setItem(key: string, value: string): void {
      state.set(key, value);
    },
  };
}

beforeEach(() => {
  Object.defineProperty(window, "localStorage", {
    configurable: true,
    value: createStorageMock(),
  });
  window.localStorage.clear();
});

afterEach(() => {
  window.localStorage.clear();
  Reflect.deleteProperty(window.navigator, "locks");
  vi.restoreAllMocks();
});

describe("account deletion attempt lifecycle", () => {
  it("does not infer server confirmation from a new pending deletion", () => {
    markAccountDeletionServerConfirmed();
    storeAccountDeletionCsrfToken("csrf-token");

    setAccountDeletionPending(true);

    expect(isAccountDeletionPending()).toBe(true);
    expect(loadAccountDeletionCsrfToken()).toBe("csrf-token");
    expect(isAccountDeletionServerConfirmed()).toBe(false);
  });

  it("resets and clears the dispatch claim with pending attempt lifecycle", () => {
    setAccountDeletionPending(true);
    const firstAttemptId = loadAccountDeletionAttemptId();
    markAccountDeletionAttemptDispatched();

    expect(firstAttemptId).not.toBeNull();
    expect(hasAccountDeletionAttemptDispatched()).toBe(true);

    setAccountDeletionPending(true);

    expect(loadAccountDeletionAttemptId()).not.toBe(firstAttemptId);
    expect(hasAccountDeletionAttemptDispatched()).toBe(false);

    markAccountDeletionAttemptDispatched();
    setAccountDeletionPending(false);

    expect(loadAccountDeletionAttemptId()).toBeNull();
    expect(hasAccountDeletionAttemptDispatched()).toBe(false);
  });

  it("keeps server confirmation when the following recovery checkpoint throws", () => {
    setAccountDeletionPending(true);
    const recoveryError = new Error("IndexedDB recovery required");

    expect(() => {
      markAccountDeletionServerConfirmed();
      throw recoveryError;
    }).toThrow(recoveryError);

    expect(isAccountDeletionPending()).toBe(true);
    expect(isAccountDeletionServerConfirmed()).toBe(true);
  });

  it("prevents automatic waiters from dispatching after an ordinary owner failure", async () => {
    installSerialAccountDeletionLockMock();
    setAccountDeletionPending(true);
    let deleteRequestCount = 0;
    const recoveryController = new AbortController();
    const ordinaryDeleteError = new Error("Account deletion request failed");

    const completePendingDeletion = (): Promise<void> => runWithAccountDeletionLock(
      recoveryController.signal,
      async (): Promise<void> => {
        if (
          isAccountDeletionPending() === false
          || isAccountDeletionServerConfirmed()
          || hasAccountDeletionAttemptDispatched()
        ) {
          return;
        }

        markAccountDeletionAttemptDispatched();
        deleteRequestCount += 1;
        throw ordinaryDeleteError;
      },
    );

    const results = await Promise.allSettled([
      completePendingDeletion(),
      completePendingDeletion(),
      completePendingDeletion(),
    ]);

    expect(deleteRequestCount).toBe(1);
    expect(results[0]).toEqual({ status: "rejected", reason: ordinaryDeleteError });
    expect(results[1]).toEqual({ status: "fulfilled", value: undefined });
    expect(results[2]).toEqual({ status: "fulfilled", value: undefined });
    expect(isAccountDeletionPending()).toBe(true);
    expect(isAccountDeletionServerConfirmed()).toBe(false);
    expect(hasAccountDeletionAttemptDispatched()).toBe(true);
  });

  it("collapses simultaneous explicit retries into one new dispatched attempt", async () => {
    installSerialAccountDeletionLockMock();
    setAccountDeletionPending(true);
    markAccountDeletionAttemptDispatched();
    let deleteRequestCount = 0;
    const recoveryController = new AbortController();

    const completePendingDeletion = (): Promise<void> => runWithAccountDeletionLock(
      recoveryController.signal,
      async (): Promise<void> => {
        if (
          isAccountDeletionPending() === false
          || isAccountDeletionServerConfirmed()
          || hasAccountDeletionAttemptDispatched()
        ) {
          return;
        }

        markAccountDeletionAttemptDispatched();
        deleteRequestCount += 1;
        markAccountDeletionServerConfirmed();
      },
    );
    const retryPendingDeletion = async (): Promise<void> => {
      const expectedAttemptId = loadAccountDeletionAttemptId();
      if (expectedAttemptId === null) {
        return;
      }

      const didBeginRetryAttempt = await runWithAccountDeletionLock(
        recoveryController.signal,
        async (): Promise<boolean> => beginAccountDeletionRetryAttempt(expectedAttemptId),
      );
      if (didBeginRetryAttempt) {
        await completePendingDeletion();
      }
    };

    await Promise.all([retryPendingDeletion(), retryPendingDeletion()]);

    expect(deleteRequestCount).toBe(1);
    expect(isAccountDeletionPending()).toBe(true);
    expect(isAccountDeletionServerConfirmed()).toBe(true);
    expect(hasAccountDeletionAttemptDispatched()).toBe(true);
  });
});
