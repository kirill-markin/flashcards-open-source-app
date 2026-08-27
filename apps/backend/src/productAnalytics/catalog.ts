import { z } from "zod";

// Frozen v1 product analytics contract. Every client mirrors this file by hand and the server
// rejects anything that is not declared here, which is what keeps event_properties free of
// personal data and therefore safe to keep after an account is anonymized. A string property must
// declare a bounded format and not merely a length cap: a length-capped free-text property would be
// a client-controlled channel into a column that is retained indefinitely and that account
// anonymization deliberately keeps intact.
export const productAnalyticsSchemaVersion = 1;

// event_id is the primary key of an append-only table, so time-ordered ids are the only thing that
// keeps insert locality sequential, and a row written with any other UUID version cannot be repaired
// afterwards. Every client that mirrors this file must generate UUIDv7 event ids: ingest rejects any
// other version and reports that event as invalid_event, which is indistinguishable from a
// malformed event in the response, so the version is a client obligation rather than a hint.
export const productAnalyticsEventIdUuidVersion = 7;

// The version nibble of a canonical UUID string is its fifteenth character.
const uuidVersionCharacterIndex = 14;

export function isProductAnalyticsEventIdVersionValid(eventId: string): boolean {
  return eventId[uuidVersionCharacterIndex] === String(productAnalyticsEventIdUuidVersion);
}

export const productAnalyticsPropertyStringMaxLength = 200;
export const productAnalyticsPropertyKeyLimit = 25;

// The repository's canonical slug shape, mirrored from apps/backend/src/catalog/common.ts so this
// contract stays readable on its own for the clients that mirror it by hand.
export const productAnalyticsSlugPattern = /^[a-z0-9](?:[a-z0-9-]{0,118}[a-z0-9])?$/u;

// Experiment keys and variant values are chosen by the client on both sides of the map, and unlike
// the person-linked columns, account anonymization deliberately leaves experiment_assignments in
// place. Both sides are therefore bound to one identifier shape so that column cannot become free
// text either.
export const productAnalyticsExperimentTokenPattern = /^[a-z0-9](?:[a-z0-9_-]{0,62}[a-z0-9])?$/u;

// Platform-independent surfaces so funnels compare across clients. Each client maps its own
// native screens onto these and never sends a native screen name.
export const productAnalyticsSurfaces = [
  "review",
  "catalog",
  "deck_detail",
  "onboarding",
  "card_editor",
  "cards",
  "progress",
  "settings",
  "ai",
] as const;

export const productAnalyticsNetworkStates = [
  "wifi",
  "cellular",
  "offline",
  "unknown",
] as const;

export const productAnalyticsPlatforms = [
  "ios",
  "android",
  "web",
] as const;

export type ProductAnalyticsSurface = (typeof productAnalyticsSurfaces)[number];
export type ProductAnalyticsNetworkState = (typeof productAnalyticsNetworkStates)[number];
export type ProductAnalyticsPlatform = (typeof productAnalyticsPlatforms)[number];

export type ProductAnalyticsPropertyValue = string | number;
export type ProductAnalyticsEventProperties = Readonly<Record<string, ProductAnalyticsPropertyValue>>;
export type ProductAnalyticsExperimentAssignments = Readonly<Record<string, string>>;

type ProductAnalyticsPropertySpec =
  | Readonly<{ kind: "enum"; values: ReadonlyArray<string> }>
  // pattern is required, so a string property that would accept unbounded free text cannot compile.
  | Readonly<{ kind: "string"; pattern: RegExp }>
  // Every numeric property in this catalog is a counter or a measure. The table is append-only, so a
  // client that writes -1 or 1.5 cannot be repaired afterwards; the contract admits neither.
  | Readonly<{ kind: "nonNegativeInteger" }>;

type ProductAnalyticsEventSpec = Readonly<{
  // Emitted by the backend from its own observation. Client ingest rejects these outright, so a
  // client can never forge an outcome the server never saw, and the server-side emission path is
  // the only producer of the row.
  serverOnly: boolean;
  // A required surface, carried by the event's own screen field rather than duplicated into properties.
  requiresScreen: boolean;
  properties: Readonly<Record<string, ProductAnalyticsPropertySpec>>;
}>;

