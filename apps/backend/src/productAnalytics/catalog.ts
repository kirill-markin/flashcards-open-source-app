import { z } from "zod";

// The product analytics contract. Every client mirrors this file by hand and the server
// rejects anything that is not declared here, which is what keeps event_properties free of
// personal data and therefore safe to keep after an account is anonymized. A string property must
// declare a bounded format and not merely a length cap: a length-capped free-text property would be
// a client-controlled channel into a column that is retained indefinitely and that account
// anonymization deliberately keeps intact.
//
// schema_version stamps the catalog generation a stored row was accepted under, and it stayed 1
// across the revision that retired the session and onboarding events and added the fact-shaped
// ones. 0119 deleted every row written under the previous generation, so no stored row belongs to
// it: bumping would have created a generation with no rows and no meaning. It stays 1 through the
// sign-in funnel revision too, which only adds: no event is retired, no property changes meaning and
// no stored row reads differently, so a query for one of the new names returns nothing from before
// the deploy under either version, while a boundary here would force every existing query to weigh
// two generations for nothing. The bump is reserved for the first revision that leaves rows
// surviving on both sides of it reading differently, because that is when a query has to tell the
// two generations apart.
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
//
// The list names screens, never funnel steps, and it is the union of the screens the web, iOS and
// Android apps actually have. One granularity rule keeps it a surface enum rather than a route
// table: a screen earns a value when it is a destination of its own, meaning a tab, a public route,
// a prompt a person has to answer, an abandonable step of a flow, or one of the content objects the
// enum already names, while the app preference and account leaves that all three clients nest under
// their settings screen collapse into `settings`. A client whose screen has no value here sends no
// `screen` at all rather than the nearest wrong one.
//
// `screen` carries two readings, deliberately. On `screen_viewed` and on every other event it is
// where the person is now. On `signin_failed` alone it is the entry point: the surface that owned
// the sign-in control the person tapped, never `signin` itself. That set is open, because any
// surface can grow such a control — `settings`, `progress`, `review` and `ai` carry one today — and
// a sign-in the client cannot attribute to a surface reports no `screen` at all, so filtering the
// event to a fixed list of surfaces silently drops entry points. Adding `signin` for the sign-in
// screen itself does not change that, but a funnel that mixes the two readings will misread
// `signin_failed`.
export const productAnalyticsSurfaces = [
  "review",
  "catalog",
  "deck_detail",
  "card_editor",
  "cards",
  "progress",
  "settings",
  "ai",
  // Workspace content management. These sit under the settings screen on all three clients only as
  // a routing accident: they act on the person's own decks, cards and tags, which is the same
  // object family `cards`, `card_editor` and `deck_detail` already name.
  "decks",
  "deck_editor",
  "tags",
  // Authentication. `signin` is the sign-in screen itself whatever the client splits it into: the
  // email step, the code step and the workspace choice are one screen here.
  // `credential_recovery` is the gate that replaces the whole app root on iOS and Android when
  // stored credentials can no longer be used, and is the one sign-in entry point that until now
  // could only be reported as no screen at all.
  "signin",
  "credential_recovery",
  // Our own in-app prompts, each a screen a person has to answer before anything else continues.
  // `prompt_answered.prompt` repeats these two values verbatim, so an answer joins to its surface by
  // equality; the two spellings have to stay identical for that join to keep working.
  "notifications_pre_prompt",
  "signin_after_review_prompt",
  // The catalog import flow, whose steps are internal component state rather than routes, so the
  // surface is the only place the step can be recorded. `catalog_import_signin` is the gate a
  // signed-out person lands on when they open an import link; `catalog` stays the surface of the
  // route's own loading, not-found and error states.
  "catalog_import_signin",
  "catalog_import_workspace",
  "catalog_import_confirm",
  "catalog_import_done",
  // The two sides of a friend invitation: the screen that creates and shares one, and the landing
  // page the invited person opens.
  "friend_invite",
  "friend_invite_accept",
  // The public page that hands out the app's other platform links.
  "share",
] as const;

export const productAnalyticsNetworkStates = [
  "wifi",
  "cellular",
  "offline",
  "unknown",
] as const;

// The clients an event can come from. `agent` is the terminal / AI-agent API and MCP client that
// AGENTS.md lists as a supported client alongside the three apps and that had no value here at all,
// so every event it produced was platform-less. The name is the one the repository already uses for
// that client, in the `agent_connection` sync actor kind, in apps/backend/src/agent/, on the
// /settings/agent-connections screen and on the GET /v1/agent discovery route, rather than a fourth
// spelling invented for analytics. No stored platform column holds it — sync.workspace_replicas,
// sync.installations and auth.guest_sessions each constrain platform to a set without it — so only
// the actor kind identifies this client. This list is the stored-value domain and not the set a
// client may claim; see productAnalyticsClientReportablePlatforms below.
// ServerDerivedProductAnalyticsEvent carries the rules and the hazards a server-derived producer
// works through before reporting any value at all.
export const productAnalyticsPlatforms = [
  "ios",
  "android",
  "web",
  "agent",
] as const;

