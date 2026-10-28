import {
  reviewEventCohorts,
  reviewEventPlatforms,
  type ReviewEventCohort,
  type ReviewEventPlatform,
} from "../adminApi";
import { catalogInstallPlacements, type CatalogInstallPlacement } from "../reports/catalogInstallFunnel/query";
import {
  allTimeReportRangePreset,
  buildDefaultReportRange,
  buildPresetReportRange,
} from "../reports/reportValues";
import type { AnalyticsArea } from "../routing";
import {
  analyticsThresholdEventTypes,
  buildDefaultAnalyticsFilterState,
  defaultSiteVisitorFilterState,
  isAcceptedMinimumCount,
  parseAcceptedMinimumCount,
  siteDeviceCategories,
  siteSources,
  type AnalyticsDateRange,
  type AnalyticsFilterState,
  type AnalyticsMinimumEventCount,
  type AnalyticsThresholdEventType,
  type SiteDeviceCategory,
  type SiteSource,
  type SiteVisitorFilterState,
} from "./analyticsFilters";

// The URL codec for `AnalyticsFilterState`. The selection lives in the query string, so a reload or a
// shared link reopens the same view, and the two functions here are inverses of each other.
//
// Writing omits every field that still holds its default, so a default view carries no filter
// parameters at all. Reading is tolerant of anything a person can type into an address bar: an
// unknown, repeated or malformed parameter is ignored and that field keeps its default. A list
// parameter is never repaired, because dropping one bad entry out of a list would silently hand back
// a different selection from the one the URL asked for. The date ranges are the exception: each is
// clamped onto the available data, and only a window that does not overlap it at all falls back, the
// main range to its default and the comparison range to none.
//
// Every option field is an unordered multi-select, so both directions put its values back into one
// canonical order first: the declared option order for the closed enums, plain sorting for the
// open-ended ones. Without that, re-picking a value the user had just unpicked would reorder the list
// and write a parameter for a view that is not filtered at all. Both directions also derive the
// defaults from the same `buildDefaultAnalyticsFilterStateForAvailableRange`, which is what makes the
// inverse hold rather than depend on a caller building matching defaults by hand.

const analyticsFilterReportLabel = "Analytics filters";

const dateRangeFromParamName = "from";
const dateRangeToParamName = "to";
const comparisonDateRangeFromParamName = "compare-from";
const comparisonDateRangeToParamName = "compare-to";
const usersParamName = "users";
const userCohortsParamName = "cohorts";
const eventPlatformsParamName = "platforms";
const minimumEventCountsParamName = "min-events";
const connectionCountriesParamName = "countries";
const appUiLanguagesParamName = "languages";
const installedDecksParamName = "decks";
const catalogPlacementsParamName = "placements";
const catalogSourcesParamName = "sources";
const catalogDeviceCategoriesParamName = "device-categories";
const catalogClickBrowserLanguagesParamName = "click-languages";
const siteDeviceCategoriesParamName = "site-devices";
const siteSourcesParamName = "site-sources";
const siteCountriesParamName = "site-countries";
const siteBrowserLanguagesParamName = "site-languages";
const sitePageKindsParamName = "site-page-types";

const listSeparator = ",";
const minimumEventCountSeparator = ":";
const calendarDatePattern = /^(\d{4})-(\d{2})-(\d{2})$/u;

function isCalendarDate(value: string): boolean {
  const match = calendarDatePattern.exec(value);
  if (match === null) {
    return false;
  }

  const year = Number.parseInt(match[1], 10);
  const monthIndex = Number.parseInt(match[2], 10) - 1;
  const day = Number.parseInt(match[3], 10);
  const parsedDate = new Date(Date.UTC(year, monthIndex, day));

  return parsedDate.getUTCFullYear() === year
    && parsedDate.getUTCMonth() === monthIndex
    && parsedDate.getUTCDate() === day;
}

function areStringListsEqual(
  left: ReadonlyArray<string>,
  right: ReadonlyArray<string>,
): boolean {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}

