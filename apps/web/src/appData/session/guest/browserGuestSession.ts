import { ApiError } from "../../../api/transport/errors";
import { createBrowserGuestSession, probeBrowserGuestSession } from "../../../api/endpoints/guestAuth";
import { getOptionalSession, getSession, pauseBrowserGuestSession, readBrowserGuestVerificationGeneration, recoverRegisteredCredentialForProbe, resumeVerifiedBrowserSession } from "../../../api/transport/transport";
import type { BrowserGuestProbe } from "../../../apiContracts/guestAuth";
import { closeDatabaseAfter, getAllFromStore } from "../../../localDb/core/database";
import { loadCloudSettings } from "../../../localDb/sync/cloudSettings";
import type { CloudSettings, SessionInfo } from "../../../types";
import { hasLoggedInCookie } from "../activation/warmStart";
import { readBrowserGuestState, runWithBrowserGuestLock, writeBrowserGuestState, type PendingGuestConversion } from "./browserGuestStorage";

export class GuestConversionRequiredError extends Error {
  readonly pending: PendingGuestConversion | null;
  readonly probe: BrowserGuestProbe;
  constructor(probe: BrowserGuestProbe, pending: PendingGuestConversion | null) {
    super("Finish the saved browser guest sign-in before loading the registered account.");
    this.name = "GuestConversionRequiredError";
    this.probe = probe;
    this.pending = pending;
  }
}

export { readBrowserGuestVerificationGeneration };

export function requireBrowserGuestVerificationGeneration(userId: string, generation: number): void {
  if (readBrowserGuestVerificationGeneration(userId) !== generation) {
    throw new Error("Browser guest verification changed; remote work is paused until the owner is verified again.");
  }
}

async function hasUnownedLocalData(): Promise<boolean> {
  return closeDatabaseAfter(async (database) => {
    const records = await Promise.all(["cards", "decks", "reviewEvents", "outbox"].map(
      (store) => getAllFromStore(database, store as "cards" | "decks" | "reviewEvents" | "outbox"),
    ));
    return records.some((rows) => rows.length > 0);
  });
}

function requireMatchingOwner(probe: BrowserGuestProbe, localUserId: string | null): void {
  const guest = probe.guestSession;
  const state = readBrowserGuestState();
  if (guest.status !== "active") throw new Error(`Browser guest credential is ${guest.status}. Local data has been preserved; recover the original credential.`);
  if (guest.cookieRoundTripVerified !== true || guest.csrfToken === null) throw new Error("Browser guest cookie could not be verified. Allow essential site cookies and retry.");
  if ((localUserId !== null && localUserId !== guest.userId)
    || (state?.status === "owned" && (state.owner.userId !== guest.userId || state.owner.workspaceId !== guest.workspaceId))) {
    throw new Error("Browser guest cookie does not own the saved local workspace. Local data has been preserved.");
  }
}

export async function loadCachedBrowserGuestOwner(): Promise<CloudSettings | null> {
  const settings = await loadCloudSettings();
  if (settings?.cloudState !== "guest" || settings.linkedUserId === null || settings.linkedWorkspaceId === null) return null;
  const saved = readBrowserGuestState();
  if (saved !== null && (saved.status !== "owned" || saved.owner.userId !== settings.linkedUserId
    || saved.owner.workspaceId !== settings.linkedWorkspaceId)) return null;
  return settings;
}

