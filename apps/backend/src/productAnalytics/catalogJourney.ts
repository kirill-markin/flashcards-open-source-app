import { z } from "zod";
import { HttpError } from "../shared/errors";
import {
  findProductAnalyticsEventDefinition,
  isPlainObject,
  isProductAnalyticsEventIdVersionValid,
  productAnalyticsSchemaVersion,
  type ProductAnalyticsEventName,
  type ProductAnalyticsEventProperties,
} from "./catalog";
import type { ProductAnalyticsEventRow } from "./types";
import { correctProductAnalyticsClockSkew, productAnalyticsUiLocaleSchema } from "./validation";

export const catalogInstallJourneyClientEventNames = [
  "catalog_install_clicked",
  "catalog_install_landed",
  "catalog_install_signin_started",
  "catalog_install_signin_code_requested",
  "catalog_install_signin_succeeded",
  "catalog_install_preview_ready",
  "catalog_install_failed",
  "catalog_deck_install_started",
] as const satisfies ReadonlyArray<ProductAnalyticsEventName>;

export type CatalogInstallJourneyClientEventName =
  (typeof catalogInstallJourneyClientEventNames)[number];

const catalogInstallJourneyEventNameSchema = z.enum(catalogInstallJourneyClientEventNames);
const catalogInstallJourneyUuidSchema = z.string().uuid().transform((value) => value.toLowerCase());
const catalogInstallJourneyDeviceLocaleMaximumLength = 64;

const catalogInstallJourneyEventSchema = z.object({
  eventId: catalogInstallJourneyUuidSchema,
  eventName: catalogInstallJourneyEventNameSchema,
  clientOccurredAt: z.string().datetime(),
  clientSentAt: z.string().datetime(),
  uiLocale: productAnalyticsUiLocaleSchema.nullish(),
  deviceLocale: z.string().min(1).max(catalogInstallJourneyDeviceLocaleMaximumLength).nullish(),
  properties: z.unknown(),
}).strict();

function parseTimestamp(value: string, fieldName: string): Date {
  const timestamp = new Date(value);
  if (Number.isNaN(timestamp.getTime())) {
    throw new HttpError(
      400,
      `Catalog install analytics ${fieldName} must be a valid UTC timestamp.`,
      "CATALOG_INSTALL_ANALYTICS_INVALID_EVENT",
    );
  }

  return timestamp;
}

function normalizeDeviceLocale(value: string | null | undefined): string | null {
  if (value === null || value === undefined) {
    return null;
  }

  if (value.trim() !== value) {
    throw new HttpError(
      400,
      "Catalog install analytics deviceLocale must be a canonical language tag.",
      "CATALOG_INSTALL_ANALYTICS_INVALID_EVENT",
    );
  }

  let locale: Intl.Locale;
  try {
    locale = new Intl.Locale(value);
  } catch {
    throw new HttpError(
      400,
      "Catalog install analytics deviceLocale must be a valid language tag.",
      "CATALOG_INSTALL_ANALYTICS_INVALID_EVENT",
    );
  }

  const normalizedLocale = locale.toString();
  if (normalizedLocale.length > catalogInstallJourneyDeviceLocaleMaximumLength) {
    throw new HttpError(
      400,
      `Catalog install analytics deviceLocale must contain at most ${catalogInstallJourneyDeviceLocaleMaximumLength} characters.`,
      "CATALOG_INSTALL_ANALYTICS_INVALID_EVENT",
    );
  }

  return normalizedLocale;
}

function normalizeJourneyProperties(value: unknown): Readonly<Record<string, unknown>> | null {
  if (!isPlainObject(value)) {
    return null;
  }

  return {
    ...value,
    ...(typeof value.install_journey_id === "string"
      ? { install_journey_id: value.install_journey_id.toLowerCase() }
      : {}),
    ...(typeof value.package_version_id === "string"
      ? { package_version_id: value.package_version_id.toLowerCase() }
      : {}),
  };
}

function parseJourneyProperties(
  eventName: CatalogInstallJourneyClientEventName,
  value: unknown,
): ProductAnalyticsEventProperties {
  const definition = findProductAnalyticsEventDefinition(eventName);
  const normalizedProperties = normalizeJourneyProperties(value);
  const properties = normalizedProperties === null
    ? null
    : definition?.parseProperties(normalizedProperties) ?? null;
  if (definition === null || definition.serverOnly || properties === null) {
    throw new HttpError(
      400,
      "Catalog install analytics properties do not match the selected event.",
      "CATALOG_INSTALL_ANALYTICS_INVALID_EVENT",
    );
  }

  return properties;
}

export function parseCatalogInstallJourneyEvent(
  input: unknown,
  serverReceivedAt: Date,
  requestId: string,
): ProductAnalyticsEventRow {
  const parsedEvent = catalogInstallJourneyEventSchema.safeParse(input);
  if (parsedEvent.success === false) {
    throw new HttpError(
      400,
      "Catalog install analytics event does not match the collector contract.",
      "CATALOG_INSTALL_ANALYTICS_INVALID_EVENT",
    );
  }

  const event = parsedEvent.data;
  if (isProductAnalyticsEventIdVersionValid(event.eventId) === false) {
    throw new HttpError(
      400,
      "Catalog install analytics eventId must be a UUIDv7.",
      "CATALOG_INSTALL_ANALYTICS_INVALID_EVENT",
    );
  }

  const clientOccurredAt = parseTimestamp(event.clientOccurredAt, "clientOccurredAt");
  const clientSentAt = parseTimestamp(event.clientSentAt, "clientSentAt");
  const occurredAt = correctProductAnalyticsClockSkew(
    clientOccurredAt,
    clientSentAt,
    serverReceivedAt,
  );
  if (occurredAt === null) {
    throw new HttpError(
      400,
      "Catalog install analytics clientOccurredAt is outside the accepted clock window.",
      "CATALOG_INSTALL_ANALYTICS_EVENT_TIME_INVALID",
    );
  }

  const properties = parseJourneyProperties(event.eventName, event.properties);
  const installJourneyId = properties.install_journey_id;
  const packageVersionId = properties.package_version_id;
  if (typeof installJourneyId !== "string" || typeof packageVersionId !== "string") {
    throw new HttpError(
      400,
      "Catalog install analytics events require install_journey_id and package_version_id.",
      "CATALOG_INSTALL_ANALYTICS_INVALID_EVENT",
    );
  }

  return {
    eventId: event.eventId,
    schemaVersion: productAnalyticsSchemaVersion,
    eventName: event.eventName,
    origin: "client",
    backfillId: null,
    clientOccurredAt,
    clientSentAt,
    serverReceivedAt,
    occurredAt,
    userId: null,
    subjectUserId: null,
    authTransport: null,
    trustLevel: "anonymous_client",
    guestSessionId: null,
    workspaceId: null,
    anonymousId: installJourneyId,
    sessionId: null,
    platform: "web",
    appVersion: null,
    osVersion: null,
    deviceModel: null,
    deviceLocale: normalizeDeviceLocale(event.deviceLocale),
    timezone: null,
    country: null,
    uiLocale: event.uiLocale ?? null,
    networkState: null,
    screen: null,
    eventProperties: properties,
    experimentAssignments: {},
    requestId,
    details: null,
  };
}
