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

/** One threshold: the user must have produced at least `minimumCount` of `eventType` in range. */
export type AnalyticsMinimumEventCount = Readonly<{
  eventType: AnalyticsThresholdEventType;
  minimumCount: number;
}>;

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

/** Every field, in the order the filter bar offers them. */
export const analyticsFilterFields: ReadonlyArray<AnalyticsFilterField> = [
  "dateRange",
  "users",
  "userCohorts",
  "eventPlatforms",
  "minimumEventCounts",
  "connectionCountries",
  "appUiLanguages",
  "installedDecks",
  "catalogPlacements",
  "catalogSources",
  "catalogDeviceCategories",
  "catalogClickBrowserLanguages",
];

// Funnels is keyed by an anonymous `install_journey_id` and its top steps happen before sign-in, so
// the five identity-derived fields cannot be answered there and are absent rather than empty.
const funnelsAnalyticsFilterFields: ReadonlyArray<AnalyticsFilterField> = [
  "dateRange",
  "eventPlatforms",
  "installedDecks",
  "catalogPlacements",
  "catalogSources",
  "catalogDeviceCategories",
  "catalogClickBrowserLanguages",
];

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
    "Keeps only users who produced at least the given number of each listed event inside the selected date range, and a user has to clear every listed threshold at once.",
  connectionCountries:
    "Keeps only users seen connecting from the countries you pick, taken from retained connection samples, so it is connection geography rather than residence or nationality; picking nothing keeps every country.",
  appUiLanguages:
    "Keeps only events whose recorded app interface language is one you pick, read from the UI locale the client sent with the event itself.",
  installedDecks:
    "Keeps only users who ever completed an install of one of the catalog deck versions you pick, counted over their whole history rather than only inside the selected date range.",
  catalogPlacements:
    "Keeps only users who completed a catalog install whose originating click came from one of the page placements you pick, counted over their whole history rather than only inside the selected date range.",
  catalogSources:
    "Keeps only users who completed a catalog install whose originating click was attributed to one of the traffic sources you pick, counted over their whole history rather than only inside the selected date range.",
  catalogDeviceCategories:
    "Keeps only users who completed a catalog install whose originating click came from one of the device categories you pick, counted over their whole history rather than only inside the selected date range.",
  catalogClickBrowserLanguages:
    "Keeps only users who completed a catalog install whose originating click reported one of the browser languages you pick, counted over their whole history; it is the browser setting at click time rather than the language the app is used in.",
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