// The invariant `isAcceptedListEntry` and the imported count rule hold up: everything a normalizer
// emits must survive a write-then-read round trip unchanged. They are the only places that decide
// what a list entry and what a threshold count may be, and both directions go through them, so the
// writer cannot emit a value the reader throws the whole parameter away over. The count rule has
// two faces of one definition, `isAcceptedMinimumCount` for the number the writer normalizes and
// `parseAcceptedMinimumCount` for the text the reader receives, and the digits the writer emits for
// an accepted number are exactly the text that rule accepts back.

/** An entry is written verbatim between separators, so an empty or padded one cannot come back. */
function isAcceptedListEntry(entry: string): boolean {
  return entry !== "" && entry === entry.trim();
}

// A closed enum selection is canonical in the order the options are declared in, which is also the
// order the filter bar lists them in, so the URL reads the way the popover looks.
function normalizeEnumList<Value extends string>(
  values: ReadonlyArray<Value>,
  optionOrder: ReadonlyArray<Value>,
): ReadonlyArray<Value> {
  const selectedValues: ReadonlySet<string> = new Set<string>(values);
  return optionOrder.filter((option) => selectedValues.has(option));
}

// Users, decks, countries and locale tags are open sets with no declared order, so sorting is the
// canonical order available to them. A repeated entry collapses and an entry the reader does not
// accept is dropped, because either one makes the reader treat the whole list as malformed and hand
// back the default instead of the selection that was written. A padded entry is trimmed rather than
// dropped: client-reported locale tags reach the selection as they were recorded, and losing such a
// value silently would leave it checked in its option list and gone after a reload.
function normalizeOpaqueList(values: ReadonlyArray<string>): ReadonlyArray<string> {
  return [...new Set(values.map((value) => value.trim()).filter(isAcceptedListEntry))].sort();
}

// Thresholds are an unordered AND of at most one entry per event type, so they follow the declared
// event type order for the same reason. Two entries naming one event type collapse to the strictest
// of them, the highest count, and a count the reader does not accept is dropped: either shape makes
// the reader drop every threshold rather than the offending entry.
function normalizeMinimumEventCounts(
  entries: ReadonlyArray<AnalyticsMinimumEventCount>,
): ReadonlyArray<AnalyticsMinimumEventCount> {
  return analyticsThresholdEventTypes.flatMap((
    eventType,
  ): ReadonlyArray<AnalyticsMinimumEventCount> => {
    const minimumCounts = entries
      .filter((entry) => entry.eventType === eventType)
      .map((entry) => entry.minimumCount)
      .filter(isAcceptedMinimumCount);

    return minimumCounts.length === 0
      ? []
      : [{ eventType, minimumCount: Math.max(...minimumCounts) }];
  });
}

function areMinimumEventCountsEqual(
  left: ReadonlyArray<AnalyticsMinimumEventCount>,
  right: ReadonlyArray<AnalyticsMinimumEventCount>,
): boolean {
  return left.length === right.length
    && left.every((entry, index) => entry.eventType === right[index].eventType
      && entry.minimumCount === right[index].minimumCount);
}

// An empty list is written as a present but empty parameter, which is how "none selected" stays
// distinguishable from "parameter absent" on the fields whose default is every value selected. Both
// lists arrive canonical, so this compares two selections rather than two orderings.
function setNormalizedListParam(
  searchParams: URLSearchParams,
  paramName: string,
  values: ReadonlyArray<string>,
  defaultValues: ReadonlyArray<string>,
): void {
  if (areStringListsEqual(values, defaultValues)) {
    return;
  }

  searchParams.set(paramName, values.join(listSeparator));
}

function setOpaqueListParam(
  searchParams: URLSearchParams,
  paramName: string,
  values: ReadonlyArray<string>,
  defaultValues: ReadonlyArray<string>,
): void {
  setNormalizedListParam(
    searchParams,
    paramName,
    normalizeOpaqueList(values),
    normalizeOpaqueList(defaultValues),
  );
}

function setEnumListParam<Value extends string>(
  searchParams: URLSearchParams,
  paramName: string,
  values: ReadonlyArray<Value>,
  defaultValues: ReadonlyArray<Value>,
  optionOrder: ReadonlyArray<Value>,
): void {
  setNormalizedListParam(
    searchParams,
    paramName,
    normalizeEnumList(values, optionOrder),
    normalizeEnumList(defaultValues, optionOrder),
  );
}

