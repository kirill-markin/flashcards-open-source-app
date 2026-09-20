/**
 * Analytics identity. `anonymous_id` is the shared `analytics_visitor` cookie the backend mints for
 * the whole product domain (docs/analytics-visitor-identity.md), so `app.` and `auth.` measure one
 * person under one id, from the first page view rather than from the first interaction.
 *
 * Sessions are deliberately not in that cookie: every client rotates its own under the shared
 * 30-minute rule, which is what this module still owns locally.
 */
import { getAppConfig } from "../config";

const visitorCookieName = "analytics_visitor";
/**
 * The `anonymous_id` earlier builds of this app kept in `localStorage`. It is adopted into the
 * shared cookie once and then dropped, so the history already collected under it stays connected to
 * this browser.
 */
const legacyAnonymousIdStorageKey = "flashcards-analytics-anonymous-id";
const sessionStorageKey = "flashcards-analytics-session";
export const analyticsEnabledStorageKey = "flashcards-analytics-enabled";

/** 13 months, the lifetime the backend writes the shared cookie with. */
const visitorCookieMaxAgeSeconds = 395 * 24 * 60 * 60;

/** Shared with iOS and Android: a new session after 30 minutes with no emitted analytics event. */
const sessionInactivityTimeoutMs = 30 * 60 * 1000;

// `track` runs on click handlers, so the session heartbeat is persisted at most this often rather
// than on every event: a synchronous storage write does not belong on the interaction path, and the
// only thing this write protects is session continuity across a reload, against a 30-minute timeout.
const sessionPersistIntervalMs = 60 * 1000;

type AnalyticsSessionState = Readonly<{
  sessionId: string;
  lastEventAtMs: number;
}>;

// Browser storage throws in a few real configurations (Safari private browsing, storage disabled by
// policy). Analytics must never surface that to the user, so the ids live in memory when the store
// is unusable and the batch still ships with a consistent pair.
let inMemoryAnonymousId: string | null = null;
let inMemorySessionState: AnalyticsSessionState | null = null;
let sessionPersistedAtMs = 0;

function readBrowserStorageItem(storageKey: string): string | null {
  try {
    return window.localStorage.getItem(storageKey);
  } catch {
    return null;
  }
}

function writeBrowserStorageItem(storageKey: string, value: string): void {
  try {
    window.localStorage.setItem(storageKey, value);
  } catch {
    // The in-memory copy carries this browsing context; nothing else can be done.
  }
}

function removeBrowserStorageItem(storageKey: string): void {
  try {
    window.localStorage.removeItem(storageKey);
  } catch {
    // Nothing to do: the in-memory copy has already been cleared by the caller.
  }
}

function toHexByte(value: number): string {
  return value.toString(16).padStart(2, "0");
}

/**
 * UUID version 7. `crypto.randomUUID()` produces version 4, which the ingest endpoint rejects as a
 * generic `invalid_event`, so event ids are generated explicitly here.
 */
export function createAnalyticsUuidV7(): string {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);

  const timestampMs = Date.now();
  bytes[0] = Math.floor(timestampMs / 2 ** 40) & 0xff;
  bytes[1] = Math.floor(timestampMs / 2 ** 32) & 0xff;
  bytes[2] = Math.floor(timestampMs / 2 ** 24) & 0xff;
  bytes[3] = Math.floor(timestampMs / 2 ** 16) & 0xff;
  bytes[4] = Math.floor(timestampMs / 2 ** 8) & 0xff;
  bytes[5] = timestampMs & 0xff;
  bytes[6] = (bytes[6] & 0x0f) | 0x70;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;

  const hex = Array.from(bytes, toHexByte).join("");
  return [
    hex.slice(0, 8),
    hex.slice(8, 12),
    hex.slice(12, 16),
    hex.slice(16, 20),
    hex.slice(20, 32),
  ].join("-");
}

function isAnalyticsUuid(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/u.test(value);
}

function readBrowserCookie(cookieName: string): string | null {
  for (const cookieEntry of document.cookie.split(";")) {
    const separatorIndex = cookieEntry.indexOf("=");
    if (separatorIndex === -1) {
      continue;
    }

    if (cookieEntry.slice(0, separatorIndex).trim() !== cookieName) {
      continue;
    }

    return cookieEntry.slice(separatorIndex + 1).trim();
  }

  return null;
}

/**
 * This browser's shared visitor id, or null when it holds none: the backend withheld one because
 * consent is required here, or the browser kept no cookie at all.
 */
export function readAnalyticsVisitorId(): string | null {
  const cookieValue = readBrowserCookie(visitorCookieName);
  if (cookieValue === null) {
    return null;
  }

  const visitorId = cookieValue.toLowerCase();
  return isAnalyticsUuid(visitorId) ? visitorId : null;
}

/**
 * The id every reported event is attributed to: the shared visitor cookie, and where the browser
 * kept none, a per-tab id held in memory.
 *
 * The mint answer's own `visitorId` is deliberately never adopted here. It is returned whether or
 * not the browser accepted the `Set-Cookie`, so a browser that blocks cookies would otherwise be
 * counted as one new visitor on every page load (docs/analytics-visitor-identity.md).
 *
 * The cookie is scoped to the current product base domain, so the planned move to `nibomo.com`
 * resets every visitor id on that day. That is knowingly accepted: no anonymous identity is carried
 * across the domain move.
 */
export function readAnalyticsAnonymousId(): string {
  const visitorId = readAnalyticsVisitorId();
  if (visitorId !== null) {
    return visitorId;
  }

  const nextAnonymousId = inMemoryAnonymousId ?? crypto.randomUUID().toLowerCase();
  inMemoryAnonymousId = nextAnonymousId;
  return nextAnonymousId;
}

