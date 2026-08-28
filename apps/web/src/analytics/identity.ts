/**
 * Analytics identity. `anonymous_id` is per install and must never outlive an explicit logout, so it
 * has its own `flashcards-` prefixed key and is deliberately not the shared installation id from
 * `clientIdentity.ts`, which stays stable across users for sync.
 */

const anonymousIdStorageKey = "flashcards-analytics-anonymous-id";
const sessionStorageKey = "flashcards-analytics-session";
export const analyticsEnabledStorageKey = "flashcards-analytics-enabled";

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

function readStoredAnonymousId(): string | null {
  const storedValue = readBrowserStorageItem(anonymousIdStorageKey);
  if (storedValue === null) {
    return null;
  }

  const anonymousId = storedValue.trim().toLowerCase();
  return isAnalyticsUuid(anonymousId) ? anonymousId : null;
}

export function readAnalyticsAnonymousId(): string {
  const storedAnonymousId = readStoredAnonymousId();
  if (storedAnonymousId !== null) {
    inMemoryAnonymousId = storedAnonymousId;
    return storedAnonymousId;
  }

  const nextAnonymousId = inMemoryAnonymousId ?? crypto.randomUUID().toLowerCase();
  inMemoryAnonymousId = nextAnonymousId;
  writeBrowserStorageItem(anonymousIdStorageKey, nextAnonymousId);
  return nextAnonymousId;
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

/** Rotates `anonymous_id` and starts a fresh session. Called only from the logout cleanup path. */
export function resetAnalyticsIdentity(): void {
  inMemoryAnonymousId = null;
  inMemorySessionState = null;
  sessionPersistedAtMs = 0;
  removeBrowserStorageItem(anonymousIdStorageKey);
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
