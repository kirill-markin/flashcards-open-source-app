import {
  reviewEventCohorts,
  reviewEventPlatforms,
  type ReviewEventCohort,
  type ReviewEventPlatform,
} from "../adminApi";
import type { CatalogInstallPlacement } from "../reports/catalogInstallFunnel/query";
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

// How much of a version UUID the deck-version filter's summary shows to tell two picked versions of
// one deck apart.
export const deckVersionDiscriminatorLength = 8;

// The marketing site's acquisition vocabulary, as `productAnalyticsSiteDeviceCategories` and
// `productAnalyticsSiteSources` in `apps/backend/src/productAnalytics/catalog.ts` declare it. The
// catalog click fields read it too, off the site's `catalog_install_clicked`.
export const siteDeviceCategories = ["desktop", "mobile", "tablet", "unknown"] as const;
export const siteSources = ["direct", "search", "social", "ai_assistant", "referral", "internal", "unknown"] as const;

export type SiteDeviceCategory = (typeof siteDeviceCategories)[number];
export type SiteSource = (typeof siteSources)[number];

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
  /** The Funnels area's second range, drawn beside `dateRange` as series B; `null` is no comparison. */
  comparisonDateRange: AnalyticsDateRange | null;
  users: ReadonlyArray<string>;
  userCohorts: ReadonlyArray<ReviewEventCohort>;
  eventPlatforms: ReadonlyArray<ReviewEventPlatform>;
  minimumEventCounts: ReadonlyArray<AnalyticsMinimumEventCount>;
  connectionCountries: ReadonlyArray<string>;
  appUiLanguages: ReadonlyArray<string>;
  installedDecks: ReadonlyArray<string>;
  catalogPlacements: ReadonlyArray<CatalogInstallPlacement>;
  catalogSources: ReadonlyArray<SiteSource>;
  catalogDeviceCategories: ReadonlyArray<SiteDeviceCategory>;
  catalogClickBrowserLanguages: ReadonlyArray<string>;
  siteDeviceCategories: ReadonlyArray<SiteDeviceCategory>;
  siteSources: ReadonlyArray<SiteSource>;
  siteCountries: ReadonlyArray<string>;
  siteBrowserLanguages: ReadonlyArray<string>;
  sitePageKinds: ReadonlyArray<string>;
}>;

/** The fields that narrow marketing-site visitors by a value of their first page view. */
export type SiteVisitorFilterState = Pick<
  AnalyticsFilterState,
  "siteDeviceCategories" | "siteSources" | "siteCountries" | "siteBrowserLanguages" | "sitePageKinds"
>;

export const defaultSiteVisitorFilterState: SiteVisitorFilterState = {
  siteDeviceCategories: [],
  siteSources: [],
  siteCountries: [],
  siteBrowserLanguages: [],
  sitePageKinds: [],
};

/**
 * Every field the shared filter bar offers, which is every field of the selection: a field added to
 * `AnalyticsFilterState` stops this file compiling until it is given an order, an applicability, a
 * label and an explanation.
 */
export type AnalyticsFilterField = keyof AnalyticsFilterState;

// The order the filter bar offers the fields in, written as a record rather than as a list: a field
// added to `AnalyticsFilterState` stops this file compiling until it is given a place here, instead
// of silently missing from the bar. Object key order is the declaration order for these names.
const analyticsFilterFieldOrder = {
  dateRange: true,
  comparisonDateRange: true,
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
  siteDeviceCategories: true,
  siteSources: true,
  siteCountries: true,
  siteBrowserLanguages: true,
  sitePageKinds: true,
} as const satisfies Readonly<Record<AnalyticsFilterField, true>>;

/** Every field, in the order the filter bar offers them. */
export const analyticsFilterFields: ReadonlyArray<AnalyticsFilterField> = Object.keys(
  analyticsFilterFieldOrder,
) as Array<AnalyticsFilterField>;

