import {
  buildAnalyticsEventProperties,
  type AnalyticsEvent,
  type AnalyticsNetworkState,
  type AnalyticsSurface,
  type AnalyticsWireContext,
  type AnalyticsWireEvent,
} from "./events";
import { createAnalyticsUuidV7 } from "./identity";

/** `context` string fields are capped at 200 characters by the ingest endpoint. */
const contextStringMaxLength = 200;
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

export function toAnalyticsWireEvent(
  event: AnalyticsEvent,
  occurredAtMs: number,
  currentSurface: AnalyticsSurface | null,
): AnalyticsWireEvent {
  return {
    eventId: createAnalyticsUuidV7(),
    eventName: event.name,
    clientOccurredAt: toAnalyticsTimestamp(occurredAtMs),
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

export function measureAnalyticsWireEventBytes(wireEvent: AnalyticsWireEvent): number {
  return wireEventTextEncoder.encode(JSON.stringify(wireEvent)).length;
}
