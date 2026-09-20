import { normalizeSupportedLocale } from "../i18n/locales";
import type { Locale } from "../i18n/types";
import {
  buildAnalyticsEventProperties,
  type AnalyticsEvent,
  type AnalyticsNetworkState,
  type AnalyticsSurface,
  type AnalyticsWireContext,
  type AnalyticsWireEvent,
  type AnonymousAnalyticsWireEvent,
  type IdentityFreeAnalyticsEventName,
} from "./events";
import { createAnalyticsUuidV7, readAnalyticsAnonymousId } from "./identity";

/** `context` string fields are capped at 200 characters by the ingest endpoint. */
const contextStringMaxLength = 200;
/** The credential-free collector rejects a longer or non-canonical language tag. */
const deviceLocaleMaxLength = 64;
const wireEventTextEncoder = new TextEncoder();

type NetworkInformation = Readonly<{
  type?: string;
}>;

type NavigatorWithConnection = Navigator & Readonly<{
  connection?: NetworkInformation;
}>;

/**
 * The ingest endpoint accepts UTC only: a timezone offset fails `z.string().datetime()` and rejects
 * the event, or the whole batch when it is `clientSentAt`. `toISOString` is always `Z`-suffixed UTC.
 */
export function toAnalyticsTimestamp(atMs: number): string {
  return new Date(atMs).toISOString();
}

/**
 * Captured per event rather than per batch: an offline-first client only ever flushes while online,
 * so a flush-time reading could never record `offline`.
 */
export function readAnalyticsNetworkState(): AnalyticsNetworkState {
  if (navigator.onLine === false) {
    return "offline";
  }

  const connectionType = (navigator as NavigatorWithConnection).connection?.type;
  if (connectionType === "wifi") {
    return "wifi";
  }

  if (connectionType === "cellular") {
    return "cellular";
  }

  return "unknown";
}

function toContextString(value: string): string | null {
  const trimmedValue = value.trim();
  if (trimmedValue === "") {
    return null;
  }

  return trimmedValue.slice(0, contextStringMaxLength);
}

function readTimezone(): string | null {
  try {
    return toContextString(Intl.DateTimeFormat().resolvedOptions().timeZone);
  } catch {
    return null;
  }
}

/**
 * Describes the device at flush time. The browser exposes no trustworthy OS version or device model,
 * so both are sent as explicit nulls rather than as a parsed user agent string.
 */
export function buildAnalyticsWireContext(): AnalyticsWireContext {
  return {
    osVersion: null,
    deviceModel: null,
    deviceLocale: toContextString(navigator.language),
    timezone: readTimezone(),
  };
}

/**
 * The device language in the canonical form the credential-free collector accepts: it normalizes the
 * tag itself and refuses anything it cannot place, so an unparseable one is sent as no locale.
 */
export function readAnalyticsDeviceLocale(): string | null {
  const value = navigator.language.trim();
  if (value === "" || value.length > deviceLocaleMaxLength) {
    return null;
  }

  try {
    const normalizedLocale = new Intl.Locale(value).toString();
    return normalizedLocale.length <= deviceLocaleMaxLength ? normalizedLocale : null;
  } catch {
    return null;
  }
}

export function readAnalyticsUiLocale(): Locale | null {
  // I18nProvider publishes the committed translation locale before passive analytics effects.
  return normalizeSupportedLocale(document.documentElement.lang);
}

export function toAnalyticsWireEvent(
  event: AnalyticsEvent,
  occurredAtMs: number,
  currentSurface: AnalyticsSurface | null,
): AnalyticsWireEvent {
  return {
    eventId: createAnalyticsUuidV7(),
    eventName: event.name,
    clientOccurredAt: toAnalyticsTimestamp(occurredAtMs),
    uiLocale: readAnalyticsUiLocale(),
    networkState: readAnalyticsNetworkState(),
    // The two events the catalog marks `requiresScreen` carry a surface of their own; everything
    // else takes the surface the caller was on, if any.
    screen: event.name === "screen_viewed" || event.name === "review_card_revealed"
      ? event.screen
      : currentSurface,
    properties: buildAnalyticsEventProperties(event),
    experimentAssignments: null,
  };
}

/**
 * The same queued event in the shape the credential-free collector accepts. The identity on the row
 * is the shared visitor id and nothing else, and it is read at send time rather than at track time
 * so an event queued before the cookie arrived still carries it — and so an event collected by a
 * browser that refused consent carries none, which is what leaves its rows identity-free.
 */
export function toAnonymousAnalyticsWireEvent(
  wireEvent: AnalyticsWireEvent,
  sentAtMs: number,
): AnonymousAnalyticsWireEvent {
  return {
    eventId: wireEvent.eventId,
    eventName: wireEvent.eventName,
    clientOccurredAt: wireEvent.clientOccurredAt,
    clientSentAt: toAnalyticsTimestamp(sentAtMs),
    anonymousId: readAnalyticsAnonymousId(),
    uiLocale: wireEvent.uiLocale ?? null,
    deviceLocale: readAnalyticsDeviceLocale(),
    screen: wireEvent.screen,
    properties: wireEvent.properties,
  };
}

/**
 * One event in the shape the collector accepts for a catalog entry that may be stored beside no
 * identity at all (docs/anonymous-client-analytics.md). Everything an identifier could be carried in
 * is absent by construction rather than by a caller remembering to leave it out: no `anonymousId`,
 * no surface, no properties. The row keeps the two facts the consent record is read by, the locale
 * and its own date.
 *
 * It is built here rather than from a queued event because a queued one is always stamped with an
 * `anonymousId`, which the collector refuses on these names with a `400` the delivery runtime drops
 * permanently — and because queueing it would be a write to a device that has not agreed to one.
 */
export function toIdentityFreeAnalyticsWireEvent(
  eventName: IdentityFreeAnalyticsEventName,
  atMs: number,
): AnonymousAnalyticsWireEvent {
  const occurredAt = toAnalyticsTimestamp(atMs);
  return {
    eventId: createAnalyticsUuidV7(),
    eventName,
    clientOccurredAt: occurredAt,
    clientSentAt: occurredAt,
    anonymousId: null,
    uiLocale: readAnalyticsUiLocale(),
    deviceLocale: readAnalyticsDeviceLocale(),
    screen: null,
    properties: null,
  };
}

export function measureAnalyticsWireEventBytes(wireEvent: AnalyticsWireEvent): number {
  return wireEventTextEncoder.encode(JSON.stringify(wireEvent)).length;
}