// The Funnels bar is shared by every funnel on the area, so it offers only the fields they all
// share. The users, cohort and threshold fields ask something only an account answers, and a funnel's
// top steps happen before sign-in, so they are absent rather than empty. Every field takes a side here
// for the same reason the order above is exhaustive.
const funnelsAnalyticsFilterFieldApplicability = {
  dateRange: true,
  comparisonDateRange: true,
  users: false,
  userCohorts: false,
  eventPlatforms: true,
  minimumEventCounts: false,
  connectionCountries: true,
  appUiLanguages: true,
  installedDecks: false,
  catalogPlacements: false,
  catalogSources: false,
  catalogDeviceCategories: false,
  catalogClickBrowserLanguages: false,
  siteDeviceCategories: false,
  siteSources: false,
  siteCountries: false,
  siteBrowserLanguages: false,
  sitePageKinds: false,
} as const satisfies Readonly<Record<AnalyticsFilterField, boolean>>;

const funnelsAnalyticsFilterFields: ReadonlyArray<AnalyticsFilterField> = analyticsFilterFields
  .filter((field) => funnelsAnalyticsFilterFieldApplicability[field]);

// Review prompts count showings: a showing carries its own platform and belongs to one person, which
// is all these fields ask. The table draws no second series, and the person-level fields Funnels
// leaves out are left out here for the same reason.
const reviewPromptsAnalyticsFilterFields: ReadonlyArray<AnalyticsFilterField> = [
  "dateRange",
  "eventPlatforms",
  "connectionCountries",
  "appUiLanguages",
];

// Study depth counts reviews: a review carries its own platform, and the country and language judge
// its person, because a server-derived `review_answered` row records neither.
const studyDepthAnalyticsFilterFields: ReadonlyArray<AnalyticsFilterField> = [
  "dateRange",
  "eventPlatforms",
  "connectionCountries",
  "appUiLanguages",
];

// A prompt's Details page draws its funnels on a second range too, as the Funnels area does.
export const reviewPromptDetailsAnalyticsFilterFields: ReadonlyArray<AnalyticsFilterField> = [
  "dateRange",
  "comparisonDateRange",
  "eventPlatforms",
  "connectionCountries",
  "appUiLanguages",
];

// The Who saw us Web engaged page narrows its marketing-site visitors by their first page view.
export const webEngagedAnalyticsFilterFields: ReadonlyArray<AnalyticsFilterField> = [
  "dateRange",
  "siteDeviceCategories",
  "siteSources",
  "siteCountries",
  "siteBrowserLanguages",
  "sitePageKinds",
];

// General and Audience draw no second series a comparison range could fill, and count people rather
// than marketing-site visitors. Every field takes a side here for the same reason as on Funnels.
const userScopedAnalyticsFilterFieldApplicability = {
  dateRange: true,
  comparisonDateRange: false,
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
  siteDeviceCategories: false,
  siteSources: false,
  siteCountries: false,
  siteBrowserLanguages: false,
  sitePageKinds: false,
} as const satisfies Readonly<Record<AnalyticsFilterField, boolean>>;

const userScopedAnalyticsFilterFields: ReadonlyArray<AnalyticsFilterField> = analyticsFilterFields
  .filter((field) => userScopedAnalyticsFilterFieldApplicability[field]);

// `ai-usage` offers the date range and nothing else, and the omissions are a decision rather than
// unfinished wiring. That area plots one dot per person from two sources at once - review events and
// hosted AI chat messages - and a chat message answers none of the other fields: it carries no
// platform, no cohort, no catalog click and no UI locale of its own. A field applied there would
// therefore narrow the review half of every dot and leave the AI half whole, which moves people
// across the chart without removing them and is worse than not offering the field. The area says so
// on screen beside its own two controls.
const aiUsageAnalyticsFilterFields: ReadonlyArray<AnalyticsFilterField> = ["dateRange"];

// `level-1-metrics` offers the date range alone, by decision, except on the page that
// `webEngagedAnalyticsFilterFields` serves: its chart adds marketing-site visitors
// to store-reported aggregates, which carry no person, platform or locale a field could narrow.
const levelOneMetricsAnalyticsFilterFields: ReadonlyArray<AnalyticsFilterField> = ["dateRange"];

export const analyticsFilterFieldsByArea: Readonly<
  Record<AnalyticsArea, ReadonlyArray<AnalyticsFilterField>>
> = {
  "level-1-metrics": levelOneMetricsAnalyticsFilterFields,
  general: userScopedAnalyticsFilterFields,
  funnels: funnelsAnalyticsFilterFields,
  "review-prompts": reviewPromptsAnalyticsFilterFields,
  "study-depth": studyDepthAnalyticsFilterFields,
  audience: userScopedAnalyticsFilterFields,
  "ai-usage": aiUsageAnalyticsFilterFields,
};

