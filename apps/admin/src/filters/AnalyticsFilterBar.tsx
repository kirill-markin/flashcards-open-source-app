import { useEffect, useLayoutEffect, useMemo, useRef, useState, type JSX, type ReactNode } from "react";
import {
  reviewEventCohorts,
  reviewEventPlatforms,
  type ReviewEventCohort,
  type ReviewEventPlatform,
  type ReviewEventsByDateUser,
} from "../adminApi";
import {
  getPlatformColor,
  platformLabels,
  uniqueUserCohortColors,
  uniqueUserCohortLabels,
} from "../charts/chartPrimitives";
import type { UserColorScale } from "../dashboard/userColors";
import type {
  CatalogInstallDeviceCategory,
  CatalogInstallPlacement,
  CatalogInstallSource,
} from "../reports/catalogInstallFunnel/query";
import type { AnalyticsArea } from "../routing";
import {
  analyticsThresholdEventTypeLabels,
  analyticsThresholdEventTypes,
  buildDefaultAnalyticsFilterState,
  deckVersionDiscriminatorLength,
  getAnalyticsFilterFieldExplanation,
  getAnalyticsFilterFieldLabel,
  parseAcceptedMinimumCount,
  type AnalyticsDateRange,
  type AnalyticsFilterField,
  type AnalyticsFilterState,
  type AnalyticsMinimumEventCount,
  type AnalyticsThresholdEventType,
} from "./analyticsFilters";
import { DateRangeCalendar, type DateRangeCalendarRange } from "./DateRangeCalendar";
import type { CatalogDeckOption } from "./optionsQuery";
import {
  buildActiveUserFilters,
  buildSearchableUserFilterOptions,
  doesUserMatchSearch,
  getNormalizedSearchValue,
  getUserFilterLabel,
  visibleUserFilterOptionLimit,
  type ActiveUserFilter,
  type SearchableUserFilterOption,
} from "./userFilters";

// The filter bar every analytics area renders, and every funnel with fields of its own renders again
// inside its section. It offers exactly the fields its caller lists, so a later field is wired in
// `buildFilterFieldView` rather than by editing this layout, and a field that does not apply is
// absent rather than shown disabled. `Reset all` resets those fields and leaves the rest of the
// selection alone.
//
// Every field reads the same way: its full label alone on the closed button, colour and a dot once
// its selection differs from the default, and a popover carrying the selection in words, its
// explanation behind an `(i)`, a picker and a reset to its default. The selection is committed on
// every click, so there is no draft to be overwritten by an arriving report.

// A selected user the range no longer offers names no series any chart gave a colour to, so its
// option in the users list takes this neutral swatch instead.
const unknownUserSwatchColor = "rgba(255, 255, 255, 0.36)";
// A threshold, a country and a locale tag name no value a chart gives a colour to, so their options
// take the accent every filtered control in the bar already uses.
const filterValueSwatchColor = "var(--accent-strong)";
// Above this many picked values the popover header prints a count instead, which is where the values
// stop fitting on its one line.
const optionSummaryValueLimit = 3;
// Above this many values an option list stops being scannable in a popover and is searched instead.
const searchableFilterOptionCount = 15;

type AnalyticsFilterBarProps = Readonly<{
  /** Chooses the wording of each field; the fields themselves are `fields`. */
  area: AnalyticsArea;
  fields: ReadonlyArray<AnalyticsFilterField>;
  title: string;
  /** 2 as an area's own bar, 3 inside a section that already has its h2. */
  headingLevel: 2 | 3;
  /** Unique on the page, because a bar can render more than once there; every id inside derives from it. */
  headingId: string;
  /** The accessible name of `Reset all`, which says whose filters it resets when bars share a page. */
  resetAllLabel: string;
  availableRange: AnalyticsDateRange;
  defaultRange: AnalyticsDateRange;
  filters: AnalyticsFilterState;
  /** Every user the range can offer, deliberately wider than the users the filtered reports show. */
  userOptions: ReadonlyArray<ReviewEventsByDateUser>;
  /**
   * A reload is pending or in flight. Only `Reset all`, which commits a whole selection at once, is
   * disabled by it: every other control stays live, because a click during a reload supersedes it.
   */
  isReportLoading: boolean;
  /**
   * The rejection of a requested range, and only that: it belongs beside the control that raised it.
   * A failed reload is not shown here, because an open popover hangs over this line; it goes to the
   * dashboard's sticky banner instead.
   */
  dateRangeError: string;
  /** Every country the range can offer, from the same range-scoped options query as `userOptions`. */
  connectionCountryOptions: ReadonlyArray<string>;
  /** Every app UI locale tag the range can offer, from that same query. */
  appUiLanguageOptions: ReadonlyArray<string>;
  /**
   * What the five catalog fields can offer. Unlike every list above, these are not scoped to the
   * range: the decks name every deck version ever installed, and the four dimensions name what the
   * area's own rows carried. The caller chooses that source, because the two kinds of area match
   * different rows: the user-scoped areas match a person through a completed install, so their values
   * come from the clicks that became installs, while Funnels matches any click and takes its values
   * from the clicks themselves. The field explanations say what each still cannot cover.
   */
  catalogDeckOptions: ReadonlyArray<CatalogDeckOption>;
  catalogPlacementOptions: ReadonlyArray<CatalogInstallPlacement>;
  catalogSourceOptions: ReadonlyArray<CatalogInstallSource>;
  catalogDeviceCategoryOptions: ReadonlyArray<CatalogInstallDeviceCategory>;
  catalogClickBrowserLanguageOptions: ReadonlyArray<string>;
  userColorScale: UserColorScale;
  /** Whether the selection was accepted; a rejected one keeps its popover open on the error. */
  onFiltersChange: (filters: AnalyticsFilterState) => boolean;
}>;

type FilterOption<Value extends string> = Readonly<{
  value: Value;
  label: string;
  swatchColor: string;
}>;

/** One pickable value of a field whose values carry no colour of their own. */
type FilterOptionChoice<Value extends string> = Readonly<{
  value: Value;
  /** What the checkbox prints, where there is room for the whole value. */
  label: string;
  /** What the popover header prints, where a deck version's full label would not fit. */
  summaryLabel: string;
}>;

