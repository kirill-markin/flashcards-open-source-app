import { createBrowserUuidV4 } from "../../../browserUuid";
import { createBrowserGuestSession, probeBrowserGuestSession } from "../../../api/endpoints/guestAuth";
import { ApiError } from "../../../api/transport/errors";
import type { BrowserGuestProbe } from "../../../apiContracts/guestAuth";
import { clearBrowserGuestCreatingMarker, readBrowserGuestState, subscribeToBrowserGuestChanges, writeBrowserGuestState, type BrowserGuestStoredState } from "./browserGuestStorage";
import { endGuestBrowserChallenge, waitForGuestBrowserChallengeToken } from "./guestBrowserChallenge";

// Only the noncredential attempt ID is shared with other tabs.
type BrowserGuestCreationIdentity = Readonly<{ userId: string; sessionId: string }>;
type BrowserGuestCreationAttempt = Readonly<{
  attemptId: string;
  idempotencyKey: string;
  identity: BrowserGuestCreationIdentity | null;
}>;
let pendingGuestCreation: BrowserGuestCreationAttempt | null = null;

export function reconcileBrowserGuestCreation(saved: BrowserGuestStoredState | null): void {
  if (saved?.status !== "creating" || saved.attemptId !== pendingGuestCreation?.attemptId) {
    clearPendingBrowserGuestCreation();
  }
}

if (typeof window !== "undefined") subscribeToBrowserGuestChanges(() => {
  if (pendingGuestCreation !== null) reconcileBrowserGuestCreation(readBrowserGuestState());
});

export function clearPendingBrowserGuestCreation(): void {
  pendingGuestCreation = null;
}

function requireMatchingCreationIdentity(
  expected: BrowserGuestCreationIdentity | null,
  actual: BrowserGuestCreationIdentity,
): void {
  if (expected !== null && (expected.userId !== actual.userId || expected.sessionId !== actual.sessionId)) {
    throw new Error("Browser guest cookie round-trip changed identity. Preserve local state and retry recovery.");
  }
}

async function createBrowserGuestSessionPassingCheck(attempt: BrowserGuestCreationAttempt): Promise<BrowserGuestCreationIdentity> {
  let siteKey: string | null = null;
  let turnstileToken: string | null = null;
  try {
    for (;;) {
      writeBrowserGuestState({ status: "creating", attemptId: attempt.attemptId });
      pendingGuestCreation = attempt;
      try {
        const { guestSession } = await createBrowserGuestSession(attempt.idempotencyKey, turnstileToken);
        if (guestSession.status !== "active") throw new Error("Browser guest creation did not return an active guest.");
        requireMatchingCreationIdentity(attempt.identity, guestSession);
        const identity = attempt.identity ?? { userId: guestSession.userId, sessionId: guestSession.sessionId };
        if (pendingGuestCreation === attempt) pendingGuestCreation = { ...attempt, identity };
        return identity;
      } catch (error) {
        if (error instanceof ApiError === false) throw error;
        const challengeSiteKey: string | null = error.code === "GUEST_BROWSER_CHALLENGE_REQUIRED" ? error.guestBrowserChallengeSiteKey
          : error.code === "GUEST_BROWSER_CHALLENGE_FAILED" ? siteKey : null;
        if (challengeSiteKey === null) throw error;
        siteKey = challengeSiteKey;
        // The backend refused this POST before committing it.
        clearBrowserGuestCreatingMarker();
        turnstileToken = await waitForGuestBrowserChallengeToken(challengeSiteKey, turnstileToken !== null);
      }
    }
  } finally {
    endGuestBrowserChallenge();
  }
}

type VerifyBrowserGuestCreationIdentity = (actual: BrowserGuestCreationIdentity) => void;

export function captureBrowserGuestCreationVerifier(): VerifyBrowserGuestCreationIdentity {
  const expectedIdentity = pendingGuestCreation?.identity ?? null;
  return (actual) => requireMatchingCreationIdentity(expectedIdentity, actual);
}

export async function createAndProbeBrowserGuestSession(): Promise<Readonly<{
  probe: BrowserGuestProbe;
  verifyCreationIdentity: VerifyBrowserGuestCreationIdentity;
}>> {
  const attempt = pendingGuestCreation ?? {
    attemptId: createBrowserUuidV4(),
    idempotencyKey: Array.from(crypto.getRandomValues(new Uint8Array(32)), (byte) => byte.toString(16).padStart(2, "0")).join(""),
    identity: null,
  };
  const expectedIdentity = await createBrowserGuestSessionPassingCheck(attempt);
  const probe = await probeBrowserGuestSession();
  if (probe.guestSession.status === "absent") {
    throw new Error("Browser guest cookie could not be verified after creation. Allow essential site cookies and retry.");
  }
  return { probe, verifyCreationIdentity: (actual) => requireMatchingCreationIdentity(expectedIdentity, actual) };
}