// The wordings of the user-scoped areas, read through `getAnalyticsFilterFieldLabel` below rather
// than directly, exactly as the explanations are, so an area that renames a field cannot be missed
// by a call site.
const analyticsFilterFieldLabels: Readonly<Record<AnalyticsFilterField, string>> = {
  dateRange: "Date range of counted events",
  comparisonDateRange: "Compare with",
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
  siteDeviceCategories: "Device",
  siteSources: "Traffic source",
  siteCountries: "Country",
  siteBrowserLanguages: "Browser language",
  sitePageKinds: "Landing page type",
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
  // Offered on Funnels and on review prompt Details pages only.
  comparisonDateRange:
    "An optional second entry range, empty by default. When it is set, every funnel is counted again on it with every other filter unchanged, and drawn beside the main range as series B, each series measured from its own first step.",
  users:
    "Keeps only events produced by the people you pick. The match is on the resolved actor id, so a guest and the account that guest became stay one person; picking nobody keeps every user.",
  // The on-screen sentence now carries the split rule itself, including its one exception.
  // The rule it states is owned elsewhere and is deliberately not restated here: the catalog side of
  // it, the NULL cohort and the both-sides-only rule for an installer with no app open day in range
  // live in `apps/admin/src/reports/catalogInstalls/query.ts`, which also explains why that section
  // borrows the Who opened the app definition instead of having one of its own. The other rows with
  // no cohort of their own are the community rows of Social connections, which a narrowed selection
  // restricts to the actors that still have review events in range; that one is owned by
  // `isCohortOrPlatformNarrowed` in `apps/admin/src/filters/filterSql.ts`. Re-read the sentence
  // below against both whenever the cohort rule changes there. The one part of the rule the sentence
  // does qualify on screen is which app opens count as a person's at all, because a reader who is
  // told the cohort is the first app open day would otherwise read it as every stored app open;
  // `buildTrustedActorRowsFilterSql` owns that qualification.
  userCohorts:
    "Splits activity day by day: an event is new on that person's first ever app open day and returning on every later day, except on Social connections, which measures against a person's first answered card day instead. An app open the credential-free public collector wrote is not one of that person's, here or anywhere the dashboard counts people. One person therefore shows up as new once and as returning on the other days of the same range. Both sides are selected by default, and narrowing to one of them also drops the rows that carry no cohort of their own, so New and Returning need not add up to the unfiltered total.",
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
  //   them, so the delisted test deck is left out here too. It is the only exclusion the threshold
  //   restates: every actor the one exclusion rule drops - an example.com or +test account, anyone
  //   who has ever held an admin grant, an actor on the exclusion list, an actor with an automated
  //   collector row - is already gone from every set of users a threshold is applied to, by
  //   `buildExcludedActorSqlLines` in `apps/admin/src/filters/filterSql.ts`.
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
  // Offered on the Who saw us Web engaged page only. The unit is the one every chart there counts a
  // visitor once in, the rule `buildSiteFirstViewsCtesSql` owns.
  siteDeviceCategories:
    "Keeps only the visitors whose first page view in the bar, or in the day for a cookieless visitor, came from a device category you pick, so a visitor who later switches devices counts only under the first. The site reads it from the browser's user agent: tablets include iPads that report themselves as a Mac, and an Android tablet in desktop-site mode counts as desktop. Picking nothing keeps every device.",
  siteSources:
    "Keeps only the visitors whose first page view in the bar, or in the day for a cookieless visitor, arrived from a traffic source you pick, so a visitor who later comes back another way counts only under the first. The site classifies it from the page's referrer: ai_assistant is a known AI assistant site, such as chatgpt.com, or a link whose utm_source names one, and internal is a link from another page of the site. Picking nothing keeps every source.",
  siteCountries:
    "Keeps only the visitors whose first page view in the bar, or in the day for a cookieless visitor, came from a country you pick, the one the site's collector derived from the request of that view. Views stored before late September 2026, and requests it could not place, are Unknown. Picking nothing keeps every country.",
  siteBrowserLanguages:
    "Keeps only the visitors whose first page view in the bar, or in the day for a cookieless visitor, reported a browser language you pick: the language part of the browser's locale, such as en from en-US, not the language of the page they opened. A view without a reported locale is Unknown. Picking nothing keeps every language.",
  sitePageKinds:
    "Keeps only the visitors whose first page view in the bar, or in the day for a cookieless visitor, was on a page type you pick, as the site reports it, such as home or blog_article. Picking nothing keeps every page type.",
};

