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
// sign-in and catalog install funnel revisions too, which only add: no event is retired, no property
// changes meaning and no stored row reads differently, so a query for one of the new names returns
// nothing from before the deploy under either version, while a boundary here would force every
// existing query to weigh two generations for nothing. The bump is reserved for the first revision that leaves rows
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

export const productAnalyticsUuidPattern =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;

// Experiment keys and variant values are chosen by the client on both sides of the map, and unlike
// the person-linked columns, account anonymization deliberately leaves experiment_assignments in
// place. Both sides are therefore bound to one identifier shape so that column cannot become free
// text either.
export const productAnalyticsExperimentTokenPattern = /^[a-z0-9](?:[a-z0-9_-]{0,62}[a-z0-9])?$/u;

// The marketing site's own placement ids, which it names in snake_case. Bound to that shape so the
// property cannot carry free text.
const productAnalyticsSitePlacementPattern = /^[a-z0-9](?:[a-z0-9_]{0,62}[a-z0-9])?$/u;

// A marketing site route with its locale prefix already stripped on the site, so one page reads as
// one path across every language, lowercase and with a leading and a trailing slash: `/`,
// `/blog/<slug>/`, `/catalog/packages/<slug>/`. The pattern is the shape rule only; the length rule
// stays `productAnalyticsPropertyStringMaxLength`, and that is the binding one, because the segment
// quantifiers below admit paths well past it.
const productAnalyticsSitePagePathPattern = /^\/(?:[a-z0-9][a-z0-9._-]{0,78}\/){0,6}$/u;

// Acquisition context the marketing site reports on its own facts, derived on the site from the
// referrer and the user agent, which are never sent raw.
const productAnalyticsSiteSources = ["direct", "search", "social", "referral", "internal", "unknown"] as const;
const productAnalyticsSiteDeviceCategories = ["desktop", "mobile", "tablet", "unknown"] as const;

// The kind of marketing site page an event happened on.
const productAnalyticsSitePageKinds = [
  "home",
  "blog_article",
  "blog_index",
  "catalog_package",
  "catalog_index",
  "catalog_other",
  "pricing",
  "features",
  "docs",
  "other",
] as const;

// What an app-entry CTA on the marketing site is and where it leads. The click and the impression
// below hold this one map rather than two equal literals, so neither the property set nor any
// accepted value can drift apart and stop the two halves joining by equality.
const productAnalyticsSiteAppEntryProperties = {
  target: { kind: "enum", values: ["web_app", "app_store", "google_play"] },
  page_kind: { kind: "enum", values: productAnalyticsSitePageKinds },
  placement: { kind: "string", pattern: productAnalyticsSitePlacementPattern },
  source: { kind: "enum", values: productAnalyticsSiteSources },
  device_category: { kind: "enum", values: productAnalyticsSiteDeviceCategories },
} as const;

// The reminders a client schedules with the OS. `review_reminder` is the daily or inactivity review
// nudge, `strict_reminder` the streak reminder; the web app schedules neither and reports no
// notification fact at all.
const productAnalyticsNotificationKinds = ["review_reminder", "strict_reminder"] as const;

// Platform-independent surfaces so funnels compare across clients. Each client maps its own
// native screens onto these and never sends a native screen name.
//
// The list names screens, never funnel steps, and it is the union of the screens the web, iOS and
// Android apps actually have. One granularity rule keeps it a surface enum rather than a route
// table: a screen earns a value when it is a destination of its own, meaning a tab, a public route,
// a prompt a person has to answer, an abandonable step of a flow, or one of the content objects the
// enum already names, while the app preference and account leaves that all three clients nest under
// their settings screen collapse into `settings`, with `settings_legal` below the single named
// exception. A client whose screen has no value here sends no `screen` at all rather than the
// nearest wrong one.
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
  // The legal and privacy screen, and the only settings leaf that does not collapse into
  // `settings`. The analytics opt-out promised in the published privacy policy is exercised there
  // and nowhere else, so how many people reach it is a question about whether that promise is
  // reachable rather than about navigation, and it cannot be answered while every settings leaf
  // reports one value. Every other leaf stays collapsed for exactly the reason it always was.
  "settings_legal",
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

// x-client-platform is a claim the request makes about itself, so it is matched against the
// client-reportable list rather than the stored platform domain. Matching it against the domain
// would let any request claim `agent`, which no client-origin value can honestly carry. A header
// outside the list is recorded as absent.
export function readProductAnalyticsClientPlatform(
  clientPlatform: string | null,
): ProductAnalyticsClientReportablePlatform | null {
  if (clientPlatform === null) {
    return null;
  }

  const platform = clientPlatform.trim().toLowerCase();
  return productAnalyticsClientReportablePlatforms.find(
    (knownPlatform) => knownPlatform === platform,
  ) ?? null;
}

export type ProductAnalyticsPropertyValue = string | number;
export type ProductAnalyticsEventProperties = Readonly<Record<string, ProductAnalyticsPropertyValue>>;
export type ProductAnalyticsExperimentAssignments = Readonly<Record<string, string>>;

type ProductAnalyticsPropertySpec =
  (
    | Readonly<{ kind: "enum"; values: ReadonlyArray<string> }>
    // pattern is required, so a string property that would accept unbounded free text cannot compile.
    | Readonly<{ kind: "string"; pattern: RegExp }>
    // Every numeric property in this catalog is a counter or a measure. The table is append-only, so a
    // client that writes -1 or 1.5 cannot be repaired afterwards; the contract admits neither.
    | Readonly<{ kind: "nonNegativeInteger" }>
  ) & Readonly<{ optional?: true }>;

type ProductAnalyticsEventSpecProperties = Readonly<{
  properties: Readonly<Record<string, ProductAnalyticsPropertySpec>>;
}>;

// The catalog property names an ingest path stores into an identity column instead of leaving them
// in event_properties alone. `readAnonymousId` in anonymousEvent.ts writes install_journey_id into
// anonymous_id whenever a credential-free request claims no anonymousId of its own, so an entry
// that declares this property declares an identity whatever else it says. Adding a property that
// any ingest promotes this way means adding its name here.
type ProductAnalyticsIdentityBearingPropertyName = "install_journey_id";

// An event that may never be stored beside any identity at all: no user, subject user, guest
// session, workspace, session or anonymous id. It is a property of the event rather than of the
// route that accepted it, because an identifier stored beside "this visitor was asked" or "this
// visitor refused" is the very processing the refusal withholds, whichever ingest wrote the row,
// and analytics.product_events is append-only, so the row could never be repaired afterwards. Both
// ingest paths and every future producer are held to it: client ingest rejects the event outright
// because it always stamps the caller's identity, the credential-free collector refuses a claimed
// anonymousId rather than stripping it, and the writer's catalog assertion is the backstop.
//
// `identityFree` carries the entry's properties rather than sitting beside them, because the rule
// and an identity-bearing property contradict each other and the contradiction has no safe runtime
// answer. Such an entry would pass the collector's claimed-id refusal - no id is claimed - and then
// have its own property promoted into anonymous_id, so the row would reach the writer's catalog
// assertion and be refused there as an unhandled error, reported to the producer as a 500 for a
// defect no request could fix and no retry could clear. The two branches below make the entry
// unwritable instead, which is the only form of that failure a person can act on.
//
// The identity-bearing branch says `identityFree?: undefined` rather than `?: false`, so an entry
// that says nothing carries the default - an event may be reported beside an identity - and the
// `false` spelling stays unwritable.
type ProductAnalyticsEventSpecIdentity =
  | Readonly<{
    identityFree: true;
    properties: Readonly<Record<string, ProductAnalyticsPropertySpec>>
      & Readonly<Partial<Record<ProductAnalyticsIdentityBearingPropertyName, never>>>;
  }>
  | (Readonly<{ identityFree?: undefined }> & ProductAnalyticsEventSpecProperties);