/**
 * The product base domain the shared cookie is published on, which is the API host's parent and the
 * `COOKIE_DOMAIN` the backend writes it with. Null where the API host has no parent domain — the
 * local development stack — and nothing is written there.
 */
function readSharedVisitorCookieDomain(): string | null {
  const apiHostname = new URL(getAppConfig().apiBaseUrl).hostname;
  const separatorIndex = apiHostname.indexOf(".");
  const baseDomain = separatorIndex === -1 ? "" : apiHostname.slice(separatorIndex + 1);
  return baseDomain.includes(".") ? baseDomain : null;
}

/** Retires the stored key, for a browser whose shared identity has replaced what it described. */
export function dropLegacyAnalyticsAnonymousId(): void {
  removeBrowserStorageItem(legacyAnonymousIdStorageKey);
}

/**
 * Moves the `anonymous_id` earlier builds kept in `localStorage` into the shared cookie, once, so
 * the history already collected under it stays connected to this browser.
 *
 * The write is the browser's own because the endpoint mints an id and has no parameter for adopting
 * one. Call it only on the load that has just obtained the identity from that endpoint, so what may
 * hold an identity at all stays decided on the server, and so an id this browser has already
 * reported under is never overwritten. The attributes below are the ones the route mints with, and
 * for a web-only visitor they are final: this app asks the route again only when it finds no
 * readable cookie, so nothing re-stamps them (docs/analytics-visitor-identity.md). A browser that
 * does not keep the write loses the history: it keeps the stored key only until the next load, which
 * finds the minted cookie already there and drops the key unadopted. That is deliberate rather than
 * a gap to retry — by then this browser has been reporting under the minted id, and overwriting it
 * later would split one browser across two ids instead of joining them.
 */
export function adoptLegacyAnalyticsAnonymousId(): void {
  const storedValue = readBrowserStorageItem(legacyAnonymousIdStorageKey);
  if (storedValue === null) {
    return;
  }

  const legacyAnonymousId = storedValue.trim().toLowerCase();
  if (isAnalyticsUuid(legacyAnonymousId) === false) {
    removeBrowserStorageItem(legacyAnonymousIdStorageKey);
    return;
  }

  const cookieDomain = readSharedVisitorCookieDomain();
  if (cookieDomain === null) {
    return;
  }

  document.cookie = `${visitorCookieName}=${legacyAnonymousId}; Domain=${cookieDomain}; Path=/; Max-Age=${visitorCookieMaxAgeSeconds}; Secure; SameSite=Lax`;
  if (readAnalyticsVisitorId() === legacyAnonymousId) {
    removeBrowserStorageItem(legacyAnonymousIdStorageKey);
  }
}

function readStoredSessionState(): AnalyticsSessionState | null {
  const storedValue = readBrowserStorageItem(sessionStorageKey);
  if (storedValue === null) {
    return inMemorySessionState;
  }

  try {
    const parsedValue: unknown = JSON.parse(storedValue);
    if (typeof parsedValue !== "object" || parsedValue === null || Array.isArray(parsedValue)) {
      return inMemorySessionState;
    }

    const { sessionId, lastEventAtMs } = parsedValue as Readonly<{
      sessionId?: unknown;
      lastEventAtMs?: unknown;
    }>;
    if (
      typeof sessionId !== "string"
      || isAnalyticsUuid(sessionId) === false
      || typeof lastEventAtMs !== "number"
      || Number.isFinite(lastEventAtMs) === false
    ) {
      return inMemorySessionState;
    }

    return { sessionId, lastEventAtMs };
  } catch {
    return inMemorySessionState;
  }
}

function writeSessionState(sessionState: AnalyticsSessionState, isNewSession: boolean): void {
  const previousSessionState = inMemorySessionState;
  inMemorySessionState = sessionState;
  if (
    isNewSession === false
    && previousSessionState !== null
    && sessionState.lastEventAtMs - sessionPersistedAtMs < sessionPersistIntervalMs
  ) {
    return;
  }

  sessionPersistedAtMs = sessionState.lastEventAtMs;
  writeBrowserStorageItem(sessionStorageKey, JSON.stringify(sessionState));
}

/**
 * Returns the current session id and records the event time that keeps it alive. Persisted so a page
 * reload continues the same session, which is what makes web session counts comparable with the
 * mobile clients.
 */
export function readAnalyticsSessionId(nowMs: number): string {
  const sessionState = readStoredSessionState();
  if (
    sessionState !== null
    && nowMs >= sessionState.lastEventAtMs
    && nowMs - sessionState.lastEventAtMs <= sessionInactivityTimeoutMs
  ) {
    writeSessionState({ sessionId: sessionState.sessionId, lastEventAtMs: nowMs }, false);
    return sessionState.sessionId;
  }

  const sessionId = crypto.randomUUID().toLowerCase();
  writeSessionState({ sessionId, lastEventAtMs: nowMs }, true);
  return sessionId;
}

/**
 * Starts a fresh session, and only that: the identity behind it is the shared cookie and survives
 * every boundary this is called at, including a logout. Called from the logout cleanup path, where
 * the person leaving ends their session and the next one starts their own.
 */
export function resetAnalyticsSession(): void {
  inMemorySessionState = null;
  sessionPersistedAtMs = 0;
  removeBrowserStorageItem(sessionStorageKey);
}

export function readStoredAnalyticsEnabled(): boolean {
  return readBrowserStorageItem(analyticsEnabledStorageKey) !== "0";
}

export function writeStoredAnalyticsEnabled(enabled: boolean): void {
  if (enabled) {
    removeBrowserStorageItem(analyticsEnabledStorageKey);
    return;
  }

  writeBrowserStorageItem(analyticsEnabledStorageKey, "0");
}