// The date range changes meaning on most funnels: it places an entry by the event that anchors it and
// then lets the later steps run past the range, so the shared "only events inside these days" wording
// would be false here.
const funnelsAnalyticsFilterFieldExplanations: Readonly<
  Partial<Record<AnalyticsFilterField, string>>
> = {
  dateRange:
    "Selects who enters most funnels by the UTC calendar day of the event that anchors them rather than bounding every event counted here, with the first and the last day both included. Their later steps still count for at least seven days after that anchoring event, so it can have happened past the last selected day, and a range whose last days are less than seven days old is still filling rather than finished. The anchor is a person's first app launch on iOS, Android or web in the first launch funnel, a person's first deck install inside the range for the deck funnel's review steps, their first sign-in method choice in the sign-in funnel, and their first paywall shown in the paywall funnel. The deck funnel's page view, click and install steps count only events inside the range. The blog funnel has no anchor: it counts the people who viewed a blog article inside the selected days, and each later step only inside those same days.",
  eventPlatforms:
    "In the first launch funnel, keeps only the people whose first app launch was on one of the platforms you pick, so a selection without iOS, Android or web empties it. In the blog funnel, reads the blog article page view, which the site always reports as web, so a selection without web empties it. In the deck funnel, narrows the deck page views and install clicks, which the public collector stamps as web itself, so picking any other platform on its own empties those two steps; a server install carries no platform, so the install and review steps ignore it.",
  // Every funnel applies both on the identity it counts, the way General applies them; a
  // cookieless visitor of the deck and blog funnels has no identity and answers both from the row.
  connectionCountries:
    "Narrows every funnel to people seen connecting from the countries you pick, which is connection geography rather than residence or nationality. Picking nothing keeps every country.",
  appUiLanguages:
    "Narrows every funnel to people whose events recorded one of the app interface languages you pick. Picking nothing keeps every language.",
};

// A showing is placed by its own day and platform, while Acted and Gone look past it, so the shared
// "only events inside these days" wording would be false here.
const reviewPromptsAnalyticsFilterFieldExplanations: Readonly<
  Partial<Record<AnalyticsFilterField, string>>
> = {
  dateRange:
    "Counts the prompts shown on the UTC calendar days inside this range, with the first and the last day both included. Acted and Gone still look at what the person did after each showing, for up to seven days and longer for a paywall's first payment, so they can count days after the last selected one.",
  comparisonDateRange:
    "An optional second range of showings, empty by default. When it is set, every funnel on a prompt's Details page is counted again on it with every other filter unchanged, and drawn beside the main range as series B; the daily outcome chart stays on the main range.",
  eventPlatforms:
    "Keeps only the showings recorded on the client platforms you pick, read from the showing itself. Each prompt runs only on some platforms, so a selection without them empties its row.",
  connectionCountries:
    "Keeps only showings of people seen connecting from the countries you pick, which is connection geography rather than residence or nationality. Picking nothing keeps every country.",
  appUiLanguages:
    "Keeps only showings of people whose events inside the selected date range recorded one of the app interface languages you pick. Picking nothing keeps every language.",
};

// The range picks the cohort by each person's first review, and everything after it is counted up to
// now, so the shared "only events inside these days" wording would be false here.
const studyDepthAnalyticsFilterFieldExplanations: Readonly<
  Partial<Record<AnalyticsFilterField, string>>
