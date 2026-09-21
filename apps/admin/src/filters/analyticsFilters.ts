import {
  reviewEventCohorts,
  reviewEventPlatforms,
  type ReviewEventCohort,
  type ReviewEventPlatform,
} from "../adminApi";
import type {
  CatalogInstallDeviceCategory,
  CatalogInstallPlacement,
  CatalogInstallSource,
} from "../reports/catalogInstallFunnel/query";
import type { AnalyticsArea } from "../routing";

// The one filter vocabulary every analytics area shares. It is declarative on purpose: it names the
// fields, their defaults, where each one applies and how each one reads to a human, and nothing here
// knows about SQL, React or report loading.
//
// Two decisions the rest of the admin app depends on: every filter is applied server-side, so a
// selection always narrows the query rather than the rendered rows, and the whole selection lives in
// the URL, so a reload or a shared link reopens the same view. Every option field is a multi-select,
// and a field that does not apply to an area is not rendered there at all rather than rendered
// disabled.

export type AnalyticsDateRange = Readonly<{
  from: string;
  to: string;
}>;

// The event types a per-user threshold can be set on. Each one is a product event every area can
// count per user, which is what makes a "users with at least N of them" question answerable.
export const analyticsThresholdEventTypes = [
  "app_opened",
  "review_answered",
  "catalog_deck_installed",
] as const;

export type AnalyticsThresholdEventType = (typeof analyticsThresholdEventTypes)[number];

// What each counted event is called in the filter bar, because the stored event name is a producer
// contract rather than UI copy.
export const analyticsThresholdEventTypeLabels: Readonly<
  Record<AnalyticsThresholdEventType, string>
> = {
  app_opened: "App opens",
  review_answered: "Cards answered",
  catalog_deck_installed: "Catalog deck installs",
};

/** One threshold: the user must have produced at least `minimumCount` of `eventType` in range. */
export type AnalyticsMinimumEventCount = Readonly<{
  eventType: AnalyticsThresholdEventType;
  minimumCount: number;
}>;

/**
 * What a threshold count may be, for everything that reads or writes one: the filter bar, the URL
 * codec and the SQL builders.
 *
 * A threshold of zero is not a filter, and a count that is not an exactly representable integer does
 * not come back as itself: `app_opened:9007199254740993` would be read, and written back, as
 * `...992`, a different threshold from the one the URL carried.
 */
export function isAcceptedMinimumCount(minimumCount: number): boolean {
  return Number.isInteger(minimumCount)
    && minimumCount >= 1
    && minimumCount <= Number.MAX_SAFE_INTEGER;
}

/**
 * The same rule applied to a count that arrives as characters, which is how both the filter bar
 * input and the URL codec receive one.
 *
 * The text is judged before it is converted, because `Number` reinterprets rather than rejects:
 * `Number("1.")` is 1, `Number("1e3")` is 1000 and `Number("0x10")` is 16, so judging the converted
 * number alone would apply a threshold nobody typed and show no sign that the text was reread.
 * Only a run of digits is a count here; `isAcceptedMinimumCount` then keeps its range and precision
 * gate on the converted number, so `"0"` and a digit run past `Number.MAX_SAFE_INTEGER` are still
 * refused. Surrounding spaces and leading zeros are dropped rather than refused, because `" 5 "`
 * and `"007"` name 5 and 7 and nothing else.
 */
export function parseAcceptedMinimumCount(rawMinimumCount: string): number | undefined {
  const trimmedMinimumCount = rawMinimumCount.trim();
  if (/^[0-9]+$/.test(trimmedMinimumCount) === false) {
    return undefined;
  }

  const minimumCount = Number(trimmedMinimumCount);
  return isAcceptedMinimumCount(minimumCount) ? minimumCount : undefined;
}

/**
 * The complete filter selection of one analytics area.
 *
 * An empty list on an option field means "every value", except on `userCohorts` and
 * `eventPlatforms`, whose default is every value selected and where an empty list therefore means
 * "none" and matches nothing.
 */
export type AnalyticsFilterState = Readonly<{
  dateRange: AnalyticsDateRange;
  users: ReadonlyArray<string>;
  userCohorts: ReadonlyArray<ReviewEventCohort>;
  eventPlatforms: ReadonlyArray<ReviewEventPlatform>;
  minimumEventCounts: ReadonlyArray<AnalyticsMinimumEventCount>;
  connectionCountries: ReadonlyArray<string>;
  appUiLanguages: ReadonlyArray<string>;
  installedDecks: ReadonlyArray<string>;
  catalogPlacements: ReadonlyArray<CatalogInstallPlacement>;
  catalogSources: ReadonlyArray<CatalogInstallSource>;
  catalogDeviceCategories: ReadonlyArray<CatalogInstallDeviceCategory>;
  catalogClickBrowserLanguages: ReadonlyArray<string>;
}>;

