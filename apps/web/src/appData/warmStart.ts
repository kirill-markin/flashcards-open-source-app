import type { SessionInfo, WorkspaceSummary } from "../types";

export type SessionVerificationState = "unverified" | "verified";

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
    const parsedValue = JSON.parse(rawValue) as unknown;
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
  if (hasLoggedInCookie() === false) {
    return null;
  }

  const browserStorage = getBrowserStorage();
  if (browserStorage === null) {
    return null;
  }

  return parseWarmStartSnapshot(browserStorage.getItem(WARM_START_SNAPSHOT_STORAGE_KEY));
}

export function storeWarmStartSnapshot(snapshot: WarmStartSnapshot): void {
  const browserStorage = getBrowserStorage();
  if (browserStorage === null) {
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