> = {
  dateRange:
    "Selects the cohort: the people whose first counted review falls on a UTC calendar day inside this range, both ends included. Their reviews and review days are then counted over their whole history up to now, past the last selected day. It opens on all time.",
  eventPlatforms:
    "Counts only the reviews recorded on the client platforms you pick, read from the review itself, so a person's first review is their first one on those platforms and their totals count only those reviews. A review with no resolved device is unattributed.",
  connectionCountries:
    "Keeps only people seen connecting from the countries you pick inside the selected range, which is connection geography rather than residence or nationality. A review carries no country of its own, so this judges the person and keeps all of their reviews. Detailed country history is kept for 90 days only. Picking nothing keeps every country.",
  appUiLanguages:
    "Keeps only people whose events inside the selected range recorded one of the app interface languages you pick. A review carries no language of its own, so this judges the person and keeps all of their reviews. Picking nothing keeps every language.",
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

// The range is what the periods are cut out of rather than a plain event window, and the panels are
// anchored at its recent end, so the field says where the remainder falls off.
const aiUsageAnalyticsFilterFieldExplanations: Readonly<
  Partial<Record<AnalyticsFilterField, string>>
> = {
  dateRange:
    "The span the equal-length periods are cut out of. They are anchored at the recent end, so the most recent period is always whole and any leftover days fall off the old end of this range rather than forming a short panel.",
};

// The store series are dated by the store's own report day rather than by an event, and their range can
// start long before the website's, so the shared wording would be false here.
const levelOneMetricsAnalyticsFilterFieldExplanations: Readonly<
  Partial<Record<AnalyticsFilterField, string>>
> = {
  dateRange:
    "Shows only the UTC calendar days inside this range, both ends included. Website days come from page views and store days from the App Store and Google Play daily reports, so All time starts on the earliest day any of them has data.",
};

const analyticsFilterFieldExplanationOverridesByArea: Readonly<
  Record<AnalyticsArea, Readonly<Partial<Record<AnalyticsFilterField, string>>>>
> = {
  "level-1-metrics": levelOneMetricsAnalyticsFilterFieldExplanations,
  general: {},
  funnels: funnelsAnalyticsFilterFieldExplanations,
  "review-prompts": reviewPromptsAnalyticsFilterFieldExplanations,
  "study-depth": studyDepthAnalyticsFilterFieldExplanations,
  audience: audienceAnalyticsFilterFieldExplanations,
  "ai-usage": aiUsageAnalyticsFilterFieldExplanations,
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
// events being counted, while on `funnels` it only places an entry by the event that anchors it, and
// the later steps run past it, which is what the explanation above says.
const funnelsAnalyticsFilterFieldLabels: Readonly<
  Partial<Record<AnalyticsFilterField, string>>
> = {
  dateRange: "Date range of the entry",
};

const aiUsageAnalyticsFilterFieldLabels: Readonly<
  Partial<Record<AnalyticsFilterField, string>>
> = {
  dateRange: "Date range the periods are cut from",
};

const levelOneMetricsAnalyticsFilterFieldLabels: Readonly<
  Partial<Record<AnalyticsFilterField, string>>
> = {
  dateRange: "Date range of the days shown",
};

const analyticsFilterFieldLabelOverridesByArea: Readonly<
  Record<AnalyticsArea, Readonly<Partial<Record<AnalyticsFilterField, string>>>>
> = {
  "level-1-metrics": levelOneMetricsAnalyticsFilterFieldLabels,
  general: {},
  funnels: funnelsAnalyticsFilterFieldLabels,
  "review-prompts": { dateRange: "Date range of the showing" },
  "study-depth": { dateRange: "First review of the person" },
  audience: {},
  "ai-usage": aiUsageAnalyticsFilterFieldLabels,
};

/** What one filter is called in one area, for the reason the explanation accessor above exists. */
export function getAnalyticsFilterFieldLabel(
  area: AnalyticsArea,
  field: AnalyticsFilterField,
): string {
  return analyticsFilterFieldLabelOverridesByArea[area][field]
    ?? analyticsFilterFieldLabels[field];
}

/**
 * Every filter cleared on the supplied range: every user, every platform, no threshold, and the
 * funnels with no comparison range.
 */
export function buildDefaultAnalyticsFilterState(dateRange: AnalyticsDateRange): AnalyticsFilterState {
  return {
    dateRange,
    comparisonDateRange: null,
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
    ...defaultSiteVisitorFilterState,
  };
}

export function isAnalyticsFilterFieldApplicable(
  area: AnalyticsArea,
  field: AnalyticsFilterField,
): boolean {
  return analyticsFilterFieldsByArea[area].includes(field);
}