export async function loadBrowserProductSession(): Promise<SessionInfo> {
  if (import.meta.env.VITE_LOCAL_AUTH_MODE === "none") {
    const local = await getSession();
    if (local.authTransport !== "none") throw new Error("Local login-free configuration requires AUTH_MODE=none on the backend.");
    return local;
  }
  return runWithBrowserGuestLock("exclusive", async () => {
    const persisted = await loadCloudSettings();
    const saved = readBrowserGuestState();
    if (saved !== null || persisted?.cloudState === "guest") pauseBrowserGuestSession();
    let probe: BrowserGuestProbe;
    try {
      probe = await probeBrowserGuestSession();
    } catch (error) {
      // Only a browser that previously held registered credentials may enter registered refresh.
      if (error instanceof ApiError && error.statusCode === 401 && saved === null
        && ((persisted !== null && persisted.cloudState !== "guest") || hasLoggedInCookie())) {
        await recoverRegisteredCredentialForProbe();
        probe = await probeBrowserGuestSession();
      } else {
        throw error;
      }
    }
    const guest = probe.guestSession;
    const pending = saved?.status === "owned" ? saved.owner.pending : null;
    if (pending?.phase === "completed" && pending.result !== null && probe.registeredSession.present) {
      const destination = await getOptionalSession();
      if (destination?.userId !== pending.destinationUserId) throw new Error("The signed-in account differs from the completed conversion destination.");
      return resumeVerifiedBrowserSession(destination);
    }
    if (pending !== null || guest.status === "pending_upgrade"
      || (probe.registeredSession.present && (guest.status === "active" || persisted?.cloudState === "guest" || saved !== null))) {
      throw new GuestConversionRequiredError(probe, pending);
    }
    if (probe.registeredSession.present) return resumeVerifiedBrowserSession(await getSession());
    if (guest.status === "absent") {
      if (saved !== null || persisted !== null || hasLoggedInCookie() || await hasUnownedLocalData()) {
        if (saved === null && ((persisted !== null && persisted.cloudState !== "guest") || hasLoggedInCookie())) {
          await recoverRegisteredCredentialForProbe();
          const refreshed = await probeBrowserGuestSession();
          if (refreshed.guestSession.status === "active" || refreshed.guestSession.status === "pending_upgrade") throw new GuestConversionRequiredError(refreshed, null);
          return resumeVerifiedBrowserSession(await getSession());
        }
        throw new Error("Browser credential is missing while local ownership exists. Local data has been preserved; restore the original session.");
      }
      // This marker survives a lost response without persisting the per-attempt bearer key.
      writeBrowserGuestState({ status: "creating" });
      const key = Array.from(crypto.getRandomValues(new Uint8Array(32)), (byte) => byte.toString(16).padStart(2, "0")).join("");
      const created = await createBrowserGuestSession(key);
      probe = await probeBrowserGuestSession();
      requireMatchingOwner(probe, null);
      if (created.guestSession.status !== "active" || probe.guestSession.status !== "active"
        || created.guestSession.userId !== probe.guestSession.userId || created.guestSession.sessionId !== probe.guestSession.sessionId) {
        throw new Error("Browser guest cookie round-trip changed identity. Preserve local state and retry recovery.");
      }
    }
    requireMatchingOwner(probe, persisted?.linkedUserId ?? null);
    const activeGuest = probe.guestSession;
    if (activeGuest.status !== "active") throw new Error("Active browser guest is required");
    const session = await getOptionalSession();
    if (session === null || session.browserGuestCapabilities?.isGuest !== true || session.userId !== activeGuest.userId
      || session.selectedWorkspaceId !== activeGuest.workspaceId) {
      throw new Error("Browser guest account does not match the verified cookie workspace. Local data has been preserved.");
    }
    writeBrowserGuestState({ status: "owned", owner: {
      userId: activeGuest.userId, workspaceId: activeGuest.workspaceId,
      initialSeedAllowed: saved?.status === "owned" ? saved.owner.initialSeedAllowed : saved?.status === "creating" || guest.status === "absent",
      pending: null,
    } });
    return resumeVerifiedBrowserSession(session);
  });
}

export function allowBrowserGuestInitialSeed(userId: string): boolean {
  const state = readBrowserGuestState();
  return state?.status === "owned" && state.owner.userId === userId && state.owner.initialSeedAllowed;
}

export function markBrowserGuestHydrated(userId: string): void {
  const state = readBrowserGuestState();
  if (state?.status === "owned" && state.owner.userId === userId && state.owner.initialSeedAllowed) {
    writeBrowserGuestState({ ...state, owner: { ...state.owner, initialSeedAllowed: false } });
  }
}
