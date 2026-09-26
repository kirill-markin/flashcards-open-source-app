import { defaultAccentColor } from "../../../types/account";
import { isBrowserReauthRequired } from "../../../accountDeletion";
import type { SessionInfo, WorkspaceSummary } from "../../../types";
import {
  didEntryAddressOverrideAccountDefault,
  findEntryWorkspace,
  readEntryWorkspaceId,
} from "./workspaceActivationHelpers";

export type { SessionVerificationState } from "../workspaceSessionTypes";

export type WarmStartSnapshot = Readonly<{
  version: 1;
  session: SessionInfo;
  activeWorkspace: WorkspaceSummary;
  availableWorkspaces: ReadonlyArray<WorkspaceSummary>;
  savedAt: string;
}>;

export const WARM_START_SNAPSHOT_STORAGE_KEY = "flashcards-warm-start-snapshot";

const WARM_START_SNAPSHOT_VERSION = 1;

type JsonRecord = Record<string, unknown>;

function isRecord(value: unknown): value is JsonRecord {
  return typeof value === "object" && value !== null && Array.isArray(value) === false;
}

function isWorkspaceSummary(value: unknown): value is WorkspaceSummary {
  return isRecord(value)
    && typeof value.workspaceId === "string"
    && value.workspaceId !== ""
    && typeof value.name === "string"
    && typeof value.createdAt === "string"
    && typeof value.isSelected === "boolean";
}

function isSessionInfo(value: unknown): value is SessionInfo {
  return isRecord(value)
    && typeof value.userId === "string"
    && value.userId !== ""
    && (typeof value.selectedWorkspaceId === "string" || value.selectedWorkspaceId === null)
    && typeof value.authTransport === "string"
    && (typeof value.csrfToken === "string" || value.csrfToken === null)
    && isRecord(value.preferences)
    && typeof value.preferences.accentColor === "string"
    && value.preferences.accentColor.length === 7
    && /^#[0-9A-F]{6}$/.test(value.preferences.accentColor)
    && typeof value.preferences.reviewReactionAnimationsEnabled === "boolean"
    && (value.preferences.analyticsConsent === null
      || value.preferences.analyticsConsent === "granted"
      || value.preferences.analyticsConsent === "declined")
    && (value.preferences.productAnalyticsEnabled === null
      || typeof value.preferences.productAnalyticsEnabled === "boolean")
    && isRecord(value.profile)
    && (typeof value.profile.email === "string" || value.profile.email === null)
    && typeof value.profile.locale === "string"
    && typeof value.profile.createdAt === "string";
}

function parseWarmStartSnapshot(rawValue: string | null): WarmStartSnapshot | null {
  if (rawValue === null) {
    return null;
  }

  try {
    const storedValue = JSON.parse(rawValue) as unknown;
    // Only an absent local field is migrated; wire responses stay strict.
    const parsedValue = isRecord(storedValue)
      && isRecord(storedValue.session)
      && isRecord(storedValue.session.preferences)
      && !("accentColor" in storedValue.session.preferences)
      ? {
        ...storedValue,
        session: {
          ...storedValue.session,
          preferences: { ...storedValue.session.preferences, accentColor: defaultAccentColor },
        },
      }
      : storedValue;
    if (
      isRecord(parsedValue) === false
      || parsedValue.version !== WARM_START_SNAPSHOT_VERSION
      || isSessionInfo(parsedValue.session) === false
      || isWorkspaceSummary(parsedValue.activeWorkspace) === false
      || Array.isArray(parsedValue.availableWorkspaces) === false
      || typeof parsedValue.savedAt !== "string"
    ) {
      return null;
    }

    const availableWorkspaces = parsedValue.availableWorkspaces.filter(isWorkspaceSummary);
    if (availableWorkspaces.length !== parsedValue.availableWorkspaces.length) {
      return null;
    }

    const activeWorkspace = parsedValue.activeWorkspace;
    if (availableWorkspaces.some((workspace) => workspace.workspaceId === activeWorkspace.workspaceId) === false) {
      return null;
    }

    return {
      version: 1,
      session: parsedValue.session,
      activeWorkspace,
      availableWorkspaces,
      savedAt: parsedValue.savedAt,
    };
  } catch {
    return null;
  }
}

