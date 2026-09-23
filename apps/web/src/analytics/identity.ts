/**
 * Analytics identity. `anonymous_id` is the `analytics_visitor` cookie the backend mints for the
 * product domain (docs/analytics-visitor-identity.md), so this app measures a person from the first
 * page view rather than from the first interaction.
 *
 * The auth origin reports under the same cookie and mints nothing of its own
 * (`apps/auth/src/server/analytics/visitorSession.ts`), so `app.` and `auth.` measure one visitor
 * and the consent gate in this directory reaches both: a browser it withheld an identity from is
 * not measured there either.
 *
 * Sessions are deliberately not in that cookie: every client rotates its own under the shared
 * 30-minute rule, which is what this module still owns locally.
 */
import { getAppConfig } from "../config";
import type { AnalyticsConsentChoice } from "../types";

const visitorCookieName = "analytics_visitor";
/**
 * The `anonymous_id` earlier builds of this app kept in `localStorage`. It is adopted into the
 * shared cookie once and then dropped, so the history already collected under it stays connected to
 * this browser.
 */
const legacyAnonymousIdStorageKey = "flashcards-analytics-anonymous-id";
const sessionStorageKey = "flashcards-analytics-session";
export const analyticsEnabledStorageKey = "flashcards-analytics-enabled";
/**
 * This browser's answer to the product-analytics setting, kept apart from the key above on purpose:
 * that one carries the operator kill switch and the cookie banner's answer, and a cookie refusal
 * stored there must never be read as a refusal to be measured.
 */
export const productAnalyticsCollectionStorageKey = "flashcards-analytics-collection";

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
 * kept none, a per-tab id held in memory. Null where this browser refused consent and so may be
 * given no identifier at all.
 *
 * The mint answer's own `visitorId` is deliberately never adopted here. It is returned whether or
 * not the browser accepted the `Set-Cookie`, so a browser that blocks cookies would otherwise be
 * counted as one new visitor on every page load (docs/analytics-visitor-identity.md).
 *
 * The cookie is scoped to the current product base domain, so the planned move to `nibomo.com`
 * resets every visitor id on that day. That is knowingly accepted: no anonymous identity is carried
 * across the domain move.
 */