export type ProductAnalyticsSurface = (typeof productAnalyticsSurfaces)[number];
export type ProductAnalyticsNetworkState = (typeof productAnalyticsNetworkStates)[number];
export type ProductAnalyticsPlatform = (typeof productAnalyticsPlatforms)[number];

// Which of the stored platform values a client request may claim for itself. The two sets are
// deliberately different, and the difference is load-bearing rather than tidiness: the ingestion
// route is public and human-authenticated, so a hand-posted or mis-headered batch reaches it, and
// analytics.product_events is append-only, so a client-origin row that claimed a platform it is not
// could never be repaired and would poison every `WHERE platform = ...` read of it afterwards.
//
// `agent` is the value that must stay unreachable from a request header. The agent client cannot
// legitimately produce a client-origin row at all: its transport is api_key, which
// isProductAnalyticsTransportAccepted refuses outright, so every client-origin row carrying
// platform 'agent' is necessarily a false claim.
//
// The table is exhaustive over the stored domain rather than a second literal list, so a platform
// added above does not compile until this question is answered for it, and no future platform can
// become client-claimable by omission.
const productAnalyticsClientReportablePlatformFlags = {
  ios: true,
  android: true,
  web: true,
  agent: false,
} as const satisfies Readonly<Record<ProductAnalyticsPlatform, boolean>>;

export type ProductAnalyticsClientReportablePlatform = {
  [Platform in ProductAnalyticsPlatform]:
    (typeof productAnalyticsClientReportablePlatformFlags)[Platform] extends true ? Platform : never;
}[ProductAnalyticsPlatform];

export const productAnalyticsClientReportablePlatforms: ReadonlyArray<ProductAnalyticsClientReportablePlatform> =
  productAnalyticsPlatforms.filter(
    (platform): platform is ProductAnalyticsClientReportablePlatform =>
      productAnalyticsClientReportablePlatformFlags[platform],
  );

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

type ProductAnalyticsEventSpecProperties = Readonly<{
  properties: Readonly<Record<string, ProductAnalyticsPropertySpec>>;
}>;

// serverOnly and requiresScreen are mutually exclusive, and the union below is what makes the
// combination unwritable rather than merely wrong. The backend has no surface of its own to report,
// so createServerDerivedProductAnalyticsRow stores screen NULL for every server-derived row; a
// server-only entry that also required a surface would fail the writer's catalog assertion, and
// emitServerDerivedProductAnalyticsEvent turns that throw into a Sentry warning, so every row of
// that event would be dropped with nothing visible at ingest. A compile error on the catalog entry
// is the only form of that failure a person can act on.
type ProductAnalyticsEventSpec = ProductAnalyticsEventSpecProperties &
  (
    // Emitted by the backend from its own observation. Client ingest rejects these outright, so a
    // client can never forge an outcome the server never saw, and the server-side emission path is
    // the only producer of the row.
    | Readonly<{ serverOnly: true; requiresScreen: false }>
    // requiresScreen is a required surface, carried by the event's own screen field rather than
    // duplicated into properties.
    | Readonly<{ serverOnly: false; requiresScreen: boolean }>
  );