function formatMinimumEventCount(entry: AnalyticsMinimumEventCount): string {
  return `${entry.eventType}${minimumEventCountSeparator}${entry.minimumCount}`;
}

/**
 * The window an area opens on. Study depth opens on all time, because its cohort is people by their
 * first review and a recent window would hold only people who started too late to come back.
 */
export function buildAnalyticsAreaDefaultDateRange(
  area: AnalyticsArea,
  availableRange: AnalyticsDateRange,
): AnalyticsDateRange {
  return area === "study-depth"
    ? buildPresetReportRange(allTimeReportRangePreset, availableRange, analyticsFilterReportLabel)
    : buildDefaultReportRange(availableRange, analyticsFilterReportLabel);
}

/** Every filter cleared, on the area's default window of the range the data actually covers. */
export function buildDefaultAnalyticsFilterStateForAvailableRange(
  area: AnalyticsArea,
  availableRange: AnalyticsDateRange,
): AnalyticsFilterState {
  return buildDefaultAnalyticsFilterState(buildAnalyticsAreaDefaultDateRange(area, availableRange));
}

/**
 * The canonical form of the option fields of a selection: exactly what writing them to the URL and
 * reading them back gives. Both ranges are passed through untouched, because canonicalizing them takes
 * the `availableRange` this function is not given; the parsers validate them on the way in and
 * `assertValidDateRange` refuses them on the way to a report.
 *
 * The filter bar puts every selection it builds through this, so a value the codec would drop or
 * reorder cannot stay on screen as a checked option and a popover header and then change on the next
 * reload.
 */
export function normalizeAnalyticsFilterState(state: AnalyticsFilterState): AnalyticsFilterState {
  return {
    dateRange: state.dateRange,
    comparisonDateRange: state.comparisonDateRange,
    users: normalizeOpaqueList(state.users),
    userCohorts: normalizeEnumList(state.userCohorts, reviewEventCohorts),
    eventPlatforms: normalizeEnumList(state.eventPlatforms, reviewEventPlatforms),
    minimumEventCounts: normalizeMinimumEventCounts(state.minimumEventCounts),
    connectionCountries: normalizeOpaqueList(state.connectionCountries),
    appUiLanguages: normalizeOpaqueList(state.appUiLanguages),
    installedDecks: normalizeOpaqueList(state.installedDecks),
    catalogPlacements: normalizeEnumList(state.catalogPlacements, catalogInstallPlacements),
    catalogSources: normalizeEnumList(state.catalogSources, siteSources),
    catalogDeviceCategories: normalizeEnumList(state.catalogDeviceCategories, siteDeviceCategories),
    catalogClickBrowserLanguages: normalizeOpaqueList(state.catalogClickBrowserLanguages),
    ...normalizeSiteVisitorFilterState(state),
  };
}

/** The site visitor fields of `normalizeAnalyticsFilterState`, for a selection that holds only those. */
export function normalizeSiteVisitorFilterState(state: SiteVisitorFilterState): SiteVisitorFilterState {
  return {
    siteDeviceCategories: normalizeEnumList(state.siteDeviceCategories, siteDeviceCategories),
    siteSources: normalizeEnumList(state.siteSources, siteSources),
    siteCountries: normalizeOpaqueList(state.siteCountries),
    siteBrowserLanguages: normalizeOpaqueList(state.siteBrowserLanguages),
    sitePageKinds: normalizeOpaqueList(state.sitePageKinds),
  };
}