export type AnalyticsFilterField = keyof AnalyticsFilterState;

// The order the filter bar offers the fields in, written as a record rather than as a list: a field
// added to `AnalyticsFilterState` stops this file compiling until it is given a place here, instead
// of silently missing from the bar. Object key order is the declaration order for these names.
const analyticsFilterFieldOrder = {
  dateRange: true,
  users: true,
  userCohorts: true,
  eventPlatforms: true,
  minimumEventCounts: true,
  connectionCountries: true,
  appUiLanguages: true,
  installedDecks: true,
  catalogPlacements: true,
  catalogSources: true,
  catalogDeviceCategories: true,
  catalogClickBrowserLanguages: true,
} as const satisfies Readonly<Record<AnalyticsFilterField, true>>;

/** Every field, in the order the filter bar offers them. */
export const analyticsFilterFields: ReadonlyArray<AnalyticsFilterField> = Object.keys(
  analyticsFilterFieldOrder,
) as Array<AnalyticsFilterField>;

// Funnels is keyed by the shared browser visitor identity and its top steps happen before sign-in,
// so the five identity-derived fields, each of which asks something only an account answers, cannot
// be answered there and are absent rather than empty. Every field takes a side here for the same
// reason the order above is exhaustive.
const funnelsAnalyticsFilterFieldApplicability = {
  dateRange: true,
  users: false,
  userCohorts: false,
  eventPlatforms: true,
  minimumEventCounts: false,
  connectionCountries: false,
  appUiLanguages: false,
  installedDecks: true,
  catalogPlacements: true,
  catalogSources: true,
  catalogDeviceCategories: true,
  catalogClickBrowserLanguages: true,
} as const satisfies Readonly<Record<AnalyticsFilterField, boolean>>;

const funnelsAnalyticsFilterFields: ReadonlyArray<AnalyticsFilterField> = analyticsFilterFields
  .filter((field) => funnelsAnalyticsFilterFieldApplicability[field]);

export const analyticsFilterFieldsByArea: Readonly<
  Record<AnalyticsArea, ReadonlyArray<AnalyticsFilterField>>
> = {
  general: analyticsFilterFields,
  funnels: funnelsAnalyticsFilterFields,
  audience: analyticsFilterFields,
};

// The wordings of the user-scoped areas, read through `getAnalyticsFilterFieldLabel` below rather
// than directly, exactly as the explanations are, so an area that renames a field cannot be missed
// by a call site.
const analyticsFilterFieldLabels: Readonly<Record<AnalyticsFilterField, string>> = {
  dateRange: "Date range of counted events",
  users: "Specific users",
  userCohorts: "New vs returning users",
  eventPlatforms: "Client platform of events",
  minimumEventCounts: "Users with at least N events",
  connectionCountries: "Connection country of the user",
  appUiLanguages: "App interface language of the user",
  installedDecks: "Catalog deck version",
  catalogPlacements: "Catalog link placement",
  catalogSources: "Catalog traffic source",
  catalogDeviceCategories: "Device category at catalog click",
  catalogClickBrowserLanguages: "Browser language at catalog click",
};

// What the four click-based catalog fields all have to say, because the evidence behind them is one
// and the same: the click that carries these values happens before sign-in, so it names nobody, and
// only a completed install bridges it to a person. The installed deck is not one of them - that is
// read from the install event itself, which needs no click at all.
//
// Cut from the on-screen text and kept here: narrowing a second of these click-based fields asks for
// one install whose own click carried every value picked, rather than for a user who matches each
// value somewhere in their history.
const catalogClickAttributionExplanationTail =
  "Attribution covers completed installs only, so a click that never became an install can never match here, and an install whose click was never recorded carries no click values at all.";

