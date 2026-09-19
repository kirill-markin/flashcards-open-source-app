import {
  reviewEventCohorts,
  reviewEventPlatforms,
  type ReviewEventCohort,
  type ReviewEventPlatform,
} from "../adminApi";
import {
  catalogInstallDeviceCategories,
  catalogInstallPlacements,
  catalogInstallSources,
  type CatalogInstallDeviceCategory,
  type CatalogInstallPlacement,
  type CatalogInstallSource,
} from "../reports/catalogInstallFunnel/query";
import { buildDefaultReportRange } from "../reports/reportValues";
import {
  analyticsThresholdEventTypes,
  buildDefaultAnalyticsFilterState,
  type AnalyticsDateRange,
  type AnalyticsFilterState,
  type AnalyticsMinimumEventCount,
  type AnalyticsThresholdEventType,
} from "./analyticsFilters";

// The URL codec for `AnalyticsFilterState`. The selection lives in the query string, so a reload or a
// shared link reopens the same view, and the two functions here are inverses of each other.
//
// Writing omits every field that still holds its default, so a default view carries no filter
// parameters at all. Reading is tolerant of anything a person can type into an address bar: an
// unknown, repeated or malformed parameter is ignored and that field keeps its default. It is never
// repaired, because dropping one bad entry out of a list would silently hand back a different
// selection from the one the URL asked for.
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

// The invariant the two predicates below hold up: everything a normalizer emits must survive a
// write-then-read round trip unchanged. They are the only places that decide what a list entry and
// what a threshold count may be, and both directions go through them, so the writer cannot emit a
// value the reader throws the whole parameter away over.

/** An entry is written verbatim between separators, so an empty or padded one cannot come back. */
function isAcceptedListEntry(entry: string): boolean {
  return entry !== "" && entry === entry.trim();
}

/**
 * A threshold of zero is not a filter, and a count that is not an exactly representable integer does
 * not come back as itself: `app_opened:9007199254740993` would be read, and written back, as
 * `...992`, a different threshold from the one the URL carried.
 */
function isAcceptedMinimumCount(minimumCount: number): boolean {
  return Number.isInteger(minimumCount)
    && minimumCount >= 1
    && minimumCount <= Number.MAX_SAFE_INTEGER;
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
// back the default instead of the selection that was written.
function normalizeOpaqueList(values: ReadonlyArray<string>): ReadonlyArray<string> {
  return [...new Set(values.filter(isAcceptedListEntry))].sort();
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

/** Every filter cleared, on the default window of the range the data actually covers. */
export function buildDefaultAnalyticsFilterStateForAvailableRange(
  availableRange: AnalyticsDateRange,
): AnalyticsFilterState {
  return buildDefaultAnalyticsFilterState(
    buildDefaultReportRange(availableRange, analyticsFilterReportLabel),
  );
}

export function toAnalyticsFilterSearchParams(
  state: AnalyticsFilterState,
  availableRange: AnalyticsDateRange,
): URLSearchParams {
  const defaults = buildDefaultAnalyticsFilterStateForAvailableRange(availableRange);
  const searchParams = new URLSearchParams();

  if (
    state.dateRange.from !== defaults.dateRange.from
    || state.dateRange.to !== defaults.dateRange.to
  ) {
    searchParams.set(dateRangeFromParamName, state.dateRange.from);
    searchParams.set(dateRangeToParamName, state.dateRange.to);
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
    catalogInstallSources,
  );
  setEnumListParam(
    searchParams,
    catalogDeviceCategoriesParamName,
    state.catalogDeviceCategories,
    defaults.catalogDeviceCategories,
    catalogInstallDeviceCategories,
  );
  setOpaqueListParam(
    searchParams,
    catalogClickBrowserLanguagesParamName,
    state.catalogClickBrowserLanguages,
    defaults.catalogClickBrowserLanguages,
  );

  return searchParams;
}

/** The single value of a parameter, or `undefined` when it is absent or given more than once. */
function readSingleParam(
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

// The count reaches this side as text and the writer's normalizer sees it as a number, so the text
// becomes a candidate count first and is then judged by the same `isAcceptedMinimumCount`. Neither
// side restates the rule, so neither can drift out of the round trip.
function parseMinimumEventCount(entry: string): AnalyticsMinimumEventCount | undefined {
  const separatorIndex = entry.indexOf(minimumEventCountSeparator);
  if (separatorIndex === -1) {
    return undefined;
  }

  const eventType = entry.slice(0, separatorIndex);
  if (!isThresholdEventType(eventType)) {
    return undefined;
  }

  const minimumCount = Number(entry.slice(separatorIndex + 1));
  return isAcceptedMinimumCount(minimumCount) ? { eventType, minimumCount } : undefined;
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

// A range whose days lie outside the available data is kept rather than clamped: the available range
// grows with every new event, so clamping would quietly rewrite a link shared a day earlier.
function parseDateRange(
  searchParams: URLSearchParams,
  defaultDateRange: AnalyticsDateRange,
): AnalyticsDateRange {
  const from = readSingleParam(searchParams, dateRangeFromParamName);
  const to = readSingleParam(searchParams, dateRangeToParamName);
  if (from === undefined || to === undefined) {
    return defaultDateRange;
  }

  if (isCalendarDate(from) === false || isCalendarDate(to) === false || from > to) {
    return defaultDateRange;
  }

  return { from, to };
}

/**
 * The selection a query string asks for, filled in from the defaults for every field it does not
 * carry. `availableRange` is the full range the data covers, and both directions turn it into
 * defaults through the same builder, so this is the exact inverse of `toAnalyticsFilterSearchParams`
 * called with the same `availableRange`.
 */
export function parseAnalyticsFilterState(
  searchParams: URLSearchParams,
  availableRange: AnalyticsDateRange,
): AnalyticsFilterState {
  const defaults = buildDefaultAnalyticsFilterStateForAvailableRange(availableRange);

  return {
    dateRange: parseDateRange(searchParams, defaults.dateRange),
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
    catalogSources: parseEnumList<CatalogInstallSource>(
      searchParams,
      catalogSourcesParamName,
      catalogInstallSources,
      defaults.catalogSources,
    ),
    catalogDeviceCategories: parseEnumList<CatalogInstallDeviceCategory>(
      searchParams,
      catalogDeviceCategoriesParamName,
      catalogInstallDeviceCategories,
      defaults.catalogDeviceCategories,
    ),
    catalogClickBrowserLanguages: parseOpaqueList(
      searchParams,
      catalogClickBrowserLanguagesParamName,
      defaults.catalogClickBrowserLanguages,
    ),
  };
}