/** Writes the site visitor fields that differ from their default; `parseSiteVisitorFilterState` reads them back. */
export function setSiteVisitorFilterParams(
  searchParams: URLSearchParams,
  state: SiteVisitorFilterState,
): void {
  setEnumListParam(
    searchParams,
    siteDeviceCategoriesParamName,
    state.siteDeviceCategories,
    defaultSiteVisitorFilterState.siteDeviceCategories,
    siteDeviceCategories,
  );
  setEnumListParam(
    searchParams,
    siteSourcesParamName,
    state.siteSources,
    defaultSiteVisitorFilterState.siteSources,
    siteSources,
  );
  setOpaqueListParam(
    searchParams,
    siteCountriesParamName,
    state.siteCountries,
    defaultSiteVisitorFilterState.siteCountries,
  );
  setOpaqueListParam(
    searchParams,
    siteBrowserLanguagesParamName,
    state.siteBrowserLanguages,
    defaultSiteVisitorFilterState.siteBrowserLanguages,
  );
  setOpaqueListParam(
    searchParams,
    sitePageKindsParamName,
    state.sitePageKinds,
    defaultSiteVisitorFilterState.sitePageKinds,
  );
}

/** Writes both ends only when the range differs from `defaultDateRange`; `parseDateRange` reads them back. */
export function setDateRangeParams(
  searchParams: URLSearchParams,
  dateRange: AnalyticsDateRange,
  defaultDateRange: AnalyticsDateRange,
): void {
  if (dateRange.from !== defaultDateRange.from || dateRange.to !== defaultDateRange.to) {
    searchParams.set(dateRangeFromParamName, dateRange.from);
    searchParams.set(dateRangeToParamName, dateRange.to);
  }
}

export function toAnalyticsFilterSearchParams(
  state: AnalyticsFilterState,
  availableRange: AnalyticsDateRange,
  area: AnalyticsArea,
): URLSearchParams {
  const defaults = buildDefaultAnalyticsFilterStateForAvailableRange(area, availableRange);
  const searchParams = new URLSearchParams();

  setDateRangeParams(searchParams, state.dateRange, defaults.dateRange);
  if (state.comparisonDateRange !== null) {
    searchParams.set(comparisonDateRangeFromParamName, state.comparisonDateRange.from);
    searchParams.set(comparisonDateRangeToParamName, state.comparisonDateRange.to);
  }

  setOpaqueListParam(searchParams, usersParamName, state.users, defaults.users);
  setEnumListParam(
    searchParams,
    userCohortsParamName,
    state.userCohorts,
    defaults.userCohorts,
    reviewEventCohorts,
  );
  setEnumListParam(
    searchParams,
    eventPlatformsParamName,
    state.eventPlatforms,
    defaults.eventPlatforms,
    reviewEventPlatforms,
  );

  const minimumEventCounts = normalizeMinimumEventCounts(state.minimumEventCounts);
  if (
    areMinimumEventCountsEqual(
      minimumEventCounts,
      normalizeMinimumEventCounts(defaults.minimumEventCounts),
    ) === false
  ) {
    searchParams.set(
      minimumEventCountsParamName,
      minimumEventCounts.map(formatMinimumEventCount).join(listSeparator),
    );
  }

  setOpaqueListParam(
    searchParams,
    connectionCountriesParamName,
    state.connectionCountries,
    defaults.connectionCountries,
  );
  setOpaqueListParam(
    searchParams,
    appUiLanguagesParamName,
    state.appUiLanguages,
    defaults.appUiLanguages,
  );
  setOpaqueListParam(
    searchParams,
    installedDecksParamName,
    state.installedDecks,
    defaults.installedDecks,
  );
  setEnumListParam(
    searchParams,
    catalogPlacementsParamName,
    state.catalogPlacements,
    defaults.catalogPlacements,
    catalogInstallPlacements,
  );
  setEnumListParam(
    searchParams,
    catalogSourcesParamName,
    state.catalogSources,
    defaults.catalogSources,
    siteSources,
  );
  setEnumListParam(
    searchParams,
    catalogDeviceCategoriesParamName,
    state.catalogDeviceCategories,
    defaults.catalogDeviceCategories,
    siteDeviceCategories,
  );
  setOpaqueListParam(
    searchParams,
    catalogClickBrowserLanguagesParamName,
    state.catalogClickBrowserLanguages,
    defaults.catalogClickBrowserLanguages,
  );
  setSiteVisitorFilterParams(searchParams, state);

  return searchParams;
}