export const productAnalyticsEventCatalog = {
  app_opened: {
    serverOnly: false,
    requiresScreen: false,
    properties: {
      launch_type: { kind: "enum", values: ["cold", "warm"] },
    },
  },
  screen_viewed: {
    serverOnly: false,
    requiresScreen: true,
    properties: {},
  },
  onboarding_step_completed: {
    serverOnly: false,
    requiresScreen: false,
    properties: {
      step: {
        kind: "enum",
        values: ["language", "goal", "notifications", "first_deck", "first_review", "signin"],
      },
      outcome: { kind: "enum", values: ["completed", "skipped"] },
    },
  },
  signin_failed: {
    serverOnly: false,
    requiresScreen: false,
    properties: {
      reason: {
        kind: "enum",
        values: ["invalid_code", "expired_code", "rate_limited", "offline", "server_error", "cancelled"],
      },
    },
  },
  guest_upgrade_completed: {
    serverOnly: true,
    requiresScreen: false,
    properties: {},
  },
  review_session_started: {
    serverOnly: false,
    requiresScreen: false,
    properties: {
      deck_scope: { kind: "enum", values: ["all", "deck", "filter"] },
    },
  },
  review_session_ended: {
    serverOnly: false,
    requiresScreen: false,
    properties: {
      end_reason: { kind: "enum", values: ["completed", "abandoned", "interrupted"] },
      answered_count: { kind: "nonNegativeInteger" },
      duration_ms: { kind: "nonNegativeInteger" },
    },
  },
  review_answer_failed: {
    serverOnly: false,
    requiresScreen: false,
    properties: {
      reason: { kind: "enum", values: ["offline", "timeout", "sync_conflict", "server_error"] },
    },
  },
  card_create_started: {
    serverOnly: false,
    requiresScreen: false,
    properties: {
      entry_point: {
        kind: "enum",
        values: ["cards", "deck_detail", "review", "ai", "quick_action"],
      },
    },
  },
  sync_failed: {
    serverOnly: false,
    requiresScreen: false,
    properties: {
      reason: {
        kind: "enum",
        values: ["offline", "timeout", "conflict", "unauthorized", "server_error", "storage_full"],
      },
    },
  },
  catalog_deck_install_started: {
    serverOnly: false,
    requiresScreen: false,
    properties: {
      package_slug: { kind: "string", pattern: productAnalyticsSlugPattern },
    },
  },
  catalog_deck_installed: {
    serverOnly: true,
    requiresScreen: false,
    properties: {
      package_slug: { kind: "string", pattern: productAnalyticsSlugPattern },
      card_count: { kind: "nonNegativeInteger" },
    },
  },
  analytics_events_dropped: {
    serverOnly: false,
    requiresScreen: false,
    properties: {
      reason: { kind: "enum", values: ["queue_overflow", "ttl_expired", "rejected"] },
      count: { kind: "nonNegativeInteger" },
    },
  },
} as const satisfies Readonly<Record<string, ProductAnalyticsEventSpec>>;

export const productAnalyticsSurfaceSchema = z.enum(productAnalyticsSurfaces);
export const productAnalyticsNetworkStateSchema = z.enum(productAnalyticsNetworkStates);

export type ProductAnalyticsEventName = keyof typeof productAnalyticsEventCatalog;

export type ProductAnalyticsEventDefinition = Readonly<{
  eventName: ProductAnalyticsEventName;
  serverOnly: boolean;
  requiresScreen: boolean;
  propertyNames: ReadonlySet<string>;
  // Returns null when a declared property is missing or carries a value the catalog does not allow,
  // which includes nested objects and arrays because no property spec accepts them.
  parseProperties: (value: unknown) => ProductAnalyticsEventProperties | null;
}>;

function createPropertySchema(spec: ProductAnalyticsPropertySpec) {
  if (spec.kind === "enum") {
    return z.enum(spec.values);
  }

  if (spec.kind === "nonNegativeInteger") {
    return z.number().int().nonnegative();
  }

  return z.string().min(1).max(productAnalyticsPropertyStringMaxLength).regex(spec.pattern);
}

function createPropertiesParser(
  spec: ProductAnalyticsEventSpec,
): (value: unknown) => ProductAnalyticsEventProperties | null {
  const shape: Record<string, ReturnType<typeof createPropertySchema>> = {};
  for (const [propertyName, propertySpec] of Object.entries(spec.properties)) {
    shape[propertyName] = createPropertySchema(propertySpec);
  }

  const schema = z.object(shape).strict();
  return (value: unknown): ProductAnalyticsEventProperties | null => {
    const parsed = schema.safeParse(value);
    return parsed.success ? parsed.data : null;
  };
}

function createEventDefinitions(): ReadonlyMap<string, ProductAnalyticsEventDefinition> {
  const definitions = new Map<string, ProductAnalyticsEventDefinition>();
  for (const [eventName, spec] of Object.entries(productAnalyticsEventCatalog)) {
    definitions.set(eventName, {
      eventName: eventName as ProductAnalyticsEventName,
      serverOnly: spec.serverOnly,
      requiresScreen: spec.requiresScreen,
      propertyNames: new Set(Object.keys(spec.properties)),
      parseProperties: createPropertiesParser(spec),
    });
  }

  return definitions;
}

const productAnalyticsEventDefinitions = createEventDefinitions();

export function findProductAnalyticsEventDefinition(eventName: string): ProductAnalyticsEventDefinition | null {
  return productAnalyticsEventDefinitions.get(eventName) ?? null;
}

export function isPlainObject(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

// Returns null when the map is not a flat object, declares more keys than the property limit, or
// carries a key or a variant outside the experiment token shape.
export function parseProductAnalyticsExperimentAssignments(
  value: unknown,
): ProductAnalyticsExperimentAssignments | null {
  if (value === undefined || value === null) {
    return {};
  }

  if (!isPlainObject(value)) {
    return null;
  }

  const entries = Object.entries(value);
  if (entries.length > productAnalyticsPropertyKeyLimit) {
    return null;
  }

  const assignments: Record<string, string> = {};
  for (const [experimentKey, variant] of entries) {
    if (productAnalyticsExperimentTokenPattern.test(experimentKey) === false) {
      return null;
    }

    if (typeof variant !== "string" || productAnalyticsExperimentTokenPattern.test(variant) === false) {
      return null;
    }

    assignments[experimentKey] = variant;
  }

  return assignments;
}