/**
 * The entry address decides which workspace this document shows, so a snapshot that was written in a
 * different one is repointed at the workspace the address names, and dropped when it does not carry
 * that workspace at all. Painting the previously active workspace under an address naming another
 * one would put one workspace's cards on screen under the other's address; dropping the snapshot
 * costs the warm first paint and falls back to the cold path, where the server's own list decides.
 *
 * Asked of the same captured entry value activation resolves from, never of a second source, so the
 * snapshot and the first activation cannot disagree about which workspace was asked for.
 *
 * `isSelected` is left as the snapshot recorded it: what following a link deliberately does not move
 * is the account's server-side selection, and the client-side copy follows whatever gets activated
 * because `publishSelectedWorkspace` re-marks it (`useWorkspaceActivation.ts`).
 */
function alignSnapshotWithEntryWorkspace(snapshot: WarmStartSnapshot): WarmStartSnapshot | null {
  const entryWorkspaceId = readEntryWorkspaceId();
  if (entryWorkspaceId === null || snapshot.activeWorkspace.workspaceId.toLowerCase() === entryWorkspaceId) {
    return snapshot;
  }

  const entryWorkspace = findEntryWorkspace(snapshot.availableWorkspaces);
  if (entryWorkspace === null) {
    return null;
  }

  return { ...snapshot, activeWorkspace: entryWorkspace };
}

function getBrowserStorage(): Storage | null {
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

function readCookie(cookieName: string): string | null {
  const cookieEntries = document.cookie.split(";");
  for (const cookieEntry of cookieEntries) {
    const trimmedCookieEntry = cookieEntry.trim();
    if (trimmedCookieEntry === "") {
      continue;
    }

    const separatorIndex = trimmedCookieEntry.indexOf("=");
    if (separatorIndex === -1) {
      continue;
    }

    const currentCookieName = trimmedCookieEntry.slice(0, separatorIndex);
    if (currentCookieName !== cookieName) {
      continue;
    }

    return trimmedCookieEntry.slice(separatorIndex + 1);
  }

  return null;
}

export function hasLoggedInCookie(): boolean {
  return readCookie("logged_in") === "1";
}

/**
 * Warm start intentionally prefers immediate first paint over strict privacy.
 * The persisted snapshot is advisory only and may be discarded once the
 * browser session is revalidated in the background.
 */
export function loadWarmStartSnapshot(): WarmStartSnapshot | null {
  if (isBrowserReauthRequired()) {
    return null;
  }

  if (hasLoggedInCookie() === false) {
    return null;
  }

  const browserStorage = getBrowserStorage();
  if (browserStorage === null) {
    return null;
  }

  const snapshot = parseWarmStartSnapshot(browserStorage.getItem(WARM_START_SNAPSHOT_STORAGE_KEY));
  return snapshot === null ? null : alignSnapshotWithEntryWorkspace(snapshot);
}

/** Entry links must preserve the cached account-default workspace, but account preferences are shared. */
export function storeWarmStartSnapshot(snapshot: WarmStartSnapshot): void {
  const browserStorage = getBrowserStorage();
  if (browserStorage === null) {
    return;
  }

  if (didEntryAddressOverrideAccountDefault()) {
    const storedSnapshot = parseWarmStartSnapshot(browserStorage.getItem(WARM_START_SNAPSHOT_STORAGE_KEY));
    if (storedSnapshot !== null && storedSnapshot.session.userId === snapshot.session.userId) {
      browserStorage.setItem(WARM_START_SNAPSHOT_STORAGE_KEY, JSON.stringify({
        ...storedSnapshot,
        session: { ...storedSnapshot.session, preferences: snapshot.session.preferences },
      }));
    }
    return;
  }

  browserStorage.setItem(WARM_START_SNAPSHOT_STORAGE_KEY, JSON.stringify(snapshot));
}

export function clearWarmStartSnapshot(): void {
  const browserStorage = getBrowserStorage();
  if (browserStorage === null) {
    return;
  }

  browserStorage.removeItem(WARM_START_SNAPSHOT_STORAGE_KEY);
}
