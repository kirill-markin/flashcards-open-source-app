const lastShownAtKeyPrefix = "guest-sign-in-after-review-last-shown-at:";

export function loadGuestSignInAfterReviewLastShownAt(userId: string): number | null {
  const rawValue = window.localStorage.getItem(`${lastShownAtKeyPrefix}${userId}`);
  if (rawValue === null) {
    return null;
  }

  const lastShownAtMillis = Number(rawValue);
  if (Number.isFinite(lastShownAtMillis) === false) {
    throw new Error("Saved guest sign-in reminder time is invalid.");
  }

  return lastShownAtMillis;
}

export function saveGuestSignInAfterReviewLastShownAt(userId: string, lastShownAtMillis: number): void {
  window.localStorage.setItem(`${lastShownAtKeyPrefix}${userId}`, String(lastShownAtMillis));
}

export function clearAllGuestSignInAfterReviewLastShownAt(): void {
  for (const key of Object.keys(window.localStorage)) {
    if (key.startsWith(lastShownAtKeyPrefix)) {
      window.localStorage.removeItem(key);
    }
  }
}
