import { probeBrowserGuestSession } from "../../../api/endpoints/guestAuth";
import {
  BrowserGuestSessionInvalidatedError, getSession, isBrowserGuestSessionVerified, loadVerifiedBrowserGuestSession,
  loadVerifiedRegisteredBrowserSession, pauseBrowserGuestSession, readBrowserGuestVerificationGeneration,
  recoverRegisteredCredentialForProbe, resumeVerifiedBrowserSession,
} from "../../../api/transport/transport";
import type { BrowserGuestProbe } from "../../../apiContracts/guestAuth";
import { closeDatabaseAfter, getAllFromStore } from "../../../localDb/core/database";
import { loadCloudSettings } from "../../../localDb/sync/cloudSettings";
import { isCatalogImportPath } from "../../../routes";
import type { CloudSettings, SessionInfo } from "../../../types";
import { hasLoggedInCookie } from "../activation/warmStart";
import { probeBrowserGuestSessionWithRegisteredRecovery } from "./browserGuestProbe";
import { readBrowserGuestOwnershipGeneration, readBrowserGuestState, readPendingGuestConversion, runWithBrowserGuestLock, writeBrowserGuestState, type PendingGuestConversion } from "./browserGuestStorage";
import { captureBrowserGuestCreationVerifier, clearPendingBrowserGuestCreation, createAndProbeBrowserGuestSession, reconcileBrowserGuestCreation } from "./browserGuestCreation";

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

export function requireBrowserGuestVerificationGeneration(userId: string, generation: number | null): void {
  if (generation === null || readBrowserGuestVerificationGeneration(userId) !== generation) {
    throw new BrowserGuestSessionInvalidatedError("Browser guest verification changed; remote work is paused until the owner is verified again.");
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
    reconcileBrowserGuestCreation(saved);
    if (persisted !== null) clearPendingBrowserGuestCreation();
    const hasSavedGuestState = saved !== null || persisted?.cloudState === "guest";
    const canRevalidateCurrentOwner = saved?.status === "owned" && saved.owner.pending === null
      && persisted?.cloudState === "guest" && persisted.linkedUserId === saved.owner.userId
      && persisted.linkedWorkspaceId === saved.owner.workspaceId
      && isBrowserGuestSessionVerified(saved.owner.userId, saved.owner.workspaceId);
    if (hasSavedGuestState && canRevalidateCurrentOwner === false) pauseBrowserGuestSession();
    try {
      let probe = await probeBrowserGuestSessionWithRegisteredRecovery();
      const guest = probe.guestSession;
      const pending = saved?.status === "owned" ? saved.owner.pending : null;
      if (hasSavedGuestState && (probe.registeredSession.present || guest.status !== "active" || pending !== null)) {
        pauseBrowserGuestSession();
      }
      if (pending?.phase === "completed" && pending.result !== null && probe.registeredSession.present) {
        const destination = await loadVerifiedRegisteredBrowserSession();
        if (destination.userId !== pending.destinationUserId) throw new Error("The signed-in account differs from the completed conversion destination.");
        return resumeVerifiedBrowserSession(destination);
      }
      if (pending !== null || guest.status === "pending_upgrade"
        || (probe.registeredSession.present && (guest.status === "active" || hasSavedGuestState))) {
        throw new GuestConversionRequiredError(probe, pending);
      }
      if (probe.registeredSession.present) return resumeVerifiedBrowserSession(await loadVerifiedRegisteredBrowserSession());
      let verifyCreationIdentity = captureBrowserGuestCreationVerifier();
      if (guest.status === "absent") {
        if (saved?.status === "owned" || persisted !== null || hasLoggedInCookie() || await hasUnownedLocalData()) {
          clearPendingBrowserGuestCreation();
          if (saved === null && ((persisted !== null && persisted.cloudState !== "guest") || hasLoggedInCookie())) {
            await recoverRegisteredCredentialForProbe();
            const refreshed = await probeBrowserGuestSession();
            if (refreshed.guestSession.status === "active" || refreshed.guestSession.status === "pending_upgrade") {
              throw new GuestConversionRequiredError(refreshed, null);
            }
            // Registered /me can provision the account before a later guest conversion can bind it.
            if (hasSavedGuestState === false) {
              if (!refreshed.registeredSession.present) {
                throw new Error("The registered browser session is missing after refresh. Sign in again to continue.");
              }
              return resumeVerifiedBrowserSession(await loadVerifiedRegisteredBrowserSession());
            }
          }
          throw new Error("Browser credential is missing while local ownership exists. Local data has been preserved; restore the original session.");
        }
        ({ probe, verifyCreationIdentity } = await createAndProbeBrowserGuestSession());
      }
      requireMatchingOwner(probe, persisted?.linkedUserId ?? null);
      const activeGuest = probe.guestSession;
      if (activeGuest.status !== "active") throw new Error("Active browser guest is required");
      verifyCreationIdentity(activeGuest);
      const session = await loadVerifiedBrowserGuestSession(activeGuest.userId, activeGuest.workspaceId);
      writeBrowserGuestState({ status: "owned", owner: {
        userId: activeGuest.userId, workspaceId: activeGuest.workspaceId,
        initialSeedAllowed: !isCatalogImportPath(window.location.pathname)
          && (saved?.status === "owned" ? saved.owner.initialSeedAllowed : saved?.status === "creating" || guest.status === "absent"),
        pending: null,
      } });
      clearPendingBrowserGuestCreation();
      return resumeVerifiedBrowserSession(session);
    } catch (error) {
      if (hasSavedGuestState || readBrowserGuestState() !== null) pauseBrowserGuestSession();
      throw error;
    }
  });
}