// Shown next to each filter, so it has to be readable by someone who never opens this code. These are
// the wordings of the user-scoped areas, where a row is a person or an event of a person; `funnels`
// overrides the ones whose meaning genuinely changes there.
//
// Two or three sentences each, on purpose: what the field counts, then the one thing that would
// mislead a reader who never saw the SQL. Everything else learned about a field lives in the comment
// above its entry, written for the next person editing this file rather than for a dashboard reader.
const analyticsFilterFieldExplanations: Readonly<Record<AnalyticsFilterField, string>> = {
  dateRange:
    "Counts only events whose UTC calendar day falls inside this range. Both the first and the last day are included, and the day is the UTC day rather than the reader's own.",
  users:
    "Keeps only events produced by the people you pick. The match is on the resolved actor id, so a guest and the account that guest became stay one person; picking nobody keeps every user.",
  // The on-screen sentence now carries the split rule itself, including the review-chart exception.
  // The rule it states is owned elsewhere and is deliberately not restated here: the catalog side of
  // it, the NULL cohort and the both-sides-only rule for an installer with no app open day in range
  // live in `apps/admin/src/reports/catalogInstalls/query.ts`, which also explains why that section
  // borrows the daily active users definition instead of having one of its own. The other rows with
  // no cohort of their own are the community rows of the review charts, which a narrowed selection
  // restricts to the actors that still have review events in range; that one is owned by
  // `isCohortOrPlatformNarrowed` in `apps/admin/src/filters/filterSql.ts`. Re-read the sentence
  // below against both whenever the cohort rule changes there. The one part of the rule the sentence
  // does qualify on screen is which app opens count as a person's at all, because a reader who is
  // told the cohort is the first app open day would otherwise read it as every stored app open;
  // `buildTrustedActorRowsFilterSql` owns that qualification.
  userCohorts:
    "Splits activity day by day: an event is new on that person's first ever app open day and returning on every later day, except on the review charts, which measure against their first answered card day instead. An app open the credential-free public collector wrote is not one of that person's, here or anywhere the dashboard counts people. One person therefore shows up as new once and as returning on the other days of the same range. Both sides are selected by default, and narrowing to one of them also drops the rows that carry no cohort of their own, so New and Returning need not add up to the unfiltered total.",
  // Cut from the on-screen text: the catalog install event is always unattributed rather than merely
  // often, so no device platform selection can ever keep one, while every other section keeps its
  // data because its events are judged by the platform their own row carries.
  eventPlatforms:
    "Keeps only events recorded on the client platforms you pick, read from the event row itself, where unattributed is the bucket for every event that carries no resolved device. The catalog install event never carries a platform, so picking any device platform empties the Catalog deck installs section.",
  // Cut from the on-screen text, and the expensive part of this field:
  // - app opens are counted as stored event rows, and reconstructed history adds at most one
  //   synthetic app open per person per UTC day, written only where the live client series holds
  //   nothing for that person-day;
  // - there is no calendar rollout date after which a range is clean, because the reconstruction was
  //   replayed onto days the clients were already reporting, so even a recent range mixes people
  //   whose every launch is counted with people on a build that does not emit the event, who reach
  //   one app open a day at most and are systematically dropped by any threshold above their number
  //   of active days;
  // - that last claim has an expiry the file cannot see: the "EXPECT A THIRD RUN" section of
  //   `db/migrations/0126_backfill_app_opened_rollout_gap.sql` expects one more replay once the store
  //   rollout has settled, and once it has run a recent-only range can be clean, so the third replay
  //   is the event after which the on-screen sentence about under-counted launches must be re-read;
  // - a threshold is a person-level property and is deliberately not narrowed by the platform
  //   selection, so somebody with one app open on iOS and two on the web clears a threshold of three
  //   while only iOS is picked;
  // - catalog deck installs are counted here exactly as the Catalog deck installs section counts
  //   them, so the delisted test deck and installs made by an active admin are left out here too.
  minimumEventCounts:
    "Keeps only users who produced at least the given number of each listed event inside the selected date range, and a user has to clear every listed threshold at once. It judges the person rather than the rows on screen and ignores the platform filter, so one app open on iOS and two on the web still clear a threshold of three app opens while only iOS is picked. App open counts mix live events with reconstructed history, so no range is free of people whose launches are under-counted.",
  // Cut from the on-screen text: a country is read from a retained connection sample matched to the
  // events uploaded in the same accepted batch, taken across every client platform whatever the
  // platform filter says, and one retained sample is enough for a user to match a country. The
  // Audience country charts stay narrowed to the platforms picked, so somebody this field keeps can
  // still be counted as unknown there.
  connectionCountries:
    "Keeps only users seen connecting from the countries you pick, so it is connection geography rather than residence or nationality. Detailed country history is kept for 90 days only, so a user with no retained sample in range matches no country at all and is dropped whenever this field is narrowed. Picking nothing keeps every country.",
  // Cut from the on-screen text: the locale is the one the client wrote on the event before queuing
  // it and is never inferred from the device language or the account, and it is read across every
  // client platform whatever the platform filter says. The Audience language charts stay narrowed to
  // the platforms picked, so somebody this field keeps can still be counted as unknown there.
  appUiLanguages:
    "Keeps only users whose events inside the selected date range recorded one of the app interface languages you pick, read from the UI locale the client wrote on the event. Old clients and old queued events carry no locale at all, so those users match no language and are dropped whenever this field is narrowed. Picking nothing keeps every language.",
  installedDecks:
    "Keeps only users who ever completed an install of one of the catalog deck versions you pick, counted over their whole history rather than only the selected date range. The version is read from the install itself, so an install whose catalog click was never recorded still counts.",
  catalogPlacements:
    "Keeps only users who completed a catalog install whose originating click came from one of the page placements you pick, counted over their whole history rather than only the selected date range."
    + ` ${catalogClickAttributionExplanationTail}`,
  catalogSources:
    "Keeps only users who completed a catalog install whose originating click was attributed to one of the traffic sources you pick, counted over their whole history rather than only the selected date range."
    + ` ${catalogClickAttributionExplanationTail}`,
  catalogDeviceCategories:
    "Keeps only users who completed a catalog install whose originating click came from one of the device categories you pick, counted over their whole history rather than only the selected date range."
    + ` ${catalogClickAttributionExplanationTail}`,
  catalogClickBrowserLanguages:
    "Keeps only users who completed a catalog install whose originating click reported one of the browser languages you pick, counted over their whole history; it is the browser setting at click time rather than the language the app is used in."
    + ` ${catalogClickAttributionExplanationTail}`,
};

