/**
 * Carries the Turnstile check the backend asks for during browser guest creation from the waiting
 * creation to the check screen, and the token back. Module state because creation runs inside the
 * session lifecycle while the screen renders in the guest gate; creation runs under the exclusive
 * browser guest lock, so at most one check waits at a time.
 */
export type GuestBrowserChallenge = Readonly<
  | { status: "awaiting_token"; siteKey: string; previousTokenRejected: boolean }
  | { status: "verifying"; siteKey: string }
>;

let currentChallenge: GuestBrowserChallenge | null = null;
let resolveWaitingToken: ((token: string) => void) | null = null;
const challengeListeners = new Set<() => void>();

function publishGuestBrowserChallenge(challenge: GuestBrowserChallenge | null): void {
  currentChallenge = challenge;
  for (const listener of challengeListeners) listener();
}

export function readGuestBrowserChallenge(): GuestBrowserChallenge | null {
  return currentChallenge;
}

export function subscribeToGuestBrowserChallenge(listener: () => void): () => void {
  challengeListeners.add(listener);
  return () => { challengeListeners.delete(listener); };
}

export function waitForGuestBrowserChallengeToken(siteKey: string, previousTokenRejected: boolean): Promise<string> {
  if (resolveWaitingToken !== null) throw new Error("A browser guest check is already waiting for a Turnstile token.");
  return new Promise((resolve) => {
    resolveWaitingToken = resolve;
    publishGuestBrowserChallenge({ status: "awaiting_token", siteKey, previousTokenRejected });
  });
}

export function submitGuestBrowserChallengeToken(token: string): void {
  const resolve = resolveWaitingToken;
  if (resolve === null || currentChallenge?.status !== "awaiting_token") {
    throw new Error("No browser guest check is waiting for a Turnstile token.");
  }
  resolveWaitingToken = null;
  publishGuestBrowserChallenge({ status: "verifying", siteKey: currentChallenge.siteKey });
  resolve(token);
}

export function endGuestBrowserChallenge(): void {
  if (currentChallenge !== null) publishGuestBrowserChallenge(null);
}
