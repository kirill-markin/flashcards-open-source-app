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

// Funnels is keyed by an anonymous `install_journey_id` and its top steps happen before sign-in, so
// the five identity-derived fields cannot be answered there and are absent rather than empty. Every
// field takes a side here for the same reason the order above is exhaustive.
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

export const analyticsFilterFieldLabels: Readonly<Record<AnalyticsFilterField, string>> = {
  dateRange: "Date range of counted events",
  users: "Specific users",
  userCohorts: "New vs returning users",
  eventPlatforms: "Client platform of events",
  minimumEventCounts: "Users with at least N events",
  connectionCountries: "Connection country",
  appUiLanguages: "App UI language",
  installedDecks: "Installed deck",
  catalogPlacements: "Catalog link placement",
  catalogSources: "Catalog traffic source",
  catalogDeviceCategories: "Device category at catalog click",
  catalogClickBrowserLanguages: "Browser language at catalog click",
};

// What the four click-based catalog fields all have to say, because the evidence behind them is one
// and the same: the click that carries these values happens before sign-in, so it names nobody, and
// only a completed install bridges it to a person. The installed deck is not one of them - that is
// read from the install event itself, which needs no click at all.
const catalogClickAttributionExplanationTail =
  "A click that never became an install names nobody, because the click happens before sign-in, so it can never match here, and an install whose click was never recorded carries no click values at all; narrowing a second of these click-based fields asks for one install whose own click carried every value you picked.";

// Shown next to each filter, so it has to be readable by someone who never opens this code. These are
// the wordings of the user-scoped areas, where a row is a person or an event of a person; `funnels`
// overrides the ones whose meaning genuinely changes there.
const analyticsFilterFieldExplanations: Readonly<Record<AnalyticsFilterField, string>> = {
  dateRange:
    "Counts only events whose UTC calendar day falls inside this range, with the first and the last day both included.",
  users:
    "Keeps only events produced by the people you pick, matched on the resolved actor id so a guest and the account that guest became stay one person; picking nobody keeps every user.",
  userCohorts:
    "Splits activity day by day: an event is new when its UTC day is that person's first ever day of the activity the chart counts, so the first day they opened the app on the active user charts and the first day they answered a card on the review charts, and returning on every later day, which is why one person shows up as new once and as returning on the other days of the same range; catalog installs are the exception, where an install takes the side of the installer's first app open day and an installer with no app open day inside the range belongs to neither side and is kept only while both sides are selected; both sides are selected by default.",
  eventPlatforms:
    "Keeps only events recorded on the client platforms you pick, read from the event row itself, where unattributed is the bucket for every event that carries no resolved device.",
  minimumEventCounts:
    "Keeps only users who produced at least the given number of each listed event inside the selected date range, and a user has to clear every listed threshold at once; catalog deck installs are counted exactly as the Catalog deck installs section counts them, so the delisted test deck and installs made by an active admin are left out here too.",
  connectionCountries:
    "Keeps only users seen connecting from the countries you pick, so it is connection geography rather than residence or nationality: a country is read from a retained connection sample matched to the events uploaded in the same accepted batch, taken across every client platform whatever the platform filter says, and a user matches a country as soon as one retained sample says so. Detailed country history is kept for 90 days only, so a user with no retained sample in range matches no country at all and narrowing this field drops those people systematically, the more of them the longer the range. The Audience country charts stay narrowed to the platforms you picked, so somebody this field keeps can still be counted as unknown there; picking nothing keeps every country.",
  appUiLanguages:
    "Keeps only users whose events inside the selected date range recorded one of the app interface languages you pick, read from the UI locale the client wrote on the event before queuing it and never inferred from the device language or the account, and taken across every client platform whatever the platform filter says; old clients and old queued events carry no locale at all, so a user whose events in range carry none matches no language and is dropped whenever this field is narrowed. The Audience language charts stay narrowed to the platforms you picked, so somebody this field keeps can still be counted as unknown there; picking nothing keeps every language.",
  installedDecks:
    "Keeps only users who ever completed an install of one of the catalog deck versions you pick, counted over their whole history rather than only inside the selected date range, and read from the install itself so an install whose catalog click was never recorded still counts.",
  catalogPlacements:
    "Keeps only users who completed a catalog install whose originating click came from one of the page placements you pick, counted over their whole history rather than only inside the selected date range."
    + ` ${catalogClickAttributionExplanationTail}`,
  catalogSources:
    "Keeps only users who completed a catalog install whose originating click was attributed to one of the traffic sources you pick, counted over their whole history rather than only inside the selected date range."
    + ` ${catalogClickAttributionExplanationTail}`,
  catalogDeviceCategories:
    "Keeps only users who completed a catalog install whose originating click came from one of the device categories you pick, counted over their whole history rather than only inside the selected date range."
    + ` ${catalogClickAttributionExplanationTail}`,
  catalogClickBrowserLanguages:
    "Keeps only users who completed a catalog install whose originating click reported one of the browser languages you pick, counted over their whole history; it is the browser setting at click time rather than the language the app is used in."
    + ` ${catalogClickAttributionExplanationTail}`,
};

// Funnels counts one anonymous catalog click attempt per row, so the five catalog fields read off the
// attempt's own click inside the selected range instead of a person's lifetime install history. Every
// other field keeps the shared wording, which is already true of both.
const funnelsAnalyticsFilterFieldExplanations: Readonly<
  Partial<Record<AnalyticsFilterField, string>>
> = {
  installedDecks:
    "Keeps only the catalog click attempts aimed at one of the deck versions you pick, read from the attempt's own click inside the selected date range.",
  catalogPlacements:
    "Keeps only the catalog click attempts whose own click came from one of the page placements you pick, inside the selected date range.",
  catalogSources:
    "Keeps only the catalog click attempts whose own click was attributed to one of the traffic sources you pick, inside the selected date range.",
  catalogDeviceCategories:
    "Keeps only the catalog click attempts whose own click came from one of the device categories you pick, inside the selected date range.",
  catalogClickBrowserLanguages:
    "Keeps only the catalog click attempts whose own click reported one of the browser languages you pick, inside the selected date range; it is the browser setting at click time rather than the language the app is used in.",
};

const analyticsFilterFieldExplanationOverridesByArea: Readonly<
  Record<AnalyticsArea, Readonly<Partial<Record<AnalyticsFilterField, string>>>>
> = {
  general: {},
  funnels: funnelsAnalyticsFilterFieldExplanations,
  audience: {},
};

/** What one filter means in one area, because the same field can count people or click attempts. */
export function getAnalyticsFilterFieldExplanation(
  area: AnalyticsArea,
  field: AnalyticsFilterField,
): string {
  return analyticsFilterFieldExplanationOverridesByArea[area][field]
    ?? analyticsFilterFieldExplanations[field];
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