// What the four click-based catalog fields have to admit on this area. Their option lists are read
// off the clicks themselves here, the same rows the predicates read, rather than through the
// completed-install bridge the user-scoped areas need; the one thing left to say is that they are not
// scoped to the selected dates. The installed deck is not one of them, because its list is read from
// the install alone and says so itself.
const funnelsCatalogOptionCoverageTail =
  "The values on offer are read from the clicks themselves and cover every day rather than only the selected ones, so a value that only clicks outside this range recorded is still listed and picking it empties the area.";

// Funnels counts one visitor identity and deck version per row, anchored at that identity's first
// catalog click for the deck inside the selected range, so the five catalog fields read off that
// anchoring click instead of a person's lifetime install history, and the platform is the click's own
// platform rather than every step's. The date range changes meaning too: it places a visit by its
// anchoring click and then lets the later steps run past the range, so the shared "only events inside
// these days" wording would be false here.
const funnelsAnalyticsFilterFieldExplanations: Readonly<
  Partial<Record<AnalyticsFilterField, string>>
> = {
  // Cut from the on-screen text: the two no-visit diagnostics place a preview or an install by its
  // own day the same way, and the seven-day tail is exactly what the "Visits still inside 7-day
  // window" line under the funnel counts, so a short recent window reads as a drop-off when it is
  // only immature.
  dateRange:
    "Selects a site visit by the catalog click that opens it rather than bounding every event counted here: a visitor and deck belong to this range when they made a catalog click on a UTC calendar day inside it, with the first and the last day both included, and the visit is anchored at the first such click. Every later step still counts for seven days after that click, so any step from the import screen to the review steps can have happened past the last selected day. A range whose last clicks are less than seven days old is therefore still filling rather than finished.",
  // Cut from the on-screen text: the no-visit preview diagnostic keeps previews by the preview row's
  // own platform the same way, and the no-visit install diagnostic reads the install row's platform,
  // which is always unattributed, so it empties as soon as any device platform is picked.
  eventPlatforms:
    "Keeps only the site visits whose own catalog click row carries one of the client platforms you pick; the later steps are never judged by it, so an install finished on another device still counts once that install and the click resolve to the same person. The public collector stamps every anonymous catalog click as web itself and no client can override it, so picking any other platform on its own empties this whole area.",
  // Cut from the on-screen text, in full, because it is the reason the option list and the matching
  // disagree: the list is built from deck versions somebody completed an install of, so three kinds
  // of version are missing from it while a click on them is still counted here - a version nobody
  // ever finished installing, a version whose only completed installs came from a test account or an
  // excluded actor, and the delisted `test` fixture, which is dropped from the list outright while an
  // visit aimed at it is excluded only when a matching install start inside the conversion window
  // named that slug, so a test click that never reached install start is still counted.
  installedDecks:
    "Keeps only the site visits aimed at one of the deck versions you pick, read from the visit's own catalog click inside the selected date range. The versions on offer are the ones somebody completed an install of, so a version can be missing from the list and still match visits here.",
  catalogPlacements:
    "Keeps only the site visits whose own catalog click came from one of the page placements you pick, inside the selected date range."
    + ` ${funnelsCatalogOptionCoverageTail}`,
  catalogSources:
    "Keeps only the site visits whose own catalog click was attributed to one of the traffic sources you pick, inside the selected date range."
    + ` ${funnelsCatalogOptionCoverageTail}`,
  catalogDeviceCategories:
    "Keeps only the site visits whose own catalog click came from one of the device categories you pick, inside the selected date range."
    + ` ${funnelsCatalogOptionCoverageTail}`,
  catalogClickBrowserLanguages:
    "Keeps only the site visits whose own catalog click reported one of the browser languages you pick, inside the selected date range; it is the browser setting at click time rather than the language the app is used in."
    + ` ${funnelsCatalogOptionCoverageTail}`,
};

