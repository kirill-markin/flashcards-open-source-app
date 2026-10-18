import { completeBrowserGuestUpgrade, forgetBrowserGuestSession, prepareBrowserGuestUpgrade, probeBrowserGuestSession } from "../../../api/endpoints/guestAuth";
import { getOptionalSession, primeGuestSession } from "../../../api/transport/transport";
import type { BrowserGuestProbe, BrowserGuestUpgradeResult, GuestUpgradeSelection } from "../../../apiContracts/guestAuth";
import { hasHydratedHotState, hasHydratedReviewHistory } from "../../../localDb/cards/workspace";
import { loadCloudSettings } from "../../../localDb/sync/cloudSettings";
import type { SessionInfo } from "../../../types";
import { browserGuestStorageKey, drainBrowserGuestInThisTab, readBrowserGuestState, readPendingGuestConversion, runWithBrowserGuestLock, writeBrowserGuestState, type PendingGuestConversion } from "./browserGuestStorage";

function savePending(pending: PendingGuestConversion): void {
  const state = readBrowserGuestState();
  if (state?.status !== "owned" || state.owner.userId !== pending.sourceUserId || state.owner.workspaceId !== pending.sourceWorkspaceId) {
    throw new Error("Saved browser guest conversion does not match the local owner.");
  }
  writeBrowserGuestState({ ...state, owner: { ...state.owner, pending } });
}

export async function beginGuestSignIn(userId: string, workspaceId: string, drainGuestWorkspace: () => Promise<void>): Promise<PendingGuestConversion> {
  await runWithBrowserGuestLock("exclusive", async () => {
    const state = readBrowserGuestState();
    if (state?.status !== "owned" || state.owner.userId !== userId || state.owner.workspaceId !== workspaceId || state.owner.pending !== null) {
      throw new Error("The active guest does not own this workspace or already has a pending sign-in.");
    }
    const probe = await probeBrowserGuestSession();
    if (probe.registeredSession.present || probe.guestSession.status !== "active" || probe.guestSession.userId !== userId || probe.guestSession.csrfToken === null) {
      throw new Error("Guest sign-in must start under the original active guest cookie.");
    }
    savePending({ phase: "draining", sourceUserId: userId, sourceWorkspaceId: workspaceId,
      guestWorkspaceSyncedAndOutboxDrained: false, destinationUserId: null, selection: null, result: null });
    primeGuestSession(userId, probe.guestSession.csrfToken);
  });
  try {
    await drainBrowserGuestInThisTab(drainGuestWorkspace);
  } catch (error) {
    await resumeGuestAfterCancelledSignIn();
    throw error;
  }
  return runWithBrowserGuestLock("exclusive", async () => {
    const pending = requirePending();
    if (pending.phase !== "draining" || pending.sourceUserId !== userId) throw new Error("Guest ownership changed while draining sign-in writes.");
    const ready: PendingGuestConversion = { ...pending, phase: "awaiting_auth", guestWorkspaceSyncedAndOutboxDrained: true };
    savePending(ready);
    return ready;
  });
}

export async function resumeGuestAfterCancelledSignIn(): Promise<void> {
  return runWithBrowserGuestLock("exclusive", async () => {
    const pending = requirePending();
    const probe = await probeBrowserGuestSession();
    const guest = probe.guestSession;
    if (probe.registeredSession.present || guest.status !== "active" || guest.userId !== pending.sourceUserId
      || guest.workspaceId !== pending.sourceWorkspaceId || (pending.phase !== "draining" && pending.phase !== "awaiting_auth")) {
      throw new Error("Cannot restore guest writes after binding or completion; continue the saved conversion instead.");
    }
    const state = readBrowserGuestState();
    if (state?.status !== "owned") throw new Error("The saved guest owner is unavailable.");
    writeBrowserGuestState({ ...state, owner: { ...state.owner, pending: null } });
  });
}

function requirePending(): PendingGuestConversion {
  const pending = readPendingGuestConversion();
  if (pending === null) throw new Error("No saved browser guest conversion is available.");
  return pending;
}

export type PendingGuestConversionProbe = Readonly<{
  probe: BrowserGuestProbe;
  pending: PendingGuestConversion | null;
}>;
export async function probePendingGuestConversion(): Promise<PendingGuestConversionProbe> {
  return { probe: await probeBrowserGuestSession(), pending: readPendingGuestConversion() };
}