/** The single value of a parameter, or `undefined` when it is absent or given more than once. */
export function readSingleParam(
  searchParams: URLSearchParams,
  paramName: string,
): string | undefined {
  const values = searchParams.getAll(paramName);
  return values.length === 1 ? values[0] : undefined;
}

/**
 * The entries of a comma-joined parameter, `[]` for a present but empty one, and `undefined` when the
 * parameter is absent or malformed. Padded, empty and repeated entries make the whole parameter
 * malformed rather than being cleaned up one by one.
 */
function readListParam(
  searchParams: URLSearchParams,
  paramName: string,
): ReadonlyArray<string> | undefined {
  const rawValue = readSingleParam(searchParams, paramName);
  if (rawValue === undefined) {
    return undefined;
  }

  if (rawValue === "") {
    return [];
  }

  const entries = rawValue.split(listSeparator);
  const hasMalformedEntry = entries.some((entry) => isAcceptedListEntry(entry) === false);
  if (hasMalformedEntry || new Set(entries).size !== entries.length) {
    return undefined;
  }

  return entries;
}

function parseOpaqueList(
  searchParams: URLSearchParams,
  paramName: string,
  defaultValues: ReadonlyArray<string>,
): ReadonlyArray<string> {
  return normalizeOpaqueList(readListParam(searchParams, paramName) ?? defaultValues);
}

function parseEnumList<Value extends string>(
  searchParams: URLSearchParams,
  paramName: string,
  allowedValues: ReadonlyArray<Value>,
  defaultValues: ReadonlyArray<Value>,
): ReadonlyArray<Value> {
  const entries = readListParam(searchParams, paramName);
  if (entries === undefined) {
    return normalizeEnumList(defaultValues, allowedValues);
  }

  const allowedValueSet: ReadonlySet<string> = new Set<string>(allowedValues);
  const parsedValues = entries.filter(
    (entry): entry is Value => allowedValueSet.has(entry),
  );

  return normalizeEnumList(
    parsedValues.length === entries.length ? parsedValues : defaultValues,
    allowedValues,
  );
}

const thresholdEventTypeValues: ReadonlySet<string> = new Set<string>(analyticsThresholdEventTypes);

function isThresholdEventType(value: string): value is AnalyticsThresholdEventType {
  return thresholdEventTypeValues.has(value);
}

// The count reaches this side as text, so it is judged as text, by the same
// `parseAcceptedMinimumCount` the filter bar's input uses. `app_opened:1.` and `app_opened:1e3` are
// therefore entries this reader does not accept rather than thresholds of 1 and 1000: the parameter
// is dropped whole, instead of being rewritten into the URL in a spelling the link never carried.
function parseMinimumEventCount(entry: string): AnalyticsMinimumEventCount | undefined {
  const separatorIndex = entry.indexOf(minimumEventCountSeparator);
  if (separatorIndex === -1) {
    return undefined;
  }

  const eventType = entry.slice(0, separatorIndex);
  if (!isThresholdEventType(eventType)) {
    return undefined;
  }

  const minimumCount = parseAcceptedMinimumCount(entry.slice(separatorIndex + 1));
  return minimumCount === undefined ? undefined : { eventType, minimumCount };
}

function parseMinimumEventCounts(
  searchParams: URLSearchParams,
  defaultValues: ReadonlyArray<AnalyticsMinimumEventCount>,
): ReadonlyArray<AnalyticsMinimumEventCount> {
  const entries = readListParam(searchParams, minimumEventCountsParamName);
  if (entries === undefined) {
    return normalizeMinimumEventCounts(defaultValues);
  }

  const parsedEntries: Array<AnalyticsMinimumEventCount> = [];
  for (const entry of entries) {
    const parsedEntry = parseMinimumEventCount(entry);
    if (parsedEntry === undefined) {
      return normalizeMinimumEventCounts(defaultValues);
    }

    parsedEntries.push(parsedEntry);
  }

  const eventTypes = parsedEntries.map((parsedEntry) => parsedEntry.eventType);
  if (new Set(eventTypes).size !== eventTypes.length) {
    return normalizeMinimumEventCounts(defaultValues);
  }

  return normalizeMinimumEventCounts(parsedEntries);
}