// Audience renders neither the installs chart nor any other named section of General, so the shared
// platform wording would send a reader looking for a section that is not on this screen. The fact it
// carries is the same one, said without naming where it shows.
const audienceAnalyticsFilterFieldExplanations: Readonly<
  Partial<Record<AnalyticsFilterField, string>>
> = {
  // Cut from the on-screen text, as in the base wording: every other event is still judged by the
  // platform its own row carries, and only the catalog install event can never be kept.
  eventPlatforms:
    "Keeps only events recorded on the client platforms you pick, read from the event row itself, where unattributed is the bucket for every event that carries no resolved device. The catalog install event never carries a platform, so picking any device platform drops every catalog install row from anything that counts one.",
};

const analyticsFilterFieldExplanationOverridesByArea: Readonly<
  Record<AnalyticsArea, Readonly<Partial<Record<AnalyticsFilterField, string>>>>
> = {
  general: {},
  funnels: funnelsAnalyticsFilterFieldExplanations,
  audience: audienceAnalyticsFilterFieldExplanations,
};

/** What one filter means in one area, because the same field can count people or site visits. */
export function getAnalyticsFilterFieldExplanation(
  area: AnalyticsArea,
  field: AnalyticsFilterField,
): string {
  return analyticsFilterFieldExplanationOverridesByArea[area][field]
    ?? analyticsFilterFieldExplanations[field];
}

// A label has to be a full phrase somebody can read without opening this file, so a field whose
// subject genuinely changes in an area is renamed here rather than neutralised into a name that fits
// everywhere and says nothing. The date range is that field: on the user-scoped areas it bounds the
// events being counted, while on `funnels` it only places a visit by its opening click and the
// later steps run past it, which is what the explanation above says.
const funnelsAnalyticsFilterFieldLabels: Readonly<
  Partial<Record<AnalyticsFilterField, string>>
> = {
  dateRange: "Date range of the opening click",
};

const analyticsFilterFieldLabelOverridesByArea: Readonly<
  Record<AnalyticsArea, Readonly<Partial<Record<AnalyticsFilterField, string>>>>
> = {
  general: {},
  funnels: funnelsAnalyticsFilterFieldLabels,
  audience: {},
};

/** What one filter is called in one area, for the reason the explanation accessor above exists. */
export function getAnalyticsFilterFieldLabel(
  area: AnalyticsArea,
  field: AnalyticsFilterField,
): string {
  return analyticsFilterFieldLabelOverridesByArea[area][field]
    ?? analyticsFilterFieldLabels[field];
}

/** Every filter cleared on the supplied range: every user, every platform, and no threshold. */
export function buildDefaultAnalyticsFilterState(dateRange: AnalyticsDateRange): AnalyticsFilterState {
  return {
    dateRange,
    users: [],
    userCohorts: [...reviewEventCohorts],
    eventPlatforms: [...reviewEventPlatforms],
    minimumEventCounts: [],
    connectionCountries: [],
    appUiLanguages: [],
    installedDecks: [],
    catalogPlacements: [],
    catalogSources: [],
    catalogDeviceCategories: [],
    catalogClickBrowserLanguages: [],
  };
}

export function isAnalyticsFilterFieldApplicable(
  area: AnalyticsArea,
  field: AnalyticsFilterField,
): boolean {
  return analyticsFilterFieldsByArea[area].includes(field);
}
