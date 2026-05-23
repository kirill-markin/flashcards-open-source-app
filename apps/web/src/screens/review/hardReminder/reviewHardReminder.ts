type ReviewRating = 0 | 1 | 2 | 3;

const reviewHardReminderStorageKey = "flashcards-review-hard-reminder-last-shown-at";
const reviewHardReminderWindowSize = 8;
const reviewHardReminderHardThreshold = 5;
const reviewHardReminderCooldownMillis = 3 * 24 * 60 * 60 * 1000;

function getBrowserStorage(): Storage | null {
  if (typeof window === "undefined") {
    return null;
  }

  const storageValue = window.localStorage;
  if (
    typeof storageValue?.getItem !== "function"
    || typeof storageValue?.setItem !== "function"
    || typeof storageValue?.removeItem !== "function"
  ) {
    return null;
  }

  return storageValue;
}

function parseStoredLastShownAt(rawValue: string): number | null {
  const timestampMillis = Number(rawValue);
  if (Number.isFinite(timestampMillis) === false) {
    return null;
  }

  return timestampMillis;
}

/**
 * Keeps the review reminder history bounded to the last eight answers in the current session.
 */
export function appendRecentReviewRatings(
  recentRatings: ReadonlyArray<ReviewRating>,
  rating: ReviewRating,
): Array<ReviewRating> {
  return [...recentRatings, rating].slice(-reviewHardReminderWindowSize);
}

/**
 * Returns true when the review window is full, Hard is frequent enough, and the cooldown has expired.
 */
export function shouldShowReviewHardReminder(
  recentRatings: ReadonlyArray<ReviewRating>,
  lastShownAt: number | null,
  nowMillis: number,
): boolean {
  if (recentRatings.length < reviewHardReminderWindowSize) {
    return false;
  }

  if (lastShownAt !== null && nowMillis - lastShownAt < reviewHardReminderCooldownMillis) {
    return false;
  }

  const hardCount = recentRatings.filter((rating) => rating === 1).length;
  return hardCount >= reviewHardReminderHardThreshold;
}

/**
 * Loads the reminder cooldown timestamp from browser storage when it is available.
 */
export function loadReviewHardReminderLastShownAt(): number | null {
  const storage = getBrowserStorage();
  if (storage === null) {
    return null;
  }

  const rawValue = storage.getItem(reviewHardReminderStorageKey);
  if (rawValue === null) {
    return null;
  }

  const parsedValue = parseStoredLastShownAt(rawValue);
  if (parsedValue === null) {
    storage.removeItem(reviewHardReminderStorageKey);
    return null;
  }

  return parsedValue;
}

/**
 * Persists the reminder cooldown timestamp when browser storage is available.
 */
export function saveReviewHardReminderLastShownAt(lastShownAt: number): void {
  const storage = getBrowserStorage();
  if (storage === null) {
    return;
  }

  storage.setItem(reviewHardReminderStorageKey, String(lastShownAt));
}
