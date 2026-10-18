import { closeDatabaseAfter, getFromStore, runReadwrite } from "../core/database";

export type FirstReviewOnboardingRecord = Readonly<{
  key: string;
  completed: boolean;
  pendingGeneration: string | null;
}>;

function recordKey(userId: string): string {
  return `first_review_onboarding:${userId}`;
}

export function loadFirstReviewOnboarding(userId: string): Promise<FirstReviewOnboardingRecord | undefined> {
  return closeDatabaseAfter((database) => getFromStore<FirstReviewOnboardingRecord>(database, "meta", recordKey(userId)));
}

async function updateRecord(
  userId: string,
  update: (previous: FirstReviewOnboardingRecord | undefined) => FirstReviewOnboardingRecord | undefined,
): Promise<FirstReviewOnboardingRecord | undefined> {
  return closeDatabaseAfter(async (database) => {
    let result: FirstReviewOnboardingRecord | undefined;
    await runReadwrite(database, ["meta"], (transaction) => {
      const store = transaction.objectStore("meta");
      const request = store.get(recordKey(userId));
      request.onsuccess = (): void => {
        result = update(request.result as FirstReviewOnboardingRecord | undefined);
        if (result !== undefined) store.put(result);
      };
      return request;
    });
    return result;
  });
}

export function reconcileFirstReviewOnboarding(
  userId: string,
  remoteCompleted: boolean | null,
): Promise<FirstReviewOnboardingRecord | undefined> {
  return updateRecord(userId, (previous) => previous !== undefined && previous.pendingGeneration !== null
    ? previous
    : remoteCompleted === null ? previous
      : { key: recordKey(userId), completed: remoteCompleted, pendingGeneration: null });
}

export function initializeFirstReviewOnboarding(
  userId: string,
  cachedCompleted: boolean | null,
): Promise<FirstReviewOnboardingRecord | undefined> {
  return updateRecord(userId, (previous) => previous ?? (cachedCompleted === null ? undefined
    : { key: recordKey(userId), completed: cachedCompleted, pendingGeneration: null }));
}

export async function persistFirstReviewOnboardingTransition(
  userId: string,
  completed: boolean,
  isCurrent: () => boolean,
): Promise<Readonly<{ record: FirstReviewOnboardingRecord | undefined; changed: boolean }>> {
  let changed = false;
  const record = await updateRecord(userId, (previous) => {
    if (!isCurrent()) return previous;
    if (previous?.completed === completed) return previous;
    if (previous === undefined && !completed) return previous;
    changed = previous !== undefined;
    return { key: recordKey(userId), completed, pendingGeneration: crypto.randomUUID() };
  });
  return { record, changed };
}

export function acknowledgeFirstReviewOnboarding(
  userId: string,
  generation: string,
): Promise<FirstReviewOnboardingRecord | undefined> {
  return updateRecord(userId, (previous) => previous?.pendingGeneration === generation
    ? { ...previous, pendingGeneration: null } : previous);
}