export async function restoreBrowserGuestSessionAfterCleanup(
  expectedSession: SessionInfo,
  verificationGeneration: number | null,
  clearLocalState: () => Promise<void>,
): Promise<SessionInfo> {
  requireBrowserGuestVerificationGeneration(expectedSession.userId, verificationGeneration);
  const saved = readBrowserGuestState();
  if (expectedSession.browserGuestCapabilities?.isGuest !== true || saved?.status !== "owned"
    || saved.owner.userId !== expectedSession.userId || saved.owner.workspaceId !== expectedSession.selectedWorkspaceId
    || saved.owner.pending !== null) {
    throw new Error("Browser guest ownership changed or sign-in is pending. Local data has been preserved.");
  }
  const ownershipGeneration = readBrowserGuestOwnershipGeneration();
  const requireUnchangedOwner = (): void => {
    const current = readBrowserGuestState();
    if (readBrowserGuestOwnershipGeneration() !== ownershipGeneration || current?.status !== "owned"
      || current.owner.userId !== saved.owner.userId || current.owner.workspaceId !== saved.owner.workspaceId
      || current.owner.pending !== null || current.owner.initialSeedAllowed !== saved.owner.initialSeedAllowed) {
      throw new Error("Browser guest ownership changed before cleanup. Local data has been preserved.");
    }
  };

  // Pause before queuing the lock so cleanup cannot wait on a local mutation queued behind it.
  pauseBrowserGuestSession();
  try {
    return await runWithBrowserGuestLock("exclusive", async () => {
      requireUnchangedOwner();
      const probe = await probeBrowserGuestSessionWithRegisteredRecovery();
      if (probe.registeredSession.present || probe.guestSession.status === "pending_upgrade") {
        throw new GuestConversionRequiredError(probe, readPendingGuestConversion());
      }
      requireMatchingOwner(probe, expectedSession.userId);
      requireUnchangedOwner();
      await clearLocalState();
      const cleanedGeneration = readBrowserGuestOwnershipGeneration();
      if (readBrowserGuestState() !== null) throw new Error("Browser guest ownership changed during cleanup. Preserve local data before recovery.");
      const restoredProbe = await probeBrowserGuestSessionWithRegisteredRecovery();
      if (restoredProbe.registeredSession.present || restoredProbe.guestSession.status === "pending_upgrade") {
        throw new GuestConversionRequiredError(restoredProbe, null);
      }
      requireMatchingOwner(restoredProbe, expectedSession.userId);
      const guest = restoredProbe.guestSession;
      if (guest.status !== "active" || guest.workspaceId !== saved.owner.workspaceId) {
        throw new Error("Browser guest cookie changed workspace during cleanup. Restore the original session before syncing.");
      }
      const restoredSession = await loadVerifiedBrowserGuestSession(saved.owner.userId, saved.owner.workspaceId);
      if (readBrowserGuestState() !== null || readBrowserGuestOwnershipGeneration() !== cleanedGeneration) {
        throw new Error("Browser guest ownership changed during cleanup recovery. Preserve local data before retrying.");
      }
      writeBrowserGuestState(saved);
      return resumeVerifiedBrowserSession(restoredSession);
    });
  } catch (error) {
    pauseBrowserGuestSession();
    throw error;
  }
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