/** The range the URL carries, `null` when either end is absent or malformed or they are reversed. */
function readRequestedDateRange(
  searchParams: URLSearchParams,
  fromParamName: string,
  toParamName: string,
): AnalyticsDateRange | null {
  const from = readSingleParam(searchParams, fromParamName);
  const to = readSingleParam(searchParams, toParamName);
  if (from === undefined || to === undefined) {
    return null;
  }

  if (isCalendarDate(from) === false || isCalendarDate(to) === false || from > to) {
    return null;
  }

  return { from, to };
}

/**
 * The range the URL asks for before the available range is known, so reports can start on it at
 * once: `to` is clamped onto `todayUtc`, the last day any available range ends on, and `null` means
 * the default. `parseDateRange` decides the final range once the available range arrives.
 */
export function parseProvisionalDateRange(
  searchParams: URLSearchParams,
  todayUtc: string,
): AnalyticsDateRange | null {
  return clampRequestedDateRangeToToday(
    readRequestedDateRange(searchParams, dateRangeFromParamName, dateRangeToParamName),
    todayUtc,
  );
}

function clampRequestedDateRangeToToday(
  requestedRange: AnalyticsDateRange | null,
  todayUtc: string,
): AnalyticsDateRange | null {
  if (requestedRange === null) {
    return null;
  }

  const clampedTo = requestedRange.to > todayUtc ? todayUtc : requestedRange.to;
  return requestedRange.from > clampedTo ? null : { from: requestedRange.from, to: clampedTo };
}

// A range whose days reach past the available data is clamped onto it rather than refused, so a link
// older than the retained window still opens, on the data that does exist. Refusing it would make an
// old bookmark unusable, and passing it through would send an arbitrary window - a hand-typed
// `1900-01-01` to `2099-12-31` - to the report query and to the day-by-day gap filling. A window that
// does not overlap the available data at all has nothing to clamp onto and opens on the default.
// Both ends are `YYYY-MM-DD` here, so comparing them as text is comparing them as dates: the typed
// ends are checked by `isCalendarDate`, and the available ends by the `assertValidDateRange` every
// available-range loader returns them through.
export function parseDateRange(
  searchParams: URLSearchParams,
  availableRange: AnalyticsDateRange,
  defaultDateRange: AnalyticsDateRange,
): AnalyticsDateRange {
  return clampRequestedDateRangeToAvailableRange(
    readRequestedDateRange(searchParams, dateRangeFromParamName, dateRangeToParamName),
    availableRange,
  ) ?? defaultDateRange;
}

/** `null` when nothing was requested or the request does not overlap `availableRange`. */
function clampRequestedDateRangeToAvailableRange(
  requestedRange: AnalyticsDateRange | null,
  availableRange: AnalyticsDateRange,
): AnalyticsDateRange | null {
  if (requestedRange === null) {
    return null;
  }

  const clampedFrom = requestedRange.from < availableRange.from ? availableRange.from : requestedRange.from;
  const clampedTo = requestedRange.to > availableRange.to ? availableRange.to : requestedRange.to;
  return clampedFrom > clampedTo ? null : { from: clampedFrom, to: clampedTo };
}

/**
 * The selection a query string asks for, filled in from the defaults for every field it does not
 * carry. `availableRange` is the full range the data covers, and both directions turn it into
 * defaults through the same builder, so this is the exact inverse of `toAnalyticsFilterSearchParams`
 * called with the same `availableRange` and `area` - for every selection whose range lies inside
 * that window, which is every selection the app itself can hold, because a wider one is clamped here
 * on the way in and refused on the way to the reports.
 */
export function parseAnalyticsFilterState(
  searchParams: URLSearchParams,
  availableRange: AnalyticsDateRange,
  area: AnalyticsArea,
): AnalyticsFilterState {
  const defaults = buildDefaultAnalyticsFilterStateForAvailableRange(area, availableRange);

  return parseAnalyticsFilterStateOnDateRanges(
    searchParams,
    parseDateRange(searchParams, availableRange, defaults.dateRange),
    clampRequestedDateRangeToAvailableRange(
      readRequestedDateRange(searchParams, comparisonDateRangeFromParamName, comparisonDateRangeToParamName),
      availableRange,
    ),
  );
}