/** What one field contributes to the bar; the shared shell around it is the same for every field. */
type FilterFieldView = Readonly<{
  /** The current selection in a few words, printed in the popover header and named on the button. */
  summary: string;
  isFiltered: boolean;
  /** The 620px popover, which is what the two-month calendar and the user list need to fit. */
  isWide: boolean;
  content: ReactNode;
}>;

function getFilterButtonClassName(isActive: boolean, isFiltered: boolean): string {
  const classNames = ["filter-menu-button"];

  if (isActive) {
    classNames.push("active");
  }

  if (isFiltered) {
    classNames.push("filtered");
  }

  return classNames.join(" ");
}

// The popover of the first field opens to the right and of the last one to the left, so neither can
// leave the panel; everything between them is centred on its own button.
function getPopoverAnchorClassName(index: number, fieldCount: number, isWide: boolean): string {
  const classNames = ["filter-popover-anchor"];

  if (index === 0) {
    classNames.push("filter-popover-anchor-start");
  } else if (index === fieldCount - 1) {
    classNames.push("filter-popover-anchor-end");
  } else {
    classNames.push("filter-popover-anchor-center");
  }

  if (isWide) {
    classNames.push("filter-popover-anchor-wide");
  }

  return classNames.join(" ");
}

function toggleSelectedValue<Value extends string>(
  values: ReadonlyArray<Value>,
  value: Value,
  isChecked: boolean,
): ReadonlyArray<Value> {
  if (isChecked === false) {
    return values.filter((currentValue) => currentValue !== value);
  }

  return values.includes(value) ? values : [...values, value];
}

// Selected values read in the order their options are declared in, which is the order the picker
// lists them in and the order the URL carries them in.
function getEnumSelectionSummary<Value extends string>(
  selectedValues: ReadonlyArray<Value>,
  optionOrder: ReadonlyArray<Value>,
  labels: Readonly<Record<Value, string>>,
): string {
  if (selectedValues.length === 0) {
    return "None";
  }

  return optionOrder
    .filter((option) => selectedValues.includes(option))
    .map((option) => labels[option])
    .join(" + ");
}

function formatMinimumEventCountLabel(entry: AnalyticsMinimumEventCount): string {
  return `${analyticsThresholdEventTypeLabels[entry.eventType]} ≥ ${entry.minimumCount.toLocaleString("en-US")}`;
}

// Thresholds read in the order their event types are declared in, which is the order the popover
// lists them in and the order the URL carries them in.
function getMinimumEventCountsSummary(
  entries: ReadonlyArray<AnalyticsMinimumEventCount>,
): string {
  if (entries.length === 0) {
    return "No threshold";
  }

  return analyticsThresholdEventTypes
    .flatMap((eventType) => entries.filter((entry) => entry.eventType === eventType))
    .map(formatMinimumEventCountLabel)
    .join(" + ");
}

// One threshold per event type, so setting one replaces the entry that event type already had, and
// the result comes back in the declared order.
function withMinimumEventCount(
  entries: ReadonlyArray<AnalyticsMinimumEventCount>,
  eventType: AnalyticsThresholdEventType,
  minimumCount: number,
): ReadonlyArray<AnalyticsMinimumEventCount> {
  return analyticsThresholdEventTypes.flatMap((option): ReadonlyArray<AnalyticsMinimumEventCount> => {
    if (option === eventType) {
      return [{ eventType, minimumCount }];
    }

    return entries.filter((entry) => entry.eventType === option);
  });
}

function withDefaultFields(
  filters: AnalyticsFilterState,
  defaultFilters: AnalyticsFilterState,
  fields: ReadonlyArray<AnalyticsFilterField>,
): AnalyticsFilterState {
  return fields.reduce<AnalyticsFilterState>(
    (nextFilters, field) => ({ ...nextFilters, [field]: defaultFilters[field] }),
    filters,
  );
}

// One checkbox per value, and a search once a list is too long to scan - decks and locale tags can be
// numerous, so they get what the users field already has: the search narrows what is rendered, only
// the first matches are rendered, and the count line says how many more the search still matches. A
// search is a way of looking rather than part of the selection, so it lives here and ends with the
// popover instead of reaching the URL.
function FilterOptionList<Value extends string>(
  props: Readonly<{
    options: ReadonlyArray<FilterOption<Value>>;
    selectedValues: ReadonlySet<Value>;
    onToggle: (value: Value, isChecked: boolean) => void;
  }>,
): JSX.Element {
  const [searchValue, setSearchValue] = useState<string>("");
  const normalizedSearchValue = getNormalizedSearchValue(searchValue);
  const matchingOptions = props.options.filter(
    (option) => getNormalizedSearchValue(option.label).includes(normalizedSearchValue),
  );
  // Every matching value that is picked is rendered, and the limit governs the unpicked ones alone:
  // a picked value the limit hid would stay applied with no control to remove it, which is the same
  // hole a value that stopped being offered would fall into. The limit is the users list' own,
  // because these lists render the same way and one number is what keeps them from drifting apart;
  // the count line below says how many more the search still matches. Being picked decides only
  // whether a value may show and never where: the rows keep the order the options are declared in, so
  // ticking a box moves no row out from under the pointer and the list reads in the same order as the
  // summary above it.
  const visibleUnpickedValues: ReadonlySet<Value> = new Set<Value>(
    matchingOptions
      .filter((option) => props.selectedValues.has(option.value) === false)
      .slice(0, visibleUserFilterOptionLimit)
      .map((option) => option.value),
  );
  const visibleOptions = matchingOptions.filter((option) => (
    props.selectedValues.has(option.value) || visibleUnpickedValues.has(option.value)
  ));
  const hiddenOptionCount = matchingOptions.length - visibleOptions.length;

  return (
    <>
      {props.options.length > searchableFilterOptionCount ? (
        <label className="filter-option-search">
          <span>Search values</span>
          <input
            type="search"
            value={searchValue}
            placeholder="Any part of a value"
            onChange={(event) => setSearchValue(event.currentTarget.value)}
          />
        </label>
      ) : null}
      {visibleOptions.length === 0 ? (
        <p className="filter-option-empty">No value matches this search.</p>
      ) : (
        <div className="filter-option-list">
          {visibleOptions.map((option) => (
            <label
              key={option.value}
              className={`filter-checkbox-option${props.selectedValues.has(option.value) ? " selected" : ""}`}
            >
              <input
                type="checkbox"
                checked={props.selectedValues.has(option.value)}
                onChange={(event) => props.onToggle(option.value, event.currentTarget.checked)}
              />
              <span className="platform-key-swatch" style={{ backgroundColor: option.swatchColor }} />
              <span>{option.label}</span>
            </label>
          ))}
        </div>
      )}
      {hiddenOptionCount > 0 ? (
        <p className="filter-option-limit">
          Showing {visibleOptions.length.toLocaleString("en-US")} of {matchingOptions.length.toLocaleString("en-US")} matching values.
        </p>
      ) : null}
    </>
  );
}