export function readAnalyticsAnonymousId(): string | null {
  // Read before the cookie rather than after it, because a refusal does not guarantee the cookie is
  // gone: a `GET /v1/analytics/visitor` already in flight when the decline `POST` cleared it lands
  // its own `Set-Cookie` afterwards. A browser that refused is given no identifier at all, so a late
  // mint is ignored here and expired by `clearAnalyticsVisitorCookie` below. The kill switch is read
  // with it, because an operator opt-out withholds every identity in exactly the same way.
  if (isAnalyticsIdentityAllowed() === false) {
    return null;
  }

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
 * `COOKIE_DOMAIN` candidate the backend resolves for that host. Null where the API host has no
 * parent domain — the local development stack — and nothing is written there.
 */
function readSharedVisitorCookieDomain(): string | null {
  const apiHostname = new URL(getAppConfig().apiBaseUrl).hostname;
  const separatorIndex = apiHostname.indexOf(".");
  const baseDomain = separatorIndex === -1 ? "" : apiHostname.slice(separatorIndex + 1);
  return baseDomain.includes(".") ? baseDomain : null;
}

/**
 * Expires the shared visitor cookie from the browser side. Written with the attributes the backend
 * mints it with, because a cookie is only replaced by one naming the same domain and path.
 *
 * Two callers, and the server's part differs between them. A refusal, whose own `POST` already
 * clears the cookie, so this closes the window after it: a `GET` that was in flight when the answer
 * landed carries its own `Set-Cookie`, and a refused browser must end up without the identifier
 * rather than merely ignoring it. And an account deletion, where nothing on the server clears this
 * cookie at the moment the deletion is confirmed: `POST /v1/me/delete` answers bearer callers with
 * no browser behind them, and the auth origin's `/logout-local` — which does clear cookies of its
 * own, on this domain — is reached only by a navigation the deletion cleanup can abort before
 * (docs/analytics-visitor-identity.md).
 */
export function clearAnalyticsVisitorCookie(): void {
  const cookieDomain = readSharedVisitorCookieDomain();
  const domainAttribute = cookieDomain === null ? "" : ` Domain=${cookieDomain};`;
  document.cookie = `${visitorCookieName}=;${domainAttribute} Path=/; Max-Age=0; Secure; SameSite=Lax`;
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
 * Starts a fresh session, and only that. At a logout the identity behind it is the shared cookie and
 * survives the boundary, so the person leaving ends their session and the next one starts their own.
 * At an account deletion it is called beside `clearAnalyticsVisitorCookie`, because a session
 * carried across that swap would join the retired identity to the one replacing it.
 */
export function resetAnalyticsSession(): void {
  inMemorySessionState = null;
  sessionPersistedAtMs = 0;
  removeBrowserStorageItem(sessionStorageKey);
}

/**
 * The one key carries two facts, and they are stored together rather than beside each other: the
 * kill switch, and this browser's answer to the consent banner.
 *
 * - absent — the switch is on and nobody has answered
 * - `"granted"` / `"declined"` — the switch is on and this is the answer
 * - `"0"` — the legacy operator opt-out, which reads as the refusal it always was
 * - `"0:"`, `"0:granted"`, `"0:declined"` — the switch is off, carrying the answer it found
 *
 * The prefixed forms exist so the switch cannot destroy a decision. An operator toggling it off and
 * on again must not return a browser that refused to "undecided", because that browser would then be
 * asked once more and is re-mintable in between — a withdrawal undone by an operator action nobody
 * asked the person about.
 */
const analyticsDisabledValue = "0";
const analyticsDisabledPrefix = "0:";

/** The product-analytics setting stores its own answer, and only an explicit one. */
const productAnalyticsCollectionOnValue = "1";
const productAnalyticsCollectionOffValue = "0";

type StoredAnalyticsSwitch = Readonly<{
  isEnabled: boolean;
  decision: AnalyticsConsentChoice | null;
}>;

function toStoredConsentChoice(value: string): AnalyticsConsentChoice | null {
  if (value === "granted") {
    return "granted";
  }

  return value === "declined" ? "declined" : null;
}

function readStoredAnalyticsSwitch(): StoredAnalyticsSwitch {
  const storedValue = readBrowserStorageItem(analyticsEnabledStorageKey);
  if (storedValue === null) {
    return { isEnabled: true, decision: null };
  }

  if (storedValue === analyticsDisabledValue) {
    return { isEnabled: false, decision: "declined" };
  }

  if (storedValue.startsWith(analyticsDisabledPrefix)) {
    return {
      isEnabled: false,
      decision: toStoredConsentChoice(storedValue.slice(analyticsDisabledPrefix.length)),
    };
  }

  return { isEnabled: true, decision: toStoredConsentChoice(storedValue) };
}

/** The kill switch, the only thing that turns analytics off entirely. */
export function readStoredAnalyticsEnabled(): boolean {
  return readStoredAnalyticsSwitch().isEnabled;
}

/** Moves the switch and carries whatever answer the person had given across it, in both directions. */
export function writeStoredAnalyticsEnabled(enabled: boolean): void {
  const { decision } = readStoredAnalyticsSwitch();
  if (enabled === false) {
    writeBrowserStorageItem(analyticsEnabledStorageKey, `${analyticsDisabledPrefix}${decision ?? ""}`);
    return;
  }

  if (decision === null) {
    removeBrowserStorageItem(analyticsEnabledStorageKey);
    return;
  }

  writeBrowserStorageItem(analyticsEnabledStorageKey, decision);
}

/** This browser's answer to the consent banner, or null while it has given none. */
export function readStoredAnalyticsConsentDecision(): AnalyticsConsentChoice | null {
  return readStoredAnalyticsSwitch().decision;
}

export function writeStoredAnalyticsConsentDecision(decision: AnalyticsConsentChoice): void {
  const { isEnabled } = readStoredAnalyticsSwitch();
  writeBrowserStorageItem(
    analyticsEnabledStorageKey,
    isEnabled ? decision : `${analyticsDisabledPrefix}${decision}`,
  );
}

/**
 * This browser's answer to the product-analytics setting, or null while it has given none. Null is
 * the answer nobody gave rather than a refusal, and it reads as on wherever it is used.
 */
export function readStoredProductAnalyticsCollection(): boolean | null {
  const storedValue = readBrowserStorageItem(productAnalyticsCollectionStorageKey);
  if (storedValue === null) {
    return null;
  }

  return storedValue !== productAnalyticsCollectionOffValue;
}

export function writeStoredProductAnalyticsCollection(isCollectionEnabled: boolean): void {
  writeBrowserStorageItem(
    productAnalyticsCollectionStorageKey,
    isCollectionEnabled ? productAnalyticsCollectionOnValue : productAnalyticsCollectionOffValue,
  );
}

/**
 * Whether the stored switch withholds an analytics identity outright: an operator opt-out and a
 * refusal each do, and this is the one place both halves are read together.
 *
 * It says nothing about a browser still waiting to answer the banner, which reads as allowed here.
 * Anything that spends an identity permanently — the guest identity link — composes
 * `isAnalyticsEnabledForCurrentRuntime()` with `isAnalyticsIdentityConsented()` instead, so an
 * unanswered load defers rather than spends.
 */
function isAnalyticsIdentityAllowed(): boolean {
  return readStoredAnalyticsEnabled() && readStoredAnalyticsConsentDecision() !== "declined";
}
