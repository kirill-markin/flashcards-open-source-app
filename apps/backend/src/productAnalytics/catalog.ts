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
  site_page_viewed: {
    serverOnly: false,
    requiresScreen: false,
    properties: {
      page_kind: { kind: "enum", values: productAnalyticsSitePageKinds },
      package_version_id: { kind: "string", pattern: productAnalyticsUuidPattern, optional: true },
      source: { kind: "enum", values: productAnalyticsSiteSources },
      device_category: { kind: "enum", values: productAnalyticsSiteDeviceCategories },
    },
  },
  site_app_entry_clicked: {
    serverOnly: false,
    requiresScreen: false,
    properties: {
      target: { kind: "enum", values: ["web_app", "app_store", "google_play"] },
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