// Users are an open-ended list of thousands, so this one is searched rather than listed, and only
// the first matches are rendered; the count line says how many more the search still matches. The
// search index is built by the bar rather than here, because this component is mounted only while
// its popover is open and would otherwise re-index every user on every open. A selected user the
// range no longer offers has no option of its own, so it is listed first, checked, rather than being
// applied with no control for it.
function UserFilterOptions(
  props: Readonly<{
    searchableOptions: ReadonlyArray<SearchableUserFilterOption>;
    selectedUsersOutsideOptions: ReadonlyArray<ActiveUserFilter>;
    selectedUserIds: ReadonlySet<string>;
    searchValue: string;
    userColorScale: UserColorScale;
    onSearchChange: (searchValue: string) => void;
    onToggle: (userId: string, isChecked: boolean) => void;
  }>,
): JSX.Element {
  const searchableOptions = props.searchableOptions;
  const normalizedSearchValue = useMemo(
    () => getNormalizedSearchValue(props.searchValue),
    [props.searchValue],
  );
  const matchingOptions = useMemo(
    () => searchableOptions
      .filter((option) => doesUserMatchSearch(option, normalizedSearchValue))
      .map((option) => option.user),
    [normalizedSearchValue, searchableOptions],
  );
  const selectedUserIds = props.selectedUserIds;
  // Every matching user that is picked is rendered, and the limit governs the unpicked ones alone.
  // The offered users arrive ordered by their id, so the limit would otherwise decide by an arbitrary
  // ordering which selections keep a checkbox, and a hidden one would stay applied with nothing on
  // screen naming it. Being picked decides whether a user may show and never where: the rows stay in
  // the order the report offers them in, so ticking a box moves nothing under the pointer.
  const visibleOptions = useMemo(
    () => {
      const visibleUnpickedUserIds: ReadonlySet<string> = new Set<string>(
        matchingOptions
          .filter((user) => selectedUserIds.has(user.userId) === false)
          .slice(0, visibleUserFilterOptionLimit)
          .map((user) => user.userId),
      );

      return matchingOptions.filter((user) => (
        selectedUserIds.has(user.userId) || visibleUnpickedUserIds.has(user.userId)
      ));
    },
    [matchingOptions, selectedUserIds],
  );
  // What the limit still holds back: offered users the search matches and this list does not render.
  // A selected-but-unoffered row is never held back, so it cannot be part of this count.
  const hiddenOptionCount = matchingOptions.length - visibleOptions.length;
  const selectedUsersOutsideOptions = props.selectedUsersOutsideOptions;
  // Searched by the same text as the offered users, so one search narrows the whole list.
  const matchingUsersOutsideOptions = useMemo(
    () => selectedUsersOutsideOptions.filter((userFilter) => (
      getNormalizedSearchValue(`${userFilter.label} ${userFilter.userId}`)
        .includes(normalizedSearchValue)
    )),
    [normalizedSearchValue, selectedUsersOutsideOptions],
  );
  // Both numbers on the count line count the same rows, so the line can be checked against what is on
  // screen: every row this list renders, against every user the search matches. The selected-but-
  // unoffered rows are rendered and are matches of that same search, so they belong on both sides.
  const renderedUserCount = visibleOptions.length + matchingUsersOutsideOptions.length;
  const matchingUserCount = matchingOptions.length + matchingUsersOutsideOptions.length;

  if (searchableOptions.length === 0 && selectedUsersOutsideOptions.length === 0) {
    return <p className="user-filter-empty">No users with activity in this range.</p>;
  }

  return (
    <>
      <label className="user-filter-search">
        <span>Search users</span>
        <input
          type="search"
          value={props.searchValue}
          placeholder="Email or user ID"
          onChange={(event) => props.onSearchChange(event.currentTarget.value)}
        />
      </label>
      {visibleOptions.length + matchingUsersOutsideOptions.length > 0 ? (
        <div className="user-filter-options">
          {matchingUsersOutsideOptions.map((userFilter) => (
            <label key={userFilter.userId} className="user-filter-option selected">
              <input
                type="checkbox"
                value={userFilter.userId}
                checked
                onChange={(event) => props.onToggle(userFilter.userId, event.currentTarget.checked)}
              />
              <span
                className="user-filter-swatch"
                style={{ backgroundColor: unknownUserSwatchColor }}
              />
              <span className="user-filter-option-text">
                <span className="user-filter-option-primary">{userFilter.label}</span>
                <span className="user-filter-option-secondary">{userFilter.secondaryLabel}</span>
              </span>
            </label>
          ))}
          {visibleOptions.map((user) => (
            <label
              key={user.userId}
              className={`user-filter-option${selectedUserIds.has(user.userId) ? " selected" : ""}`}
            >
              <input
                type="checkbox"
                value={user.userId}
                checked={selectedUserIds.has(user.userId)}
                onChange={(event) => props.onToggle(user.userId, event.currentTarget.checked)}
              />
              <span
                className="user-filter-swatch"
                style={{ backgroundColor: props.userColorScale(user.userId) }}
              />
              <span className="user-filter-option-text">
                <span className="user-filter-option-primary">{getUserFilterLabel(user)}</span>
                <span className="user-filter-option-secondary">
                  {user.userId} - {user.totalReviewEvents.toLocaleString("en-US")} events
                </span>
              </span>
            </label>
          ))}
        </div>
      ) : (
        <p className="user-filter-empty">No users match this search.</p>
      )}
      {hiddenOptionCount > 0 ? (
        <p className="user-filter-limit">
          Showing {renderedUserCount.toLocaleString("en-US")} of {matchingUserCount.toLocaleString("en-US")} matching users.
        </p>
      ) : null}
    </>
  );
}