export const productAnalyticsEventCatalog = {
  app_opened: {
    serverOnly: false,
    requiresScreen: false,
    properties: {
      // `unknown` is not a client value: a live client always knows whether it cold- or
      // warm-started. It exists because a day reconstructed from stored activity long after the
      // fact cannot know which it was, and inventing either would be a lie. The property stays
      // required so "we do not know" is a stored fact rather than an absent key that a reader
      // cannot tell apart from a client that failed to send one.
      launch_type: { kind: "enum", values: ["cold", "warm", "unknown"] },
    },
  },
  screen_viewed: {
    serverOnly: false,
    requiresScreen: true,
    properties: {},
  },
  // Our own in-app prompts, which are ours to decide when to show. The OS-level result of the
  // permission dialog a person may then be handed is a separate event, because a person can accept
  // this prompt and still deny the system one. `prompt` is spelled exactly as the prompt's own
  // surface above, so the answer joins to the surface without a mapping.
  prompt_answered: {
    serverOnly: false,
    requiresScreen: false,
    properties: {
      prompt: { kind: "enum", values: ["signin_after_review_prompt", "notifications_pre_prompt"] },
      outcome: { kind: "enum", values: ["accepted", "dismissed", "snoozed"] },
    },
  },
  // The OS-level permission dialog, whose outcome the app only observes. The surface is carried by
  // the event's own screen and never duplicated into a property: there is exactly one place a
  // surface belongs on an event. It carries the ordinary reading above and not the entry-point one
  // `signin_failed` has: an OS dialog can be answered after the app was backgrounded and resumed
  // somewhere else, so the screen is where the person is when the answer is reported and reading it
  // as the surface that asked for the permission would be wrong.
  permission_prompt_answered: {
    serverOnly: false,
    requiresScreen: false,
    properties: {
      permission: { kind: "enum", values: ["notifications", "photo_library", "camera", "microphone"] },
      outcome: { kind: "enum", values: ["granted", "denied", "dismissed"] },
    },
  },
  // The two middle steps of the sign-in funnel, read against `signin_failed` below. Neither is
  // server-only, deliberately: the web funnel's producer is apps/auth, which is a server, but it
  // reports through the public client ingest route POST /v1/analytics/events as a `web` client, and
  // that route rejects a serverOnly entry outright — the spec union above makes serverOnly together
  // with requiresScreen unwritable in any case.
  //
  // Both require a surface so a producer always names where the sign-in happened: the auth origin
  // sends `signin`, and a client adopting these would send `signin` or `credential_recovery`. That
  // is `screen` in its ordinary reading, where the person is now, and not the entry-point reading
  // the surface comment above reserves for `signin_failed` alone, so a funnel must not read the
  // three events' screens the same way. Neither carries a property: the step is the whole fact, and
  // `screen`, `platform` and the event name already carry the rest.
  signin_code_requested: {
    serverOnly: false,
    requiresScreen: true,
    properties: {},
  },
  signin_succeeded: {
    serverOnly: false,
    requiresScreen: true,
    properties: {},
  },
  signin_failed: {
    serverOnly: false,
    requiresScreen: false,
    properties: {
      reason: {
        kind: "enum",
        values: [
          "invalid_code",
          "expired_code",
          // A sign-in that failed on an OTP challenge the auth service classified as already
          // consumed, which is a different drop cause from a code that ran out of time.
          // classifyVerifyFailure in apps/auth/src/routes/browser/verifyCode.ts maps that Cognito
          // failure to OTP_CHALLENGE_CONSUMED and keeps it apart from an expired session, and that
          // classification is what this value records, so folding it into `expired_code` would hide
          // a cause the origin can already tell apart and a person can act on. Only a producer that
          // separates the two states can report this value; one that does not reports
          // `expired_code` instead. A near-absent `code_already_used` is therefore a floor rather
          // than a zero, and the table is append-only, so stored rows keep whatever their producer
          // could tell apart.
          "code_already_used",
          "rate_limited",
          "offline",
          "server_error",
          "cancelled",
        ],
      },
    },
  },
  guest_upgrade_completed: {
    serverOnly: true,
    requiresScreen: false,
    properties: {},
  },
  // The card flip. It never reaches the backend on its own, so only a client can report it, and it
  // is the denominator `review_answered` is read against: the gap between the two is the person who
  // looked at the answer and walked away.
  review_card_revealed: {
    serverOnly: false,
    requiresScreen: true,
    properties: {},
  },
  // One graded answer, derived from the content.review_events row the answer stored rather than
  // reported by the client, so a review answered offline is counted once it syncs and is never
  // counted twice. The rating names the four buttons; the stored column holds them as 0..3 and the
  // producer maps them here, because a stored integer is unreadable in a query five months later.
  review_answered: {
    serverOnly: true,
    requiresScreen: false,
    properties: {
      rating: { kind: "enum", values: ["again", "hard", "good", "easy"] },
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
  // The content facts, each derived from the row the write actually left behind rather than from
  // the client that intended it. An offline-first client queues a write and syncs it later, so the
  // server is the only place that knows a card or a deck really exists; `card_create_started` above
  // stays a client event precisely because it reports the intent, which is the other half of the
  // pair. Carrying no properties is deliberate: the row is the fact, and anything describing what
  // was written would be content a person typed.
  card_created: {
    serverOnly: true,
    requiresScreen: false,
    properties: {},
  },
  card_updated: {
    serverOnly: true,
    requiresScreen: false,
    properties: {},
  },
  deck_created: {
    serverOnly: true,
    requiresScreen: false,
    properties: {},
  },
  deck_updated: {
    serverOnly: true,
    requiresScreen: false,
    properties: {},
  },
  friend_invitation_created: {
    serverOnly: true,
    requiresScreen: false,
    properties: {},
  },
  // One event per directed friendship row, so an accepted invitation produces two: the inviter and
  // the accepter each gained a friend, and each sees that when looking only at their own events.
  // Emitting one event for the pair would leave one of the two people with no record of it.
  friendship_created: {
    serverOnly: true,
    requiresScreen: false,
    properties: {},
  },
  ai_message_sent: {
    serverOnly: true,
    requiresScreen: false,
    properties: {},
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

// Exact compatibility tombstones for client events intentionally removed from the active catalog.
// Keeping them outside productAnalyticsEventCatalog makes them impossible to accept or store, while
// client ingest can distinguish a valid queued remnant from a genuinely unknown event name.
const retiredProductAnalyticsClientEventNames: ReadonlySet<string> = new Set([
  "onboarding_step_completed",
  "review_session_started",
  "review_session_ended",
]);

export function isRetiredProductAnalyticsClientEventName(eventName: string): boolean {
  return retiredProductAnalyticsClientEventNames.has(eventName);
}

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
  spec: ProductAnalyticsEventSpecProperties,
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
