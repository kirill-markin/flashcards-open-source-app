import type {
  ProductAnalyticsEventName,
  ProductAnalyticsEventProperties,
  ProductAnalyticsExperimentAssignments,
  ProductAnalyticsNetworkState,
  ProductAnalyticsPlatform,
  ProductAnalyticsSurface,
} from "./catalog";

export type ProductAnalyticsOrigin = "client" | "server" | "backfill";

export type ProductAnalyticsTrustLevel =
  | "server_derived"
  | "authenticated_client"
  | "guest_client"
  | "backfill_derived";

// Batch-level device context. It describes the device, never the person, and every field is
// dropped when the account behind the row is anonymized. Network state is deliberately not here: it
// is the one time-varying field, and an offline-first client can only flush a queued batch while it
// is online, so a batch-level capture could never record the offline value the column exists for.
export type ProductAnalyticsClientContext = Readonly<{
  osVersion: string | null;
  deviceModel: string | null;
  deviceLocale: string | null;
  timezone: string | null;
}>;

export type ProductAnalyticsRejectionReason =
  | "invalid_event"
  | "event_too_large"
  | "unknown_field"
  | "server_owned_field"
  | "unknown_event_name"
  | "server_only_event"
  | "missing_screen"
  | "too_many_properties"
  | "unknown_property"
  | "invalid_property"
  | "invalid_experiment_assignments"
  | "occurred_at_out_of_window"
  | "duplicate_event_id";

export type ProductAnalyticsRejectedEvent = Readonly<{
  eventId: string | null;
  reason: ProductAnalyticsRejectionReason;
}>;

export type ValidatedProductAnalyticsEvent = Readonly<{
  eventId: string;
  eventName: ProductAnalyticsEventName;
  clientOccurredAt: Date;
  occurredAt: Date;
  networkState: ProductAnalyticsNetworkState | null;
  screen: ProductAnalyticsSurface | null;
  properties: ProductAnalyticsEventProperties;
  experimentAssignments: ProductAnalyticsExperimentAssignments;
}>;

// One row of analytics.product_events. identity_state and ingested_at are owned by the database
// and are deliberately absent here so no caller can invent them.
export type ProductAnalyticsEventRow = Readonly<{
  eventId: string;
  schemaVersion: number;
  eventName: ProductAnalyticsEventName;
  origin: ProductAnalyticsOrigin;
  backfillId: string | null;
  clientOccurredAt: Date | null;
  clientSentAt: Date | null;
  serverReceivedAt: Date;
  occurredAt: Date;
  userId: string | null;
  subjectUserId: string | null;
  authTransport: string | null;
  trustLevel: ProductAnalyticsTrustLevel;
  guestSessionId: string | null;
  workspaceId: string | null;
  anonymousId: string | null;
  sessionId: string | null;
  platform: ProductAnalyticsPlatform | null;
  appVersion: string | null;
  osVersion: string | null;
  deviceModel: string | null;
  deviceLocale: string | null;
  timezone: string | null;
  country: string | null;
  networkState: ProductAnalyticsNetworkState | null;
  screen: ProductAnalyticsSurface | null;
  eventProperties: ProductAnalyticsEventProperties;
  experimentAssignments: ProductAnalyticsExperimentAssignments;
  requestId: string | null;
}>;

// server_derived comes from the two places the backend observes the pair itself: the guest upgrade,
// and the /guest-auth/identity/link route a signed-in account calls to claim the guest identity its
// browser or install held. authenticated_client comes from an authenticated ingest request, which is
// a client claim the server only framed.
export type ProductAnalyticsIdentityLinkSource = "server_derived" | "authenticated_client";

// One row of analytics.identity_links. linked_at is owned by the database so no caller can date a
// link earlier than the moment it was observed.
export type ProductAnalyticsIdentityLink = Readonly<{
  linkId: string;
  anonymousId: string;
  userId: string;
  source: ProductAnalyticsIdentityLinkSource;
}>;