/** The picked labels while they still fit on the popover header, and a count once they do not. */
function getOptionSelectionSummary(
  selectedLabels: ReadonlyArray<string>,
  everyValueSummary: string,
): string {
  if (selectedLabels.length === 0) {
    return everyValueSummary;
  }

  return selectedLabels.length <= optionSummaryValueLimit
    ? selectedLabels.join(" + ")
    : `${selectedLabels.length.toLocaleString("en-US")} selected`;
}

// Every field whose values name no chart series reads the same way, whether its values are an open set
// like countries and locale tags or a closed one like the catalog placements: one checkbox per value,
// and a reset that clears the field. The offered options are built independently of the selection, so a
// picked value that stopped being offered is listed as a checked option of its own rather than sitting
// applied with no control for it - which is also why a value with no option to read a label from prints
// as itself.
function buildOptionFieldView<Value extends string>(props: Readonly<{
  selectedValues: ReadonlyArray<Value>;
  options: ReadonlyArray<FilterOptionChoice<Value>>;
  defaultValues: ReadonlyArray<Value>;
  everyValueSummary: string;
  emptyOptionsMessage: string;
  resetLabel: string;
  onSelectionChange: (values: ReadonlyArray<Value>) => void;
}>): FilterFieldView {
  const selectedValueSet: ReadonlySet<Value> = new Set<Value>(props.selectedValues);
  const optionsByValue: ReadonlyMap<Value, FilterOptionChoice<Value>> = new Map<
    Value,
    FilterOptionChoice<Value>
  >(props.options.map((option) => [option.value, option]));
  const selectedSummaryLabels = props.selectedValues.map(
    (value) => optionsByValue.get(value)?.summaryLabel ?? value,
  );
  // A selection outlives the list that offered it: a country can leave the range and a deck version can
  // leave the catalog while the URL still carries the value. Such a value is listed first, checked, so
  // the one place that shows a selection is also the one place that can remove it.
  const listedOptions: ReadonlyArray<FilterOptionChoice<Value>> = [
    ...props.selectedValues
      .filter((value) => optionsByValue.has(value) === false)
      .map(toPlainOptionChoice),
    ...props.options,
  ];

  return {
    summary: getOptionSelectionSummary(selectedSummaryLabels, props.everyValueSummary),
    isFiltered: props.selectedValues.length > 0,
    isWide: false,
    content: (
      <>
        {listedOptions.length === 0 ? (
          <p className="filter-option-empty">{props.emptyOptionsMessage}</p>
        ) : (
          <FilterOptionList
            options={listedOptions.map((option) => ({
              value: option.value,
              label: option.label,
              swatchColor: filterValueSwatchColor,
            }))}
            selectedValues={selectedValueSet}
            onToggle={(value: Value, isChecked) => props.onSelectionChange(
              toggleSelectedValue(props.selectedValues, value, isChecked),
            )}
          />
        )}
        {props.selectedValues.length === 0 ? null : (
          <FilterFieldResetButton
            label={props.resetLabel}
            onReset={() => props.onSelectionChange(props.defaultValues)}
          />
        )}
      </>
    ),
  };
}

/** A value that is its own label, which is every option field but the decks. */
function toPlainOptionChoice<Value extends string>(value: Value): FilterOptionChoice<Value> {
  return { value, label: value, summaryLabel: value };
}

// Only the slug fits on the one line of the deck popover's header, so two picked versions of one deck
// would read there as the same word twice. The slugs that more than one picked version shares are the
// ones that have to carry a discriminator; every other slug stays a bare word.
function buildAmbiguousDeckSlugs(
  deckOptions: ReadonlyArray<CatalogDeckOption>,
  selectedPackageVersionIds: ReadonlyArray<string>,
): ReadonlySet<string> {
  const selectedSlugCounts = new Map<string, number>();
  for (const deck of deckOptions) {
    if (selectedPackageVersionIds.includes(deck.packageVersionId)) {
      selectedSlugCounts.set(deck.packageSlug, (selectedSlugCounts.get(deck.packageSlug) ?? 0) + 1);
    }
  }

  return new Set(
    Array.from(selectedSlugCounts.entries())
      .filter(([, slugCount]) => slugCount > 1)
      .map(([packageSlug]) => packageSlug),
  );
}

// A field the filter model declares and the bar does not build would leave the area without a control
// for a filter the URL can still carry, so it is a compile error here rather than a silent omission.
function assertEveryFilterFieldIsWired(field: never): never {
  throw new Error(`Analytics filter field ${String(field)} has no control in the filter bar.`);
}

// The explanation waiting behind the popover header's `(i)`. One boolean decides both the class that
// shows the text and `aria-expanded`, so what a screen reader is told and what is on screen cannot
// disagree; CSS has no reveal rule of its own for that reason. A mouse reveals it by resting on the
// button, and a click decides it outright from whatever is currently shown - so a click closes a
// tooltip the pointer is still holding open, which hover alone could never do, and it is also the one
// way in that a touch device and the browsers that do not focus a button on click both have. A
// closing click holds while the pointer is still on the button and lapses once it leaves, so the next
// hover is a fresh question rather than one already answered. Touch contacts are not hover, or the tap
// that opens the tooltip would arrive as a click on an already-open one and close it again. The state
// is local because the popover is mounted only while it is open, so every opening starts with the
// explanation away.
function FilterFieldExplanation(
  props: Readonly<{
    fieldLabel: string;
    explanationId: string;
    explanation: string;
  }>,
): JSX.Element {
  const [clickedState, setClickedState] = useState<"none" | "open" | "closed">("none");
  const [isPointerOver, setIsPointerOver] = useState<boolean>(false);
  const isOpen = clickedState === "none" ? isPointerOver : clickedState === "open";

  useEffect(() => {
    if (clickedState === "closed" && isPointerOver === false) {
      setClickedState("none");
    }
  }, [clickedState, isPointerOver]);

  return (
    <span
      className={`filter-explanation${isOpen ? " open" : ""}`}
      onPointerEnter={(event) => {
        if (event.pointerType === "mouse") {
          setIsPointerOver(true);
        }
      }}
      onPointerLeave={() => setIsPointerOver(false)}
    >
      <button
        className="filter-explanation-toggle"
        type="button"
        aria-label={`What ${props.fieldLabel} means`}
        aria-describedby={props.explanationId}
        aria-expanded={isOpen}
        onClick={() => setClickedState(isOpen ? "closed" : "open")}
      >
        i
      </button>
      <span id={props.explanationId} className="filter-explanation-text" role="tooltip">
        {props.explanation}
      </span>
    </span>
  );
}