export async function resumePendingGuestConversion(): Promise<Readonly<{
  mode: "bound" | "merge_required";
  session: SessionInfo;
  pending: PendingGuestConversion;
}>> {
  return runWithBrowserGuestLock("exclusive", async () => {
    const pending = requirePending();
    if (!pending.guestWorkspaceSyncedAndOutboxDrained) throw new Error("Guest writes were not drained before sign-in. Recover guest ownership before retrying.");
    const probe = await probeBrowserGuestSession();
    const guest = probe.guestSession;
    const csrf = probe.registeredSession.csrfToken;
    if (!probe.registeredSession.present || csrf === null || (guest.status !== "active" && guest.status !== "pending_upgrade") || guest.userId !== pending.sourceUserId) {
      throw new Error("Registered sign-in and the saved guest cookie are both required to resume conversion.");
    }
    // Once a destination exists, /me is safe and must reject another account before prepare can bind it.
    const savedDestinationSession = pending.destinationUserId === null ? null : await getOptionalSession();
    if (pending.destinationUserId !== null && (savedDestinationSession?.authTransport !== "session"
      || savedDestinationSession.browserGuestCapabilities !== null || savedDestinationSession.userId !== pending.destinationUserId)) {
      throw new Error("The signed-in account differs from the saved conversion destination. Restore the original destination account before retrying.");
    }
    const prepared = await prepareBrowserGuestUpgrade(csrf, pending.guestWorkspaceSyncedAndOutboxDrained);
    const next: PendingGuestConversion = { ...pending, phase: pending.phase === "completed" ? "completed" : "prepared" };
    savePending(next);
    const session = await getOptionalSession();
    if (session === null || session.authTransport !== "session" || session.browserGuestCapabilities !== null) throw new Error("Registered account could not be verified after guest preparation.");
    if (pending.destinationUserId !== null && pending.destinationUserId !== session.userId) throw new Error("The signed-in account differs from the saved conversion destination.");
    const verified = { ...next, destinationUserId: session.userId };
    savePending(verified);
    return { ...prepared, session, pending: verified };
  });
}

export async function completePendingGuestConversion(selection: GuestUpgradeSelection, destinationUserId: string): Promise<BrowserGuestUpgradeResult> {
  return runWithBrowserGuestLock("exclusive", async () => {
    const pending = requirePending();
    if (pending.destinationUserId !== destinationUserId || !pending.guestWorkspaceSyncedAndOutboxDrained
      || pending.phase === "awaiting_auth" || pending.phase === "draining") throw new Error("Prepare and verify the saved destination before completing guest conversion.");
    if (pending.selection !== null && JSON.stringify(pending.selection) !== JSON.stringify(selection)) throw new Error("The conversion selection differs from the saved destination.");
    const probe = await probeBrowserGuestSession();
    const csrf = probe.registeredSession.csrfToken;
    if (!probe.registeredSession.present || csrf === null) throw new Error("Registered browser session is required to complete guest conversion.");
    const session = await getOptionalSession();
    if (session?.userId !== destinationUserId) throw new Error("The signed-in account changed before guest conversion.");
    savePending({ ...pending, phase: "completing", selection });
    const result = await completeBrowserGuestUpgrade(csrf, selection, pending.guestWorkspaceSyncedAndOutboxDrained);
    savePending({ ...pending, phase: "completed", selection, result });
    return result;
  });
}

export async function applyFinalizedGuestConversion(hydrateDestination: (session: SessionInfo, result: BrowserGuestUpgradeResult) => Promise<void>): Promise<void> {
  const pending = requirePending();
  if (pending.phase !== "completed" || pending.result === null || pending.destinationUserId === null) throw new Error("Guest conversion has no durable completion to hydrate.");
  const session = await getOptionalSession();
  if (session?.userId !== pending.destinationUserId) throw new Error("The signed-in account does not own the completed conversion.");
  await hydrateDestination(session, pending.result);
  const settings = await loadCloudSettings();
  if (settings?.linkedUserId !== pending.destinationUserId || settings.linkedWorkspaceId !== pending.result.workspace.workspaceId
    || !await hasHydratedHotState(pending.result.workspace.workspaceId) || !await hasHydratedReviewHistory(pending.result.workspace.workspaceId)) throw new Error("Destination workspace must be durably owned and hydrated before retiring the guest cookie.");
}

export async function retireGuestCredential(): Promise<void> {
  return runWithBrowserGuestLock("exclusive", async () => {
    const pending = requirePending();
    const settings = await loadCloudSettings();
    if (pending.phase !== "completed" || pending.result === null || settings?.linkedUserId !== pending.destinationUserId
      || settings?.linkedWorkspaceId !== pending.result.workspace.workspaceId || !await hasHydratedHotState(pending.result.workspace.workspaceId) || !await hasHydratedReviewHistory(pending.result.workspace.workspaceId)) {
      throw new Error("Keep the guest cookie until the finalized destination is durably hydrated.");
    }
    const probe = await probeBrowserGuestSession();
    const session = await getOptionalSession();
    if (session?.userId !== pending.destinationUserId) throw new Error("The signed-in account changed before credential retirement.");
    await forgetBrowserGuestSession(probe.guestSession.csrfToken ?? probe.registeredSession.csrfToken);
    window.localStorage.removeItem(browserGuestStorageKey);
    window.dispatchEvent(new Event(browserGuestStorageKey));
  });
}