// serverOnly and requiresScreen are mutually exclusive, and the union below is what makes the
// combination unwritable rather than merely wrong. The backend has no surface of its own to report,
// so createServerDerivedProductAnalyticsRow stores screen NULL for every server-derived row; a
// server-only entry that also required a surface would fail the writer's catalog assertion, and
// emitServerDerivedProductAnalyticsEvent turns that throw into a Sentry warning, so every row of
// that event would be dropped with nothing visible at ingest. A compile error on the catalog entry
// is the only form of that failure a person can act on.
type ProductAnalyticsEventSpec = ProductAnalyticsEventSpecIdentity &
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
  // The attachment itself, read against the `photo_library` and `camera` answers above: a person can
  // grant the permission, open the picker and still never attach anything, and until now the answer
  // was the last thing we knew about them.
  //
  // It is the asset landing on the draft or on the card, never the picker opening. A picker someone
  // backs out of is not an attachment, and analytics.product_events is append-only, so a row that
  // counted one could not be taken back.
  //
  // `source` repeats two of the `permission` values verbatim, so an attachment joins to its own
  // permission answer by equality; the two spellings have to stay identical for that join to keep
  // working. It names only the two origins an OS permission stands in front of, so an attach path
  // with no honest value here — a document import, a drag, a clipboard paste — reports nothing at
  // all rather than the nearest wrong one, and a per-source count is a floor under all attachments
  // rather than the total.
  //
  // Nothing describing the asset is reported: no file name, no dimensions, no byte size, no media
  // type. That an attachment happened is the fact; everything else is content a person chose.
  media_attached: {
    serverOnly: false,
    requiresScreen: true,
    properties: {
      source: { kind: "enum", values: ["photo_library", "camera"] },
    },
  },
  // The failure half, so an attachment that did not happen is countable against the ones that did.
  // A client reports both halves of a path or neither: a failure whose successes go unreported would
  // read as a failure rate rather than as the one-sided count it is.
  //
  // It carries no `source`, and no surface is required either, because a client only reports what it
  // observed: the preparation that fails is often already off the screen's own path, and the shared
  // rule is that a client which cannot name where the person is now sends no `screen` rather than a
  // guess. Every client that can name it stamps it as usual.
  //
  // `reason` is one value per terminal branch, and a client reports only the values its own code can
  // tell apart. `too_large` and `unsupported_type` come from a refusal the person can act on, and a
  // client that raises one error type for both reports the one it can prove; `server_error` is the
  // catch-all the other failure vocabularies here already use, meaning the attachment could not be
  // completed for a reason the person cannot act on. Every client mirror declares only the three
  // values its own code can reach, so an unreachable one cannot be typed at a call site.
  //
  // `offline`, `timeout` and `cancelled` are declared here with no producer yet. They belong to the
  // upload that reaches the network, which today is the media upload path and reports nothing here;
  // they stay in the vocabulary for it to fill. Until it does, a near-zero count on any of the three
  // is a producer that does not exist yet rather than a measurement.
  media_upload_failed: {
    serverOnly: false,
    requiresScreen: false,
    properties: {
      reason: {
        kind: "enum",
        values: ["offline", "timeout", "too_large", "unsupported_type", "server_error", "cancelled"],
      },
    },
  },
  // The analytics consent decision, which every other event in this catalog depends on having been
  // taken. They are three names rather than one answer with an outcome property because the shown
  // fact and the two answers are reported at different moments by different code paths, and because
  // two of them are `identityFree` above, which one answer carrying an outcome could not be: a
  // grant may be stored beside the id it produced. They are not `prompt_answered`: that event's
  // `prompt` enum repeats a surface verbatim so an answer joins to its own screen, and the consent
  // banner has no surface here because it is answered before a person is anywhere in the product.
  // They carry no properties for the same reason two of them carry no identity.
  consent_prompt_shown: {
    serverOnly: false,
    requiresScreen: false,
    identityFree: true,
    properties: {},
  },
  consent_granted: {
    serverOnly: false,
    requiresScreen: false,
    properties: {},
  },
  consent_declined: {
    serverOnly: false,
    requiresScreen: false,
    identityFree: true,
    properties: {},
  },
  // The two middle steps of the sign-in funnel, read against `signin_failed` below. Neither is
  // server-only, deliberately: the web funnel's producer is apps/auth, which is a server, but it
  // reports through the credential-free collector POST /v1/analytics/anonymous-events as a `web`
  // client, and `findClientReportableDefinition`
  // (apps/backend/src/productAnalytics/anonymousEvent.ts) rejects a serverOnly entry there outright
  // — the spec union above makes serverOnly together with requiresScreen unwritable in any case.
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
  // The end of a session's account relationship, the counterpart to `signin_succeeded`. It is the
  // client's own observation of losing its credential and never a report of server-side session
  // revocation, which happens with no client present to see it: a session revoked while nothing is
  // running produces no row here at all.
  //
  // Read every count as a floor. It is not a rate against `signin_succeeded`, and it is not one
  // series across clients. Every client wipes its analytics queue at the identity boundary that
  // follows a sign-out — queued events belong to the person leaving, and delivering them afterwards
  // would name the wrong person on this append-only table — so a row survives only where the client
  // drained its queue with the departing credential still live, before the teardown started. Three
  // consequences follow, and each is a property of the transport rather than a measurement:
  //
  // 1. `account_deleted` is undeliverable by construction on every client, the web included. The
  //    client observes it only once the account is already gone, and POST /v1/analytics/events
  //    answers `410 ACCOUNT_DELETED` for that credential before it reads the batch body. An empty
  //    `account_deleted` series therefore says the transport refuses the row, not that nobody
  //    deletes an account; the `account_deleted` event below, which is server-derived, is the fact
  //    that actually counts deletions. Only the web even emits it: on iOS and Android the emit
  //    would race a synchronous `anonymous_id` rotation whose only possible winner is a row filed
  //    under the *next* person's identity, so those two clients report nothing rather than risk
  //    one misattributed row that cannot be repaired.
  // 2. `credential_expired` is web-only, and not because mobile loses the row: iOS and Android
  //    have no producer for the value at all. Every teardown it would describe there — an expired
  //    credential, an account context that came back naming somebody else, a silent restore that
  //    did not resolve — is reached by code nobody pressed, so there is no control to hold a
  //    bounded wait on, and a row emitted at one of them would either be discarded by the identity
  //    boundary that immediately follows or survive it and be filed under the next person. Both
  //    clients therefore declare the value in their event mirrors and emit nothing. The one
  //    pressed teardown on those clients that still does not drain is the credential-recovery
  //    erase, and its reason is its own: the credential it would drain with is the one being
  //    erased, and where the recovery was entered because that credential is gone — every reason
  //    Android raises the gate for, and on iOS all but the one where the credential is fine and
  //    only the workspace went missing — there is nothing to drain with at all. No guest identity
  //    is created at that moment either, on either client: both refuse to mint one while a
  //    credential-recovery state is stored, and the erase is reachable only while one is. The web
  //    keeps its rows because its queue is persisted per browser and its visitor
  //    identity does not rotate at this boundary, so a tab sent back to sign in reports the fact
  //    and a later load delivers it.
  // 3. Mobile therefore contributes `user_initiated` and nothing else, from the deliberate sign-out
  //    control, which is the one place a person is standing in front of something that can show a
  //    bounded wait. Even there the wait is bounded at two seconds, so a large or offline backlog
  //    loses its tail.
  //
  // All three lose in the same direction deliberately. `analytics.product_events` is append-only
  // with no repair path, so every choice here prefers the under-count to a row that names the wrong
  // person or the wrong moment.
  //
  // Upstream of all three, an install whose person turned product analytics off contributes nothing
  // here under any reason. That switch gates the capture rather than the delivery, so the row is
  // never written in the first place: the web returns from `enqueue` on
  // `isProductAnalyticsCollecting()`, iOS gets nil from `makePendingEvent` and Android returns from
  // `track`, each on the flag that setting sets. The bounded wait above does not survive it either.
  // iOS and Android return from the drain on the same flag before it reaches the queue at all, and
  // the web's drain runs its first pass into a flush that returns on it, so the pass loop ends
  // there. Nobody who opted out is made to wait out a bound for a flush that could not have sent
  // anything. A client released before the switch existed is stopped one layer further on, where
  // POST /v1/analytics/events drops the batch for a credential whose owner holds false. So this
  // series counts departures only among people who left collection on, and a fall in it can be that
  // population shrinking rather than fewer sign-outs.
  //
  // The one place the floor does not hold is the reason split, which is not a partition of
  // departures: one departure can produce rows under two reasons in the same session, on the web.
  // The sign-out control's marker is per document, and the session cookie it destroys is shared by
  // the browser. A person with two tabs open presses Log out in one — `user_initiated` there — and
  // the other tab's next request answers 401 and reports `credential_expired`. A Back into a
  // pre-sign-out document restored from the bfcache does the same. Each row is true to its own
  // definition, so neither is suppressed, and both are honest facts about the document that wrote
  // them. But summing the reasons counts that departure twice, and `user_initiated` alone counts
  // it once, so read the reason series rather than the total.
  //
  // `screen` is optional and is not comparable across clients: the web stamps whatever surface its
  // current route resolves to and carries none where the route resolves to none, while iOS and
  // Android pass the surface the pressed control is on — `settings` for the account screen, and
  // `signin` for the sign-out offered inside the sign-in flow.
  signed_out: {
    serverOnly: false,
    requiresScreen: false,
    properties: {
      reason: {
        kind: "enum",
        values: [
          // The deliberate sign-out control, and the only one of the three the person chose.
          "user_initiated",
          // Stored credentials discarded by the client because they can no longer be used.
          "credential_expired",
          // `credential_expired`'s known cause: the credential is equally unusable, but the client
          // was told why, so the two are never folded together. See consequence 1 above for why
          // this value has no deliverable producer on any client.
          "account_deleted",
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
  // `source` is the channel that produced the answer, which `platform` does not carry: the app's own
  // review flow, the in-app AI chat, or an external agent. It is optional because the producer omits
  // it wherever it cannot resolve the channel, and rows stored before it existed carry none; the
  // mapping lives beside that producer in serverFacts/reviewAnswers.ts.
  review_answered: {
    serverOnly: true,
    requiresScreen: false,
    properties: {
      rating: { kind: "enum", values: ["again", "hard", "good", "easy"] },
      source: { kind: "enum", values: ["app", "ai_chat", "agent"], optional: true },
    },
  },
  review_answer_failed: {
    serverOnly: false,
    requiresScreen: false,
    properties: {
      reason: { kind: "enum", values: ["offline", "timeout", "sync_conflict", "server_error"] },
    },
  },
  // The reminder loop, one pair read against itself: `notification_scheduled` is the denominator
  // and `notification_opened` the return it produced. Neither OS tells an app whether a local
  // notification it accepted was ever shown, so delivery is not observed and the scheduled fact is
  // the only denominator there is; the gap between the two therefore folds "never delivered"
  // together with "delivered and ignored", and cannot separate them. The two clients also count
  // different sets: Android reports the reminders it enqueued, iOS only the ones Notification
  // Center read back as pending, so a per-platform gap between scheduled and opened partly reflects
  // scheduler drops that iOS excludes by construction.
  //
  // A client reconciles its reminders on many triggers — a permission change, a schedule edit, a
  // sync, a foreground return, every recorded review — and re-schedules the same slots every time,
  // so the producer owes exactly one row per distinct slot it schedules and nothing when
  // reconciliation re-schedules a slot it already reported. Without that the event would measure
  // reconciliation frequency rather than reminders. A slot is a fixed clock position for a daily or
  // strict reminder; an inactivity reminder is a chain re-anchored by every review, so its slot is
  // the local day and the position within that day, and a day already counted reports nothing when
  // its chain shifts — which under-counts a reminder that fires and is replaced the same day.
  //
  // That slot ledger is never cleared when the person on the device changes, so after a sign-out,
  // an account deletion or a server switch the arriving subject does not re-count the slots the
  // departing subject already reported: they stay uncounted until they expire, which under-counts
  // by at most one scheduling horizon per boundary. The direction is deliberate. Clearing the
  // ledger at the identity boundary would instead re-report live slots and inflate the
  // denominator, and `analytics.product_events` is append-only, so an inflated denominator has no
  // repair path while a missing row simply stays missing.
  //
  // `notification_opened` is its own name rather than a property on `app_opened` because migrations
  // 0121 and 0126 reconstructed `app_opened` rows from stored activity: a property added there would
  // read as a gap on every reconstructed row instead of as "this launch was not from a reminder".
  //
  // One spike is permanent and is named here rather than left to be rediscovered. The ledger that
  // carries those already-reported slot ids starts empty, so on every install the first reconcile
  // after the release that shipped this event reports the reminders the install already had pending
  // — up to seven review reminders in daily mode, as many as the review pending-request limit
  // allows in inactivity mode (26 with strict reminders on and 50 without on Android, 40 and 64 on
  // iOS), plus up to twenty-four strict — as newly scheduled. Nothing on the row separates them
  // from reminders scheduled for the first time, and the data that would is held only by the OS,
  // which does not say when it accepted a pending request. That is not corrected: the spike is one
  // release boundary wide, and `analytics.product_events` is append-only with no repair path.
  notification_scheduled: {
    serverOnly: false,
    requiresScreen: false,
    properties: {
      notification_kind: { kind: "enum", values: productAnalyticsNotificationKinds },
    },
  },
  notification_opened: {
    serverOnly: false,
    requiresScreen: false,
    properties: {
      notification_kind: { kind: "enum", values: productAnalyticsNotificationKinds },
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
  // pair. Nothing describing what was written is carried, because that would be content a person
  // typed; `card_created.source` is the one property here and it names the channel the server
  // observed the write through rather than anything about the card.
  card_created: {
    serverOnly: true,
    requiresScreen: false,
    properties: {
      // The channel the card was written through, which `platform` does not carry: the app's own
      // authoring, the in-app AI chat, an external agent, or a workspace package the person
      // imported. It is spelled exactly as `review_answered.source` where the two overlap, so a
      // creation and an answer from the same channel join by equality, and it is resolved the same
      // way - from the replica's actor kind - except where the writing transaction names its own
      // channel, which only the workspace-package import does.
      //
      // `catalog_install` has no producer and keeps none while installing stays separate from
      // authoring: an installed card is written by the install's own SQL and never reaches the
      // content writes producer at all (../catalog/distribution/install/persistence.ts), so the whole
      // install is reported once as `catalog_deck_installed` rather than as one creation per card.
      // The value is declared because it names the one channel this vocabulary would otherwise
      // leave unspellable, and a zero count on it is that decision rather than a measurement.
      //
      // Optional because the producer omits it wherever the channel cannot be resolved - a replica
      // the scoped read did not reach, an actor kind that is no channel a person writes through -
      // and because rows stored before it existed carry none. It is never guessed: `app` means a
      // client installation replica and nothing else.
      source: {
        kind: "enum",
        values: ["app", "ai_chat", "agent", "catalog_install", "package_import"],
        optional: true,
      },
    },
  },
  // One authoring edit a person made to a card, and the narrowest of the content facts. It is not
  // "the card row was written": the overwhelming majority of writes that reach `content.cards` are
  // reviews rescheduling a card, a workspace progress reset putting a whole library back to new, or
  // background managed-image settlement with no person acting at all, and counting those under an
  // authoring name would have made this series a disguised measure of review volume.
  //
  // WHAT AN AUTHORING EDIT IS. A write that left the card alive and left at least one of its front
  // text, back text and tags different from the value the server held before that write. Those
  // three fields are the whole definition. `card_type`, `metadata`, `created_at`, `due_at`, every
  // FSRS column and every sync bookkeeping column are out, so a review, a progress reset, a settled
  // managed image and a client re-syncing a library it has not touched report nothing whenever the
  // write leaves those three fields holding what the server already held. For two of those four
  // that is not merely ordinary but certain, because neither is a client push at all: a workspace
  // progress reset is a server-side UPDATE of scheduling columns only (../workspaces/management.ts)
  // and creates no client outbox entry on any of the three clients, and a settled managed image is
  // the other server-side write named just below - both reach neither collection point, so both
  // contribute exactly zero. Read a `card_updated` spike after a bulk reset as something else.
  // For the other two it is only what such a write ordinarily does, because a review and a re-sync
  // are each pushed as a whole card snapshot that carries authored text too, and stale text in that
  // snapshot reverts what the server held. A revert is a change and is counted - see OVER-COUNTS
  // below.
  //
  // The comparison is made against the row the database held, never against the request: the
  // clients are offline-first and push a full card snapshot on every write, so which fields a
  // request names carries no information about what changed.
  //
  // A person attaching media in a client IS counted, because the attachment is a markdown reference
  // written into the card's own text and pushed as an edit of that text, which is what it is. The
  // backend appending or settling a generated image is not: no person acted, and that path writes
  // `content.cards` through a statement of its own that reaches neither collection point
  // (../cards/managedMedia/managedImageSettlement.ts).
  //
  // ONE ROW IS ONE EDIT - not one card, and not one editing session. The event id is derived from
  // the card id and the writing operation's `last_operation_id` together. That deliberately does
  // not share the shape of `card_created` and `card_deleted`, which are keyed on the card alone
  // because a card is created once and is first tombstoned once; a card can be edited any number of
  // times, and an entity-only key would have counted cards ever edited instead. Two edits made
  // inside the same millisecond are two operations and stay two rows, which a timestamp-based key
  // would have collapsed.
  //
  // One edit is never two rows either, by two different mechanisms depending on where the write
  // came from. A sync push carries the client's own queued operation id, so a replayed push of one
  // edit derives the same event id and the writer's ON CONFLICT drops it. The agent surfaces mint a
  // fresh operation id per call, so a repeated agent call derives a different event id, and what
  // stops that counting twice is the comparison itself: the first call already stored the text the
  // second one sends, so the second finds nothing changed.
  //
  // DELETION AND RESURRECTION. A write that tombstones a live card reports `card_deleted` and no
  // edit, even when the same write also carried different text; a write over a card the server
  // already holds tombstoned reports nothing, because editing a tombstone is not authoring. A write
  // that brings a tombstoned card back alive with different text does report an edit, which is how
  // an offline edit that outranks another device's delete by last-write-wins lands, and how an
  // Android client that clears the tombstone on save lands. Since `card_deleted` counts a card once
  // ever, the two series can show an edit dated after that card's deletion, and can show one
  // deletion and a later edit for a card that is currently alive.
  //
  // A resurrection carrying the card's text unchanged reports nothing at all, and Android is the
  // one client that can produce it: its card repository clears the tombstone on save whether or not
  // the text moved, where iOS and web guard every local write on the card still being alive. It is
  // not a common shape even there, because it needs another device to have tombstoned the card and
  // needs the save that finds it to change none of the three authored fields. Nothing in the event
  // set marks a card as alive again, so that card's `card_deleted` stands alone forever with no
  // counter-signal, and `card_created` minus `card_deleted` under-counts the live library by every
  // card resurrected without an edit. Read that difference as a lower bound on the live library,
  // never as its size.
  //
  // UNDER-COUNTS, ALL DELIBERATE, because `analytics.product_events` is append-only with no repair
  // path and an inflated count could never be taken back. An edit that loses last-write-wins to
  // another device is discarded by the sync push before any row changes and is never counted - the
  // server never held that text. An edit folded into the same write as a deletion is counted only
  // as the deletion. Tags are compared without regard to order, so reordering a card's tags and
  // changing nothing else is not an edit. And any two edits a client collapses into one queued
  // operation before pushing are one row, because the server only ever sees the result.
  //
  // OVER-COUNTS, EACH KNOWN AND NONE OF THEM DELIBERATE. None is a bug in the comparison - the
  // stored authored text really did change - but each attributes an edit to something no person
  // authored, and on an append-only table with no repair path the disclosure is the whole remedy.
  //
  //  - A LAST-WRITE-WINS REVERT COUNTS AS AN EDIT, so a review can store `card_updated`. Every
  //    client push is a whole card snapshot, and the client freezes that snapshot into its outbox
  //    at the moment it queues the write, so a device holding text older than the server's sends
  //    the stale text and pulling before pushing cannot refresh an already-queued payload. The
  //    snapshot is stamped with the moment of the action that queued it, which outranks the stored
  //    version by last-write-wins, so the server's text is written back to what that device still
  //    held. The comparison sees a change because there was one.
  //    THE DOMINANT SOURCE OF THIS IS A SECOND DEVICE, not any one feature. One person edits a
  //    card's back text on a phone at 10:00; their laptop, which last pulled at 09:00, reviews that
  //    card at 10:05 and pushes at 10:06; the push wins, reverts the phone's edit, and stores a
  //    second `card_updated` attributed to a review. No server-side writer is involved. Size this
  //    noise by how many people review offline on a device that is behind, which is ordinary
  //    multi-device use.
  //    Backend managed-image append and settlement
  //    (../cards/managedMedia/managedImageSettlement.ts) opens the same window from the server
  //    side, and is one instance of the mechanism rather than its cause - much rarer, because it
  //    needs that AI feature. That one instance now has a narrow exception: the snapshot write
  //    reconciles managed-image references against the stored row before it stores anything
  //    (../cards/managedMedia/managedImageSnapshotMerge.ts). It puts back a reference the stored
  //    row still holds and the push dropped, and it settles a reference the push still carries in a
  //    stale lifecycle state - the `?state=pending` or `?state=failed` marker on a `fcasset:`
  //    destination - back to the state the stored row holds. Either way, a stale push whose ONLY
  //    difference from the stored text was that reference reproduces the stored text and the
  //    comparison sees no change at all. Where the restore half stops: the reference is put back as
  //    a trailing block, which reproduces the stored text only while the image is still the last
  //    thing on its side, so a later chat turn's prose, another device's note, or a partly removed
  //    second image after it all leave merged text that matches neither side, and one row is stored
  //    for a push that authored nothing. It also does not reach the device-to-device case above,
  //    where the server holds no reference to put back, or a stale push that also reverts a genuine
  //    edit. What the exception removes is the silent loss of the image behind the over-count in
  //    that window, not every managed-image loss: a stale snapshot of the same card in a LATER
  //    request is still honoured. That one is named at the merge.
  //    THE SETTLE HALF CARRIES AN UNDER-COUNT, recorded in this bullet rather than in the list
  //    above because the merge is what creates it. A push whose only authored difference from the
  //    stored text was a lifecycle query string the merge actually rewrites now stores that text
  //    byte for byte, so `cardAuthoringFieldsChanged` (../cards/mutations.ts) sees no change and no
  //    `card_updated` is stored at all, where before the merge that push stored one. The merge does
  //    not rewrite every such push, and a push it skips still stores its row: an asset the stored
  //    card names twice in two different states is ambiguous and left alone, and a reference in one
  //    of the wider shapes the backend pattern rejects is invisible to the merge. Both of those are
  //    reachable only by hand editing. Do not read the missing rows as lost edits: the lifecycle
  //    query string is server-owned state rather than authored text, and a person reaches it only
  //    by hand-editing the raw card Markdown in a card editor, an edit this merge settles back
  //    rather than counts. Web is one of the clients whose editor exposes that raw text, not the
  //    only one, so sizing these rows against web usage alone understates them. Two shapes, bounded
  //    separately: a stale device's push loses a row it should never have stored, which replaces an
  //    over-count rather than adding to the total error, while a hand edit of that string loses a
  //    row a person really did type. Only the first sits inside the same window as the over-count
  //    above; the hand edit needs no window, because a fully caught-up device whose person types a
  //    state differing from the stored one suppresses its row immediately.
  //  - A LEGACY EFFORT LEVEL BECOMES A TAG ON THE WAY IN, so a push that authored nothing can store
  //    an edit. The sync contract translates an older client's `effortLevel` on a card, and an
  //    older client's `effortLevels` inside a deck's filter, into ordinary tags before any write
  //    sees them (../sync/contracts/snapshots.ts). A still-shipping older client that sends
  //    `medium` or `long` for an entity whose stored tags do not already carry that tag has the tag
  //    appended server-side, the comparison sees the longer list, and one `card_updated` or
  //    `deck_updated` is stored for a snapshot carrying nothing a person changed. Bounded and
  //    legacy-only: modern clients send `fast`, which is never appended, and once the tag is stored
  //    the next push of that entity matches. One row per affected entity.
  //  - REMOVING A MANAGED IMAGE CAN GO UNCOUNTED THE FIRST TIME. This one is an under-count and it
  //    belongs to the merge above rather than to the list higher up, because the merge is what
  //    creates it. The server cannot tell a device that never pulled an image from a person who
  //    deleted one - nothing records what a replica has been sent - so it resolves the ambiguity by
  //    restoring once, and only against a stored row the pushing device did not itself write. That
  //    leaves the ordinary single-device case counted normally: pull the settled card, review it
  //    once, and that push already stamped the row with this device's replica, so the removal after
  //    it is honoured on the first attempt and reports its row. The restore fires when the stored
  //    row is someone else's - the settlement write itself, or another device - and even then the
  //    removal is silent only if the merged text comes back byte-identical to the stored text. That
  //    needs both conditions from the bullet above: the missing reference was the ONLY difference,
  //    and the image was still the trailing block on its side. Remove the image and edit a word in
  //    the same save, or leave anything after the image, and the first removal reports a row too.
  //    The second removal always stands and reports one. Bounded by how often anyone deletes an
  //    AI-generated image.
  //  - DROPPING A STORED DUPLICATE TAG COUNTS AS AN EDIT, once per affected card. The snapshot
  //    write path dedupes the tags it stores (`normalizeCardSnapshotInput` in
  //    ../cards/mutations.ts), so the first push that reaches a row written before that dedupe
  //    existed and still holding the same tag twice stores a shorter tag list than it found. The
  //    comparison is multiset-correct on purpose (../cards/shared.ts), so it sees that, correctly
  //    by its own definition and wrongly as a record of authoring. One row per such card, one
  //    time.
  //
  // NO BACKFILL, AND ONE OLDER COMMENT THIS ENTRY SUPERSEDES. Nothing has ever reconstructed these
  // two names, so the series begins when this producer shipped.
  // `db/migrations/0120_backfill_product_analytics_server_facts.sql` skipped them explicitly, and
  // the reason it gives at its line 239 - that the content producer emits creations only - was true
  // when 0120 was written and had already stopped being true before either of these two names
  // existed: `card_deleted` and `deck_deleted` shipped first and are what made it false. These two
  // names only make it false a second time. Migration comments are immutable, so it is corrected
  // here rather than there; what stands there is the decision not to backfill, not its reason.
  // Mind which neighbours that boundary applies to: 0120 reconstructed `card_created` and
  // `deck_created` and reaches back into history, while `card_deleted` and `deck_deleted` were
  // never backfilled either and begin at their own producer. Never read a reconstructed series
  // against a live-only one across the date its producer shipped.
  //
  // No property is carried, for the same reason the deletions carry none: anything describing what
  // changed would be content a person typed. Which channel the edit came through is not declared
  // either - `platform` already separates an agent edit from a device one, and `source` stays a
  // `card_created` property so that a value there always names how a card came to exist.
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
  // One authoring edit a person made to a deck, under the same boundary `card_updated` states in
  // full above: keyed on the deck id and the writing operation together so one row is one edit,
  // measured against the row the database held rather than against the request, and never
  // backfilled, so this series begins at its producer while `deck_created` reaches back into
  // history through 0120.
  //
  // A deck is a saved tag filter, so what a person authors about one is its name and the tags its
  // filter selects, and those two are the whole definition here. The filter definition carries
  // nothing else a person chose - its `version` is the stored shape - and a deck's `created_at` is
  // rewritten by the same statement without being authoring. A deletion re-sends the deck's own
  // stored name and filter, so it reports `deck_deleted` and no edit. Deck tags are compared
  // without regard to order, so a pure reordering is not counted.
  deck_updated: {
    serverOnly: true,
    requiresScreen: false,
    properties: {},
  },
  // The other end of a card's or a deck's life, derived from the tombstone the write left behind
  // rather than from the client that asked for it, exactly as the creations above are.
  //
  // One row per entity the server first saw tombstoned, keyed on the entity alone. The agent SQL
  // tool's single and bulk card and deck deletes are the only callers of the per-entity delete
  // path; every deletion a person makes on a client instead arrives as a snapshot carrying a
  // tombstone - a sync push, a bootstrap snapshot, or a guest merge - and is counted when it lands,
  // which is what keeps the offline-first clients inside the count at all. An entity created and
  // deleted before it ever synced alive arrives as a first write that is already a tombstone and
  // reports both its creation and its deletion, so those entities do not leave `card_created` minus
  // `card_deleted` overstating the live library.
  //
  // A tombstone for an entity the server already had tombstoned changes nothing and reports
  // nothing, so a client re-syncing its whole library cannot count one deletion twice. The same key
  // sets the one boundary in the other direction: an entity a client brings back by pushing a
  // snapshot with the tombstone cleared, and then deletes again, is still one row here, so these
  // count entities ever deleted rather than deletion actions.
  //
  // Nothing that removes content as a side effect is counted here. Deleting a workspace or an
  // account drops the workspace row and takes its cards and decks with it; those two decisions
  // report `workspace_deleted` and `account_deleted` below and a cascade never inflates these.
  // They carry no properties: anything describing what was deleted would be content a person typed,
  // and unlike `card_created` there is no channel worth naming, because the tombstone reaches the
  // server over whichever connection happened to sync it rather than over the one it was made on.
  card_deleted: {
    serverOnly: true,
    requiresScreen: false,
    properties: {},
  },
  deck_deleted: {
    serverOnly: true,
    requiresScreen: false,
    properties: {},
  },
  // The three destructive decisions a person can take about their own data, each reported by the
  // backend that carried it out and by nothing else. None carries a property: what was destroyed is
  // the person's own content, and the decision is the whole fact.
  //
  // `account_deleted` is the one event here that is stored and then rewritten by the transaction
  // that stored it. Account deletion collapses every row the person ever produced onto a single
  // anonymized user id and clears the identity columns beside them, so this row is written just
  // before that sweep and is swept with the rest; a row written after it would be the only one left
  // carrying the ids the deletion exists to remove. What that costs is countability by actor: each
  // deleted person's rows share a pseudonym minted for that one deletion and stored nowhere, so the
  // number of deletions is the number of rows and never a count of distinct users. It is also the
  // one event whose event_id is random rather than derived, because a derived id is a reproducible
  // function of its inputs and this catalog is public, so deriving it from the ids being erased
  // would hand anyone holding a user id a way back to that person's anonymized history.
  account_deleted: {
    serverOnly: true,
    requiresScreen: false,
    properties: {},
  },
  // One workspace the person deleted, which takes its cards, decks and review history with it. The
  // workspace row is gone by the time this is reported, so `workspace_id` names a workspace that no
  // longer exists and joins to nothing outside this table.
  workspace_deleted: {
    serverOnly: true,
    requiresScreen: false,
    properties: {},
  },
  // Every scheduling state in one workspace put back to new, keeping the cards themselves. Reported
  // only when the reset had something to reset: a confirmed reset of a workspace with nothing
  // scheduled writes nothing and reports nothing, so this counts resets that changed cards rather
  // than confirmations. The reset leaves no row of its own to key on, so the event is keyed on the
  // workspace and the instant: two resets of one workspace inside the same millisecond would count
  // as one, and nothing else can collide.
  study_progress_reset: {
    serverOnly: true,
    requiresScreen: false,
    properties: {},
  },
  // The product's own portability path, which nothing else in this catalog reports. An import also
  // produces one `card_created` per card carrying source `package_import`, so the two are readable
  // against each other everywhere the key below holds; an export produces no other fact at all,
  // because it writes nothing.
  //
  // `card_count` is what the import actually persisted, which makes it comparable with
  // `catalog_deck_installed.card_count`. The export carries nothing: the bytes leave the server and
  // what they hold is the person's own content, while the decision to take them is the fact.
  //
  // Neither operation is idempotent, so each entry counts what its key can enforce rather than what
  // a person decided. An import is keyed on the client's import id and counts distinct import ids:
  // the import mints fresh card ids on every call, so a client that retries one id writes a second
  // full library of cards and stores no second row here, and that is the one case where
  // `card_count` covers less than the creations carrying `package_import`. An export has no id and
  // no server state that makes a repeat a no-op, so it is keyed on the workspace and the instant
  // and counts export requests that produced bytes: a deliberate second export and a transport
  // retry of one whose response never arrived are alike two rows, and only two exports of one
  // workspace inside the same millisecond would collapse into one.
  workspace_package_imported: {
    serverOnly: true,
    requiresScreen: false,
    properties: {
      card_count: { kind: "nonNegativeInteger" },
    },
  },
  workspace_package_exported: {
    serverOnly: true,
    requiresScreen: false,
    properties: {},
  },
  // A person creating an API key for the terminal / AI-agent client, which is the moment that client
  // becomes usable for them at all. It is the connection being created and never a request the agent
  // later makes, so a key created and never used is still counted once here. Revoking one reports
  // nothing. The row carries no platform: the connection is created from a human-authenticated
  // client whose platform is a request header claim, and `agent` belongs to the facts that client
  // goes on to produce rather than to its creation.
  agent_connection_created: {
    serverOnly: true,
    requiresScreen: false,
    properties: {},
  },
  // One in-app feedback message that reached support.feedback_submissions. The prompt events the
  // same surface records are deliberately not reported: this counts the message a person chose to
  // send. Nothing about it is carried - the message is theirs, and the trigger, platform and locale
  // stored beside it are client claims that belong to the submission row rather than here.
  //
  // The submission is idempotent on the client's own id, so a resend is one message and not two.
  // The cost of that boundary is the other direction: a submission stored on a request that then
  // failed is counted only when the client sends it again, and not at all if it never does.
  feedback_submitted: {
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
  // The failure half of `ai_message_sent`, so a failed turn is countable against the turns that
  // were sent. Server-derived like its counterpart and for a stronger reason: a client cannot tell
  // a provider failure from its own dropped connection, and the run is finalized in the worker,
  // where no client is watching at all. Nothing of the prompt or the response is reported.
  //
  // One row per run the worker stores as `failed`, and nothing else. A run that ends `interrupted`
  // or `cancelled` reports nothing here by design: a stop the person asked for, a run past its
  // deadline, and a run whose worker disappeared and is repaired later by the stale recovery in
  // chat/runs/finalization.ts all reach a different terminal path. So this counts one terminal
  // status, not every turn a person saw fail, and reads as a floor under the chat failure rate
  // rather than the rate itself.
  //
  // `reason` repeats the category the worker already classifies the failure under in
  // chat/runtime/providerErrors.ts, which is also the category its lifecycle log carries, so a row
  // here and the log of the same run name the failure the same way. Every value is a distinction
  // the backend can already make; none is defined here for a report to group by.
  ai_run_failed: {
    serverOnly: true,
    requiresScreen: false,
    properties: {
      reason: {
        kind: "enum",
        values: [
          "provider_abort",
          "provider_auth",
          "provider_rate_limited",
          "provider_unavailable",
          "provider_error",
          "runtime_error",
        ],
      },
    },
  },
  // Voice input, which `permission_prompt_answered` could not stand in for: a granted microphone
  // permission says nothing about whether dictation is then used, and a dictation that fails after
  // the grant is invisible in that event entirely. Neither entry carries anything about the
  // recording — no transcript, no length, no duration, no confidence — because a transcript is
  // content a person spoke and this table is append-only.
  //
  // `dictation_started` is the attempt that reached the microphone. A producer emits it where
  // recording actually begins and never where the control was pressed, so a refused permission is a
  // failure below rather than a start with no end. It requires a surface because a person has to be
  // on the screen they are speaking into, so that surface is always known here, and voice usage is
  // only comparable between the places dictation is offered from if every producer names one.
  dictation_started: {
    serverOnly: false,
    requiresScreen: true,
    properties: {},
  },
  // Why one attempt ended without a transcript. Each value names a terminal branch a client really
  // reaches: `permission_denied` is the OS refusing the microphone or having already refused it,
  // `no_speech` a recording that contained nothing, `cancelled` the person stopping the attempt or
  // leaving the surface it was running on, `offline` and `timeout` the transport, and
  // `server_error` the remaining bucket — the same reading it carries on `sync_failed` and
  // `review_answer_failed`, so a recorder that refused to start is in it alongside a backend that
  // failed.
  //
  // It requires no surface, unlike the start above, and the producers fill it differently on
  // purpose. iOS and Android assert `ai`, the only surface those clients dictate from. Web takes
  // the surface the person is on, because its composer can be open over another route, so a
  // failure there can be filed against a route while its own start named `ai`.
  //
  // An unpaired `dictation_started` is not a measure of anything, on any client. There is no success
  // counterpart in this event set — a transcript reaching the draft reports nothing — so a start with
  // no `dictation_failed` after it is normally a dictation that worked. Deliberate abandonment is
  // not in the unpaired set either: it is the `cancelled` reason above, reported here rather than
  // left as a start with nothing after it.
  //
  // What web actually loses is narrower than both. An attempt already transcribing when the app's
  // IndexedDB recovery fires reports nothing at all: the in-flight call returns through the recovery
  // branch, and the unmount that the recovery causes only marks that attempt rather than reporting
  // it (apps/web/src/chat/composer/dictation/useChatDictationCapture.ts). A recording that has not
  // been stopped yet is still paired `cancelled` by the same unmount, and a session whose recovery
  // already failed cannot start a dictation at all. Nothing in the event set marks the attempts that
  // are lost, so their starts are indistinguishable from successful ones, and an unpaired-start
  // count bounds neither abandonment nor loss.
  dictation_failed: {
    serverOnly: false,
    requiresScreen: false,
    properties: {
      reason: {
        kind: "enum",
        values: ["permission_denied", "offline", "timeout", "server_error", "cancelled", "no_speech"],
      },
    },
  },
  // Bounded by the clients at one event per distinct key per failure episode, not one per failed
  // attempt: sync retries on a timer, so a per-attempt event would measure poll cadence rather than
  // failure incidence, and this table is append-only. Each client's gate holds its own key, and the
  // ceiling is one row per distinct value of that key and nothing else. A column a row carries is
  // not necessarily part of what bounded it: a client may stamp an ambient field such as `screen`
  // onto every event it sends while its gate keys on the reason alone, and that column then records
  // the episode's first failure of that reason rather than a dimension the count splits on. So rows
  // whose `screen` varies within one episode are not evidence that the screen is in the key, and the
  // exact key for any one client can be read only from that client's gate.
  //
  // Two limits follow, and both bite hardest on the failures worth finding. The episode gate is held
  // in memory for the lifetime of the client process and is never persisted, so it never bounds a
  // device: a device that never recovers emits again after every cold launch or page load instead of
  // once in total, and the row count moves with how often the app is opened as much as with how many
  // installs are stuck. Nor does it always bound a whole run — where sync is scoped per workspace
  // and per signed-in account, the episode is scoped the same way — so one run that fails on two
  // workspaces, or that switches account in place, reports each of them separately.
  //
  // And the analytics transport shares the host and the credential with sync itself, so a condition
  // that stops sync is also a condition that can keep its own report on the device. That is a
  // property of the shared transport rather than of any one reason, `offline`, `unauthorized` and
  // `server_error` being only its clearest cases. Those events arrive late, once the client
  // recovers, or not at all, which makes silence after a failure partly a delivery artifact rather
  // than evidence that sync recovered.
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
  // The marketing site facts. `package_version_id` is sent only on a `catalog_package` page.
  // `page_path` names which page of a kind was viewed, where `page_kind` names only the kind. It is
  // optional because the site bundles already released send no path at all, and a page whose
  // locale-stripped route does not fit the pattern reports none rather than a truncated one.
  // Reporting none means leaving the key out: an explicit `null` or `""` is a value the property
  // does not allow, and that refuses the whole event rather than just the path.
  site_page_viewed: {
    serverOnly: false,
    requiresScreen: false,
    properties: {
      page_kind: { kind: "enum", values: productAnalyticsSitePageKinds },
      page_path: { kind: "string", pattern: productAnalyticsSitePagePathPattern, optional: true },
      package_version_id: { kind: "string", pattern: productAnalyticsUuidPattern, optional: true },
      source: { kind: "enum", values: productAnalyticsSiteSources },
      device_category: { kind: "enum", values: productAnalyticsSiteDeviceCategories },
    },
  },
  site_app_entry_clicked: {
    serverOnly: false,
    requiresScreen: false,
    properties: productAnalyticsSiteAppEntryProperties,
  },
  // The impression half of `site_app_entry_clicked`, carrying exactly its properties so a click and
  // the view it came from join by equality and the click rate is a rate rather than a bare count.
  // The producer reports it at most once per target, placement and page kind per document load,
  // after about a second of visibility, the way `store_qr_shown` below is keyed on the store rather
  // than on the placement alone. Every property a click can vary on has to sit in that key, or the
  // clicks differing on the missing one join to nothing: a site placement is a container, and the
  // footer and the home platform grid each offer the web app, the App Store and Google Play side by
  // side, so `target` varies within one placement, while a client-side navigation inside one
  // document varies `page_kind`. The impression derives `source` and `device_category` exactly as
  // the click does, from the document's own referrer and user agent rather than from the page a
  // client-side navigation just left, which is what completes that three-property key: neither can
  // change inside one document load, so an impression and the click it precedes always agree on
  // them. A document that navigates between two pages of the same kind therefore reports one
  // impression and can produce a click on each page, so the ratio is per document load and can
  // exceed one in a multi-page visit. A CTA that stays visible across a client-side navigation has
  // to report again under the new page kind, because the key includes it and a producer keyed on
  // the element alone will not do so. The visibility delay keeps a CTA that only swept past during
  // a fast scroll out of the denominator; a CTA scrolled back into view is already covered by the
  // per-document key. The marketing site is its only producer.
  site_app_entry_shown: {
    serverOnly: false,
    requiresScreen: false,
    properties: productAnalyticsSiteAppEntryProperties,
  },
  // A marketing site CTA that leads to another marketing page instead of into the product, which is
  // why it is a fact of its own: a funnel that counted it as an app entry would credit an entry to a
  // visit that never left the site. It shares `page_kind`, `placement`, `source` and
  // `device_category` with the app-entry click value for value, so the two clicks compare directly on
  // those, while `target` names a different destination space and the two are disjoint on it by
  // design. It does not hold the app-entry map either: that map is shared only by the app-entry
  // click and its impression half, and this event has no impression half. `target` is an enum of one
  // because the site has exactly one such destination today, and naming it keeps the property set
  // from changing shape the day a second internal destination appears.
  site_internal_cta_clicked: {
    serverOnly: false,
    requiresScreen: false,
    properties: {
      target: { kind: "enum", values: ["home"] },
      page_kind: { kind: "enum", values: productAnalyticsSitePageKinds },
      placement: { kind: "string", pattern: productAnalyticsSitePlacementPattern },
      source: { kind: "enum", values: productAnalyticsSiteSources },
      device_category: { kind: "enum", values: productAnalyticsSiteDeviceCategories },
    },
  },
  // The catalog install facts. `install_journey_id` is optional everywhere it appears: no producer
  // mints one any more, and released clients that still send it stay valid.
  catalog_install_clicked: {
    serverOnly: false,
    requiresScreen: false,
    properties: {
      install_journey_id: { kind: "string", pattern: productAnalyticsUuidPattern, optional: true },
      package_version_id: { kind: "string", pattern: productAnalyticsUuidPattern },
      placement: { kind: "enum", values: ["top", "middle", "bottom"] },
      source: { kind: "enum", values: productAnalyticsSiteSources },
      device_category: { kind: "enum", values: productAnalyticsSiteDeviceCategories },
    },
  },
  // The four names below have no producer left: `catalog_install_landed` duplicated `screen_viewed`
  // and the three sign-in steps duplicated the generic `signin_*` facts above. They stay in the
  // catalog so released clients that still report them are stored rather than rejected.
  catalog_install_landed: {
    serverOnly: false,
    requiresScreen: false,
    properties: {
      install_journey_id: { kind: "string", pattern: productAnalyticsUuidPattern, optional: true },
      package_version_id: { kind: "string", pattern: productAnalyticsUuidPattern },
      auth_state: { kind: "enum", values: ["signed_in", "signed_out"] },
    },
  },
  catalog_install_signin_started: {
    serverOnly: false,
    requiresScreen: false,
    properties: {
      install_journey_id: { kind: "string", pattern: productAnalyticsUuidPattern, optional: true },
      package_version_id: { kind: "string", pattern: productAnalyticsUuidPattern },
    },
  },
  catalog_install_signin_code_requested: {
    serverOnly: false,
    requiresScreen: false,
    properties: {
      install_journey_id: { kind: "string", pattern: productAnalyticsUuidPattern, optional: true },
      package_version_id: { kind: "string", pattern: productAnalyticsUuidPattern },
    },
  },
  catalog_install_signin_succeeded: {
    serverOnly: false,
    requiresScreen: false,
    properties: {
      install_journey_id: { kind: "string", pattern: productAnalyticsUuidPattern, optional: true },
      package_version_id: { kind: "string", pattern: productAnalyticsUuidPattern },
    },
  },
  catalog_install_preview_ready: {
    serverOnly: false,
    requiresScreen: false,
    properties: {
      install_journey_id: { kind: "string", pattern: productAnalyticsUuidPattern, optional: true },
      package_version_id: { kind: "string", pattern: productAnalyticsUuidPattern },
    },
  },
  catalog_install_failed: {
    serverOnly: false,
    requiresScreen: false,
    properties: {
      install_journey_id: { kind: "string", pattern: productAnalyticsUuidPattern, optional: true },
      package_version_id: { kind: "string", pattern: productAnalyticsUuidPattern },
      stage: {
        kind: "enum",
        values: ["landing", "signin", "preview", "preinstall_sync", "install", "postinstall_sync"],
      },
      reason: {
        kind: "enum",
        values: [
          "invalid_link",
          "package_unavailable",
          "workspace_unavailable",
          "invalid_code",
          "expired_code",
          "code_already_used",
          "rate_limited",
          "offline",
          "timeout",
          "network_error",
          "unauthorized",
          "conflict",
          "storage_error",
          "contract_error",
          "server_error",
          "cancelled",
        ],
      },
    },
  },
  catalog_deck_install_started: {
    serverOnly: false,
    requiresScreen: false,
    properties: {
      package_slug: { kind: "string", pattern: productAnalyticsSlugPattern },
      install_journey_id: { kind: "string", pattern: productAnalyticsUuidPattern, optional: true },
      package_version_id: { kind: "string", pattern: productAnalyticsUuidPattern, optional: true },
    },
  },
  catalog_deck_installed: {
    serverOnly: true,
    requiresScreen: false,
    properties: {
      package_slug: { kind: "string", pattern: productAnalyticsSlugPattern },
      card_count: { kind: "nonNegativeInteger" },
      install_journey_id: { kind: "string", pattern: productAnalyticsUuidPattern, optional: true },
      package_version_id: { kind: "string", pattern: productAnalyticsUuidPattern, optional: true },
    },
  },
  // A click on a link that opens an app store. `placement` is spelled exactly as the store campaign
  // bucket (`ct=` / `utm_campaign=`, see docs/marketing-links.md) the link carries, so a click joins
  // to store-side campaign data by equality; the two spellings have to stay identical.
  store_link_clicked: {
    serverOnly: false,
    requiresScreen: false,
    properties: {
      store: { kind: "enum", values: ["app_store", "google_play"] },
      placement: {
        kind: "enum",
        values: ["web_app_header", "web_review_mobile_prompt", "catalog_import", "friend_invite", "share_app"],
      },
    },
  },
  // A store QR code that stays hidden until asked for was shown long enough to be read, about one
  // second, reported at most once per store per page load. Always-visible QR codes, such as the
  // platform links grid, never report it. `store` and `placement` read as on `store_link_clicked`.
  store_qr_shown: {
    serverOnly: false,
    requiresScreen: false,
    properties: {
      store: { kind: "enum", values: ["app_store", "google_play"] },
      placement: {
        kind: "enum",
        values: ["web_app_header", "web_review_mobile_prompt", "catalog_import", "friend_invite", "share_app"],
      },
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
  identityFree: boolean;
  propertyNames: ReadonlySet<string>;
  // Returns null when a declared property is missing or carries a value the catalog does not allow,
  // which includes nested objects and arrays because no property spec accepts them.
  parseProperties: (value: unknown) => ProductAnalyticsEventProperties | null;
}>;

function createRequiredPropertySchema(spec: ProductAnalyticsPropertySpec) {
  if (spec.kind === "enum") {
    return z.enum(spec.values);
  }

  if (spec.kind === "nonNegativeInteger") {
    return z.number().int().nonnegative();
  }

  return z.string().min(1).max(productAnalyticsPropertyStringMaxLength).regex(spec.pattern);
}

function createPropertySchema(spec: ProductAnalyticsPropertySpec) {
  const schema = createRequiredPropertySchema(spec);
  return spec.optional === true ? schema.optional() : schema;
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
    if (parsed.success === false) {
      return null;
    }

    const properties = parsed.data as ProductAnalyticsEventProperties;
    if (
      typeof properties.install_journey_id === "string"
      && typeof properties.package_version_id !== "string"
    ) {
      return null;
    }

    return properties;
  };
}

// Reads the optional identity rule off an entry that may not declare it, through the spec type so
// the absent case is the declared default rather than an untyped property access.
function isIdentityFreeEventSpec(spec: ProductAnalyticsEventSpec): boolean {
  return spec.identityFree === true;
}

function createEventDefinitions(): ReadonlyMap<string, ProductAnalyticsEventDefinition> {
  const definitions = new Map<string, ProductAnalyticsEventDefinition>();
  for (const [eventName, spec] of Object.entries(productAnalyticsEventCatalog)) {
    definitions.set(eventName, {
      eventName: eventName as ProductAnalyticsEventName,
      serverOnly: spec.serverOnly,
      requiresScreen: spec.requiresScreen,
      identityFree: isIdentityFreeEventSpec(spec),
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