function FilterFieldResetButton(
  props: Readonly<{
    label: string;
    onReset: () => void;
  }>,
): JSX.Element {
  return (
    <div className="filter-popover-actions">
      <button
        className="filter-button filter-button-compact"
        type="button"
        onClick={props.onReset}
      >
        {props.label}
      </button>
    </div>
  );
}

export function AnalyticsFilterBar(props: AnalyticsFilterBarProps): JSX.Element {
  const [openField, setOpenField] = useState<AnalyticsFilterField | null>(null);
  const [userSearchValue, setUserSearchValue] = useState<string>("");
  // The raw text of a threshold input that the filter cannot hold: "1." on the way to "1.5", a lone
  // "-", a pasted "1 000". It has to stay visible to be finished or corrected, and it must not reach
  // the selection, so it lives here and nowhere else. Only rejected text is ever drafted, which is
  // what makes an input with no draft a reading of the count that is actually applied.
  const [minimumCountDrafts, setMinimumCountDrafts] = useState<
    ReadonlyMap<AnalyticsThresholdEventType, string>
  >(() => new Map());
  const panelRef = useRef<HTMLElement | null>(null);
  const fieldButtonsRef = useRef<Map<AnalyticsFilterField, HTMLButtonElement>>(new Map());

  function focusFieldButton(field: AnalyticsFilterField): void {
    const fieldButton = fieldButtonsRef.current.get(field);
    if (fieldButton === undefined || fieldButton.disabled) {
      return;
    }

    fieldButton.focus();
  }

  function closeField(field: AnalyticsFilterField, shouldRestoreFocus: boolean): void {
    setOpenField((currentField) => (currentField === field ? null : currentField));

    if (shouldRestoreFocus) {
      window.requestAnimationFrame(() => focusFieldButton(field));
    }
  }

  // The fields differ by area, so moving to an area that does not render the open field would hide
  // its popover while the outside-click and Escape effect below stayed armed on a control nobody can
  // see or dismiss.
  useEffect(() => {
    setOpenField((currentField) => (
      currentField === null || props.fields.includes(currentField)
        ? currentField
        : null
    ));
  }, [props.fields]);

  useEffect(() => {
    if (openField === null) {
      return;
    }

    const fieldToClose = openField;

    function handlePointerDown(event: PointerEvent): void {
      const panelElement = panelRef.current;
      if (panelElement === null || event.target instanceof Node === false) {
        return;
      }

      if (panelElement.contains(event.target) === false) {
        closeField(fieldToClose, false);
      }
    }

    function handleKeyDown(event: KeyboardEvent): void {
      if (event.key === "Escape") {
        event.preventDefault();
        closeField(fieldToClose, true);
      }
    }

    document.addEventListener("pointerdown", handlePointerDown);
    document.addEventListener("keydown", handleKeyDown);

    return () => {
      document.removeEventListener("pointerdown", handlePointerDown);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [openField]);

  // The committed thresholds as one string, which is what the popover header prints and the field
  // button's accessible name carries.
  const committedMinimumEventCountsSummary = getMinimumEventCountsSummary(
    props.filters.minimumEventCounts,
  );

  // Opening or closing any popover ends every draft at once: the input a draft was typed in is gone,
  // so there is nothing left for the text to be finished in.
  useEffect(() => {
    setMinimumCountDrafts((drafts) => (drafts.size === 0 ? drafts : new Map()));
  }, [openField]);

  // Every opening of the users popover starts with an empty search. That search lives on the bar
  // rather than in the popover it is typed in, because the popover is mounted only while it is open,
  // so a term left behind by an earlier opening would otherwise still be narrowing the list - and
  // could hide a selected user from the one place that can uncheck them. It is cleared before the
  // browser paints rather than after, so the opening cannot show the previous opening's term and its
  // narrowed list for a frame first.
  useLayoutEffect(() => {
    if (openField === "users") {
      setUserSearchValue("");
    }
  }, [openField]);

  const defaultFilters = buildDefaultAnalyticsFilterState(props.defaultRange);
  const selectedUserIds = useMemo(() => new Set(props.filters.users), [props.filters.users]);
  const selectedCohorts = useMemo(() => new Set(props.filters.userCohorts), [props.filters.userCohorts]);
  const selectedPlatforms = useMemo(
    () => new Set(props.filters.eventPlatforms),
    [props.filters.eventPlatforms],
  );
  const minimumCountByEventType = useMemo(
    () => new Map<AnalyticsThresholdEventType, number>(
      props.filters.minimumEventCounts.map((entry) => [entry.eventType, entry.minimumCount]),
    ),
    [props.filters.minimumEventCounts],
  );
  const previousMinimumCountByEventTypeRef = useRef<
    ReadonlyMap<AnalyticsThresholdEventType, number>
  >(minimumCountByEventType);

  // The other thing that ends a draft is the committed count under it changing, which covers
  // `Reset all`, `Clear every threshold` and the user's own accepted keystroke. It ends the draft on
  // that event type alone: an accepted count typed into one input must not erase text still being
  // edited in another, untouched one. The previous counts are held in a ref because
  // `props.filters` arrives as a fresh object on every commit, so only its contents can tell a real
  // change from a repeat.
  useEffect(() => {
    const previousMinimumCountByEventType = previousMinimumCountByEventTypeRef.current;
    previousMinimumCountByEventTypeRef.current = minimumCountByEventType;

    const changedEventTypes = analyticsThresholdEventTypes.filter((eventType) => (
      previousMinimumCountByEventType.get(eventType) !== minimumCountByEventType.get(eventType)
    ));
    if (changedEventTypes.length === 0) {
      return;
    }

    setMinimumCountDrafts((drafts) => {
      const remainingDrafts = new Map(drafts);
      for (const eventType of changedEventTypes) {
        remainingDrafts.delete(eventType);
      }

      return remainingDrafts.size === drafts.size ? drafts : remainingDrafts;
    });
  }, [minimumCountByEventType]);

  const userOptionById = useMemo(
    () => new Map<string, ReviewEventsByDateUser>(
      props.userOptions.map((user) => [user.userId, user]),
    ),
    [props.userOptions],
  );
  // The bar stays mounted while popovers open and close, so the one pass over every user that the
  // search needs is paid once per option list rather than once per opening of the users popover.
  const searchableUserOptions = useMemo(
    () => buildSearchableUserFilterOptions(props.userOptions),
    [props.userOptions],
  );
  // A selected user the range no longer offers has no option of its own in the list, so the list is
  // given one for them: every selection stays visible, and removable, in the one place that shows it.
  const selectedUsersOutsideOptions = useMemo(
    () => buildActiveUserFilters(props.filters.users, userOptionById)
      .filter((userFilter) => userFilter.hasUserInReport === false),
    [props.filters.users, userOptionById],
  );

  // The range is the one field whose picker dismisses itself, because a picked range is complete and
  // nothing else in that popover follows from it. A rejected range keeps it open on the error.
  function handleDateRangeChange(range: DateRangeCalendarRange): void {
    if (props.onFiltersChange({ ...props.filters, dateRange: range }) === false) {
      return;
    }

    closeField("dateRange", true);
  }

  function clearMinimumCountDraft(eventType: AnalyticsThresholdEventType): void {
    setMinimumCountDrafts((drafts) => {
      if (drafts.has(eventType) === false) {
        return drafts;
      }

      const remainingDrafts = new Map(drafts);
      remainingDrafts.delete(eventType);
      return remainingDrafts;
    });
  }

  // An empty input is no threshold on that event type, which is how this input clears one;
  // `Clear every threshold` and `Reset all` clear them too. Text that does not name a whole count of
  // at least one is not a threshold this filter can hold: it is kept as a draft and named as not
  // applied, so the selection it failed to change stays exactly what the other inputs and the popover
  // header say it is, rather than being silently dropped or reread into a different one. A keystroke
  // that lands on the count already applied commits nothing, because every commit repaints the bar as
  // `Updating` and refetches every report in the area.
  function handleMinimumEventCountChange(
    eventType: AnalyticsThresholdEventType,
    rawMinimumCount: string,
  ): void {
    const committedMinimumCount = minimumCountByEventType.get(eventType);

    if (rawMinimumCount.trim() === "") {
      clearMinimumCountDraft(eventType);
      if (committedMinimumCount === undefined) {
        return;
      }

      props.onFiltersChange({
        ...props.filters,
        minimumEventCounts: props.filters.minimumEventCounts.filter(
          (entry) => entry.eventType !== eventType,
        ),
      });
      return;
    }

    const minimumCount = parseAcceptedMinimumCount(rawMinimumCount);
    if (minimumCount === undefined) {
      setMinimumCountDrafts((drafts) => new Map(drafts).set(eventType, rawMinimumCount));
      return;
    }

    clearMinimumCountDraft(eventType);
    if (minimumCount === committedMinimumCount) {
      return;
    }

    props.onFiltersChange({
      ...props.filters,
      minimumEventCounts: withMinimumEventCount(
        props.filters.minimumEventCounts,
        eventType,
        minimumCount,
      ),
    });
  }

  function handleAllFiltersReset(): void {
    setUserSearchValue("");
    props.onFiltersChange(withDefaultFields(props.filters, defaultFilters, props.fields));

    if (openField !== null) {
      closeField(openField, true);
    }
  }

  function buildFilterFieldView(field: AnalyticsFilterField): FilterFieldView {
    if (field === "dateRange") {
      const isDefaultRange = props.filters.dateRange.from === props.defaultRange.from
        && props.filters.dateRange.to === props.defaultRange.to;

      return {
        summary: `${props.filters.dateRange.from} to ${props.filters.dateRange.to}`,
        isFiltered: isDefaultRange === false,
        isWide: true,
        content: (
          <>
            <DateRangeCalendar
              availableRange={props.availableRange}
              selectedRange={props.filters.dateRange}
              onRangeChange={handleDateRangeChange}
            />
            {props.dateRangeError === "" ? null : (
              <p className="filter-error" role="alert">{props.dateRangeError}</p>
            )}
            {isDefaultRange ? null : (
              <FilterFieldResetButton
                label="Reset to default range"
                onReset={() => handleDateRangeChange(props.defaultRange)}
              />
            )}
          </>
        ),
      };
    }

    if (field === "users") {
      return {
        summary: props.filters.users.length === 0
          ? "All users"
          : `${props.filters.users.length.toLocaleString("en-US")} selected`,
        isFiltered: props.filters.users.length > 0,
        isWide: true,
        content: (
          <>
            <UserFilterOptions
              searchableOptions={searchableUserOptions}
              selectedUsersOutsideOptions={selectedUsersOutsideOptions}
              selectedUserIds={selectedUserIds}
              searchValue={userSearchValue}
              userColorScale={props.userColorScale}
              onSearchChange={setUserSearchValue}
              onToggle={(userId, isChecked) => props.onFiltersChange({
                ...props.filters,
                users: toggleSelectedValue(props.filters.users, userId, isChecked),
              })}
            />
            {props.filters.users.length === 0 ? null : (
              <FilterFieldResetButton
                label="Select all users"
                onReset={() => props.onFiltersChange({ ...props.filters, users: defaultFilters.users })}
              />
            )}
          </>
        ),
      };
    }

    if (field === "userCohorts") {
      return {
        summary: getEnumSelectionSummary(
          props.filters.userCohorts,
          reviewEventCohorts,
          uniqueUserCohortLabels,
        ),
        isFiltered: props.filters.userCohorts.length !== reviewEventCohorts.length,
        isWide: false,
        content: (
          <>
            <FilterOptionList
              options={reviewEventCohorts.map((cohort) => ({
                value: cohort,
                label: uniqueUserCohortLabels[cohort],
                swatchColor: uniqueUserCohortColors[cohort],
              }))}
              selectedValues={selectedCohorts}
              onToggle={(cohort: ReviewEventCohort, isChecked) => props.onFiltersChange({
                ...props.filters,
                userCohorts: toggleSelectedValue(props.filters.userCohorts, cohort, isChecked),
              })}
            />
            {props.filters.userCohorts.length === reviewEventCohorts.length ? null : (
              <FilterFieldResetButton
                label="Select both sides"
                onReset={() => props.onFiltersChange({
                  ...props.filters,
                  userCohorts: defaultFilters.userCohorts,
                })}
              />
            )}
          </>
        ),
      };
    }

    if (field === "eventPlatforms") {
      return {
        summary: getEnumSelectionSummary(
          props.filters.eventPlatforms,
          reviewEventPlatforms,
          platformLabels,
        ),
        isFiltered: props.filters.eventPlatforms.length !== reviewEventPlatforms.length,
        isWide: false,
        content: (
          <>
            <FilterOptionList
              options={reviewEventPlatforms.map((platform) => ({
                value: platform,
                label: platformLabels[platform],
                swatchColor: getPlatformColor(platform),
              }))}
              selectedValues={selectedPlatforms}
              onToggle={(platform: ReviewEventPlatform, isChecked) => props.onFiltersChange({
                ...props.filters,
                eventPlatforms: toggleSelectedValue(props.filters.eventPlatforms, platform, isChecked),
              })}
            />
            {props.filters.eventPlatforms.length === reviewEventPlatforms.length ? null : (
              <FilterFieldResetButton
                label="Select every platform"
                onReset={() => props.onFiltersChange({
                  ...props.filters,
                  eventPlatforms: defaultFilters.eventPlatforms,
                })}
              />
            )}
          </>
        ),
      };
    }

    if (field === "minimumEventCounts") {
      // Named rather than only marked on the input, because a rejected count stays where it was typed
      // while the popover header keeps showing the selection it failed to change.
      const rejectedMinimumCountLabels = analyticsThresholdEventTypes
        .filter((eventType) => minimumCountDrafts.has(eventType))
        .map((eventType) => analyticsThresholdEventTypeLabels[eventType]);

      return {
        summary: committedMinimumEventCountsSummary,
        isFiltered: props.filters.minimumEventCounts.length > 0,
        isWide: false,
        content: (
          <>
            <div className="filter-threshold-list">
              {analyticsThresholdEventTypes.map((eventType) => {
                const minimumCount = minimumCountByEventType.get(eventType);
                const draftMinimumCount = minimumCountDrafts.get(eventType);

                return (
                  <label
                    key={eventType}
                    className={`filter-threshold-option${minimumCount === undefined ? "" : " selected"}`}
                  >
                    <span>{analyticsThresholdEventTypeLabels[eventType]}</span>
                    {/*
                      A text input rather than a number one: a number input hands the handler an empty
                      string for anything it cannot parse yet, so typing a "." would read as "cleared"
                      and drop a threshold that was already applied, while the field went on showing
                      the text. Raw text keeps what was typed and what is applied two separate things.
                    */}
                    <input
                      type="text"
                      inputMode="numeric"
                      autoComplete="off"
                      placeholder="Any"
                      aria-invalid={draftMinimumCount !== undefined}
                      value={draftMinimumCount ?? (minimumCount === undefined ? "" : String(minimumCount))}
                      onChange={(event) => handleMinimumEventCountChange(
                        eventType,
                        event.currentTarget.value,
                      )}
                    />
                  </label>
                );
              })}
            </div>
            {rejectedMinimumCountLabels.length === 0 ? null : (
              <p className="filter-error" role="alert">
                Not applied: {rejectedMinimumCountLabels.join(", ")}. A threshold has to be a whole
                number of at least 1.
              </p>
            )}
            {props.filters.minimumEventCounts.length === 0 ? null : (
              <FilterFieldResetButton
                label="Clear every threshold"
                onReset={() => props.onFiltersChange({
                  ...props.filters,
                  minimumEventCounts: defaultFilters.minimumEventCounts,
                })}
              />
            )}
          </>
        ),
      };
    }

    if (field === "connectionCountries") {
      return buildOptionFieldView({
        selectedValues: props.filters.connectionCountries,
        options: props.connectionCountryOptions.map(toPlainOptionChoice),
        defaultValues: defaultFilters.connectionCountries,
        everyValueSummary: "Every country",
        emptyOptionsMessage: "No retained connection sample in this range.",
        resetLabel: "Select every country",
        onSelectionChange: (connectionCountries) => props.onFiltersChange({
          ...props.filters,
          connectionCountries,
        }),
      });
    }

    if (field === "appUiLanguages") {
      return buildOptionFieldView({
        selectedValues: props.filters.appUiLanguages,
        options: props.appUiLanguageOptions.map(toPlainOptionChoice),
        defaultValues: defaultFilters.appUiLanguages,
        everyValueSummary: "Every language",
        emptyOptionsMessage: "No event in this range recorded a UI language.",
        resetLabel: "Select every language",
        onSelectionChange: (appUiLanguages) => props.onFiltersChange({
          ...props.filters,
          appUiLanguages,
        }),
      });
    }

    // The five catalog fields below offer the whole history rather than the selected range, so an
    // empty list says that nothing was ever recorded rather than nothing in this range. The deck
    // field is answered by the install event itself; the four click dimensions need the originating
    // click of that install.
    if (field === "installedDecks") {
      const ambiguousDeckSlugs = buildAmbiguousDeckSlugs(
        props.catalogDeckOptions,
        props.filters.installedDecks,
      );

      return buildOptionFieldView({
        selectedValues: props.filters.installedDecks,
        options: props.catalogDeckOptions.map((deck) => ({
          value: deck.packageVersionId,
          label: `${deck.packageSlug} — ${deck.packageVersionId}`,
          summaryLabel: ambiguousDeckSlugs.has(deck.packageSlug)
            ? `${deck.packageSlug} — ${deck.packageVersionId.slice(0, deckVersionDiscriminatorLength)}`
            : deck.packageSlug,
        })),
        defaultValues: defaultFilters.installedDecks,
        everyValueSummary: "Every deck",
        emptyOptionsMessage: "No catalog deck install was ever recorded.",
        resetLabel: "Select every deck",
        onSelectionChange: (installedDecks) => props.onFiltersChange({
          ...props.filters,
          installedDecks,
        }),
      });
    }

    if (field === "catalogPlacements") {
      return buildOptionFieldView({
        selectedValues: props.filters.catalogPlacements,
        options: props.catalogPlacementOptions.map(toPlainOptionChoice),
        defaultValues: defaultFilters.catalogPlacements,
        everyValueSummary: "Every placement",
        emptyOptionsMessage: "No attributed click recorded a page placement.",
        resetLabel: "Select every placement",
        onSelectionChange: (catalogPlacements) => props.onFiltersChange({
          ...props.filters,
          catalogPlacements,
        }),
      });
    }

    if (field === "catalogSources") {
      return buildOptionFieldView({
        selectedValues: props.filters.catalogSources,
        options: props.catalogSourceOptions.map(toPlainOptionChoice),
        defaultValues: defaultFilters.catalogSources,
        everyValueSummary: "Every source",
        emptyOptionsMessage: "No attributed click recorded a traffic source.",
        resetLabel: "Select every source",
        onSelectionChange: (catalogSources) => props.onFiltersChange({
          ...props.filters,
          catalogSources,
        }),
      });
    }

    if (field === "catalogDeviceCategories") {
      return buildOptionFieldView({
        selectedValues: props.filters.catalogDeviceCategories,
        options: props.catalogDeviceCategoryOptions.map(toPlainOptionChoice),
        defaultValues: defaultFilters.catalogDeviceCategories,
        everyValueSummary: "Every device category",
        emptyOptionsMessage: "No attributed click recorded a device category.",
        resetLabel: "Select every device category",
        onSelectionChange: (catalogDeviceCategories) => props.onFiltersChange({
          ...props.filters,
          catalogDeviceCategories,
        }),
      });
    }

    if (field === "catalogClickBrowserLanguages") {
      return buildOptionFieldView({
        selectedValues: props.filters.catalogClickBrowserLanguages,
        options: props.catalogClickBrowserLanguageOptions.map(toPlainOptionChoice),
        defaultValues: defaultFilters.catalogClickBrowserLanguages,
        everyValueSummary: "Every browser language",
        emptyOptionsMessage: "No attributed click reported a browser language.",
        resetLabel: "Select every browser language",
        onSelectionChange: (catalogClickBrowserLanguages) => props.onFiltersChange({
          ...props.filters,
          catalogClickBrowserLanguages,
        }),
      });
    }

    return assertEveryFilterFieldIsWired(field);
  }

  const fieldViews = props.fields
    .map((field) => ({ field, view: buildFilterFieldView(field) }));
  const HeadingTag = props.headingLevel === 2 ? "h2" : "h3";

  return (
    <section className="filter-panel" aria-labelledby={props.headingId} ref={panelRef}>
      <div className="filter-panel-header">
        <div>
          <p className="eyebrow">Filters</p>
          <HeadingTag id={props.headingId}>{props.title}</HeadingTag>
        </div>
        {/*
          The range is stated by the page header and picked in the date field, so it is not repeated
          here. What stays is the reload feedback every action owes the user: this keeps its slot while
          idle and prints nothing, so a commit shows `Updating` in place without moving the header.
        */}
        <span className={`filter-status${props.isReportLoading ? " active" : ""}`} aria-live="polite">
          {props.isReportLoading ? "Updating" : ""}
        </span>
      </div>

      <div className="filter-bar" aria-labelledby={props.headingId}>
        {fieldViews.map((entry, index) => {
          const popoverId = `${props.headingId}-${entry.field}-popover`;
          const explanationId = `${props.headingId}-${entry.field}-explanation`;
          const fieldLabel = getAnalyticsFilterFieldLabel(props.area, entry.field);

          return (
            <div
              key={entry.field}
              className={getPopoverAnchorClassName(index, fieldViews.length, entry.view.isWide)}
            >
              {/*
                The button prints the field name alone, so the row stays one line of field names and no
                value is on screen twice. A filtered field is told apart by its colour and its dot; the
                selection itself is in the popover header, and reaches a screen reader through the
                button's accessible name, which keeps the visible label as its first words.
              */}
              <button
                ref={(buttonElement) => {
                  if (buttonElement === null) {
                    fieldButtonsRef.current.delete(entry.field);
                    return;
                  }

                  fieldButtonsRef.current.set(entry.field, buttonElement);
                }}
                className={getFilterButtonClassName(openField === entry.field, entry.view.isFiltered)}
                type="button"
                data-testid={`analytics-filter-${entry.field}`}
                aria-label={`${fieldLabel}: ${entry.view.summary}`}
                aria-expanded={openField === entry.field}
                aria-controls={popoverId}
                onClick={() => setOpenField(
                  (currentField) => (currentField === entry.field ? null : entry.field),
                )}
              >
                {entry.view.isFiltered ? (
                  <span className="filter-menu-dot" aria-hidden="true" />
                ) : null}
                {fieldLabel}
              </button>
              {openField === entry.field ? (
                <div id={popoverId} className="filter-popover">
                  <div className="filter-popover-header">
                    <span className="filter-popover-field">
                      <span>{fieldLabel}</span>
                      {/*
                        The explanations run to a paragraph, so one waits behind its `(i)` instead of
                        standing between the header and the picker. A real button with a described
                        tooltip rather than a `title`, because it has to be reachable by keyboard and
                        readable by a screen reader.
                      */}
                      <FilterFieldExplanation
                        fieldLabel={fieldLabel}
                        explanationId={explanationId}
                        explanation={getAnalyticsFilterFieldExplanation(props.area, entry.field)}
                      />
                    </span>
                    <span>{entry.view.summary}</span>
                  </div>
                  {/*
                    The scroll box is this wrapper rather than the popover, so the explanation
                    anchored to the header above is not clipped by it and the picker stays still while
                    the reader opens one.
                  */}
                  <div className="filter-popover-content">{entry.view.content}</div>
                </div>
              ) : null}
            </div>
          );
        })}

        <button
          className="filter-button filter-button-reset-all"
          type="button"
          disabled={props.isReportLoading}
          aria-label={props.resetAllLabel}
          onClick={handleAllFiltersReset}
        >
          Reset all
        </button>
      </div>

      {props.fields.includes("dateRange") && props.dateRangeError !== "" && openField !== "dateRange" ? (
        <p className="filter-error" role="alert">{props.dateRangeError}</p>
      ) : null}
    </section>
  );
}