/** The selection reports start on before the available range is known; see `parseProvisionalDateRange`. */
export function parseProvisionalAnalyticsFilterState(
  searchParams: URLSearchParams,
  todayUtc: string,
  provisionalDefaultRange: AnalyticsDateRange,
): AnalyticsFilterState {
  return parseAnalyticsFilterStateOnDateRanges(
    searchParams,
    parseProvisionalDateRange(searchParams, todayUtc) ?? provisionalDefaultRange,
    clampRequestedDateRangeToToday(
      readRequestedDateRange(searchParams, comparisonDateRangeFromParamName, comparisonDateRangeToParamName),
      todayUtc,
    ),
  );
}

/** The site visitor fields a query string carries, each at its default when absent or malformed. */
export function parseSiteVisitorFilterState(searchParams: URLSearchParams): SiteVisitorFilterState {
  return {
    siteDeviceCategories: parseEnumList<SiteDeviceCategory>(
      searchParams,
      siteDeviceCategoriesParamName,
      siteDeviceCategories,
      defaultSiteVisitorFilterState.siteDeviceCategories,
    ),
    siteSources: parseEnumList<SiteSource>(
      searchParams,
      siteSourcesParamName,
      siteSources,
      defaultSiteVisitorFilterState.siteSources,
    ),
    siteCountries: parseOpaqueList(
      searchParams,
      siteCountriesParamName,
      defaultSiteVisitorFilterState.siteCountries,
    ),
    siteBrowserLanguages: parseOpaqueList(
      searchParams,
      siteBrowserLanguagesParamName,
      defaultSiteVisitorFilterState.siteBrowserLanguages,
    ),
    sitePageKinds: parseOpaqueList(
      searchParams,
      sitePageKindsParamName,
      defaultSiteVisitorFilterState.sitePageKinds,
    ),
  };
}

// Every field but the two ranges reads the same whether or not the available range is known.
function parseAnalyticsFilterStateOnDateRanges(
  searchParams: URLSearchParams,
  dateRange: AnalyticsDateRange,
  comparisonDateRange: AnalyticsDateRange | null,
): AnalyticsFilterState {
  const defaults = buildDefaultAnalyticsFilterState(dateRange);

  return {
    dateRange,
    comparisonDateRange,
    users: parseOpaqueList(searchParams, usersParamName, defaults.users),
    userCohorts: parseEnumList<ReviewEventCohort>(
      searchParams,
      userCohortsParamName,
      reviewEventCohorts,
      defaults.userCohorts,
    ),
    eventPlatforms: parseEnumList<ReviewEventPlatform>(
      searchParams,
      eventPlatformsParamName,
      reviewEventPlatforms,
      defaults.eventPlatforms,
    ),
    minimumEventCounts: parseMinimumEventCounts(searchParams, defaults.minimumEventCounts),
    connectionCountries: parseOpaqueList(
      searchParams,
      connectionCountriesParamName,
      defaults.connectionCountries,
    ),
    appUiLanguages: parseOpaqueList(searchParams, appUiLanguagesParamName, defaults.appUiLanguages),
    installedDecks: parseOpaqueList(searchParams, installedDecksParamName, defaults.installedDecks),
    catalogPlacements: parseEnumList<CatalogInstallPlacement>(
      searchParams,
      catalogPlacementsParamName,
      catalogInstallPlacements,
      defaults.catalogPlacements,
    ),
    catalogSources: parseEnumList<SiteSource>(
      searchParams,
      catalogSourcesParamName,
      siteSources,
      defaults.catalogSources,
    ),
    catalogDeviceCategories: parseEnumList<SiteDeviceCategory>(
      searchParams,
      catalogDeviceCategoriesParamName,
      siteDeviceCategories,
      defaults.catalogDeviceCategories,
    ),
    catalogClickBrowserLanguages: parseOpaqueList(
      searchParams,
      catalogClickBrowserLanguagesParamName,
      defaults.catalogClickBrowserLanguages,
    ),
    ...parseSiteVisitorFilterState(searchParams),
  };
}
