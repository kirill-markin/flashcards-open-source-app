import { useEffect, useMemo, useRef, useState, type JSX, type ReactNode } from "react";
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
import { analyticsAreaLabels, type AnalyticsArea } from "../routing";
import {
  analyticsFilterFieldsByArea,
  analyticsThresholdEventTypeLabels,
  analyticsThresholdEventTypes,
  buildDefaultAnalyticsFilterState,
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
  type SearchableUserFilterOption,
} from "./userFilters";

// The one filter bar every analytics area renders. It offers exactly the fields the filter model
// declares applicable to the active area, so a later field is wired in `buildFilterFieldView` rather
// than by editing this layout, and a field that does not apply to the area is absent rather than
// shown disabled.
//
// Every field reads the same way: its full label, its explanation in plain words as visible text
// rather than only as a hover title, the current selection as removable chips, a picker, and a reset
// to its default. The selection is committed on every click, so there is no draft to be overwritten
// by an arriving report.

const unknownUserSwatchColor = "rgba(255, 255, 255, 0.36)";
// A threshold, a country and a locale tag name no value a chart gives a colour to, so their chips and
// options take the accent every filtered control in the bar already uses.
const filterValueSwatchColor = "var(--accent-strong)";
// Above this many picked values the button prints a count instead, which is where the values stop
// fitting on one line of it.
const optionSummaryValueLimit = 3;
// Above this many values an option list stops being scannable in a popover and is searched instead.
const searchableFilterOptionCount = 15;
// The leading group of a deck version UUID, which is what tells two picked versions of one deck apart
// on the closed button without printing an id that would not fit there. The chips carry the whole id.
const deckVersionDiscriminatorLength = 8;

type AnalyticsFilterBarProps = Readonly<{
  area: AnalyticsArea;
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
  dateRangeError: string;
  /** Every country the range can offer, from the same range-scoped options query as `userOptions`. */
  connectionCountryOptions: ReadonlyArray<string>;
  /** Every app UI locale tag the range can offer, from that same query. */
  appUiLanguageOptions: ReadonlyArray<string>;
  /**
   * What the five catalog fields can offer. Unlike every list above, these are not scoped to the
   * range: the decks name every deck version ever installed and the four dimensions name the values
   * the originating clicks of completed installs carried, which is exactly what the user-scoped areas
   * can match. Funnels matches any click in range instead, so there these lists are a subset of what
   * a selection would match and the field explanations say so.
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

type FilterChip = Readonly<{
  value: string;
  label: string;
  secondaryLabel: string;
  swatchColor: string;
}>;

type FilterOption<Value extends string> = Readonly<{
  value: Value;
  label: string;
  swatchColor: string;
}>;

/** One pickable value of a field whose values carry no colour of their own. */
type FilterOptionChoice<Value extends string> = Readonly<{
  value: Value;
  /** What the checkbox and the chip print, where there is room for the whole value. */
  label: string;
  /** What the field button prints, where a deck version's full label would not fit. */
  summaryLabel: string;
}>;

/** What one field contributes to the bar; the shared shell around it is the same for every field. */
type FilterFieldView = Readonly<{
  /** The current selection in a few words, printed on the button and in the popover header. */
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

function FilterChipRow(
  props: Readonly<{
    fieldLabel: string;
    chips: ReadonlyArray<FilterChip>;
    onRemove: (value: string) => void;
  }>,
): JSX.Element | null {
  if (props.chips.length === 0) {
    return null;
  }

  return (
    <div className="active-filter-chips" aria-label={`Selected: ${props.fieldLabel}`}>
      {props.chips.map((chip) => (
        <span key={chip.value} className="active-filter-chip">
          <span className="active-filter-swatch" style={{ backgroundColor: chip.swatchColor }} />
          <span className="active-filter-text">
            <span>{chip.label}</span>
            {chip.secondaryLabel === "" ? null : <span>{chip.secondaryLabel}</span>}
          </span>
          <button
            className="active-filter-remove"
            type="button"
            aria-label={`Remove ${chip.label}`}
            onClick={() => props.onRemove(chip.value)}
          >
            x
          </button>
        </span>
      ))}
    </div>
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
  // The users list' own limit, because these lists render the same way and one number is what keeps
  // them from drifting apart; the count line below says how many more the search still matches.
  const visibleOptions = matchingOptions.slice(0, visibleUserFilterOptionLimit);
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
// its popover is open and would otherwise re-index every user on every open.
function UserFilterOptions(
  props: Readonly<{
    searchableOptions: ReadonlyArray<SearchableUserFilterOption>;
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
  const visibleOptions = matchingOptions.slice(0, visibleUserFilterOptionLimit);
  const hiddenOptionCount = matchingOptions.length - visibleOptions.length;

  if (searchableOptions.length === 0) {
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
      {visibleOptions.length > 0 ? (
        <div className="user-filter-options">
          {visibleOptions.map((user) => (
            <label
              key={user.userId}
              className={`user-filter-option${props.selectedUserIds.has(user.userId) ? " selected" : ""}`}
            >
              <input
                type="checkbox"
                value={user.userId}
                checked={props.selectedUserIds.has(user.userId)}
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
          Showing {visibleOptions.length.toLocaleString("en-US")} of {matchingOptions.length.toLocaleString("en-US")} matching users.
        </p>
      ) : null}
    </>
  );
}

/** The picked labels while they still fit on the button, and a count once they do not. */
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
// like countries and locale tags or a closed one like the catalog placements: chips for the selection,
// one checkbox per offered value, and a reset that clears the field. The options are deliberately
// independent of the selection, so a picked value that stopped being offered still shows as a chip and
// can still be removed, rather than sitting applied with no control for it - which is also why a value
// with no option to read a label from prints as itself.
function buildOptionFieldView<Value extends string>(props: Readonly<{
  fieldLabel: string;
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

  return {
    summary: getOptionSelectionSummary(selectedSummaryLabels, props.everyValueSummary),
    isFiltered: props.selectedValues.length > 0,
    isWide: false,
    content: (
      <>
        <FilterChipRow
          fieldLabel={props.fieldLabel}
          chips={props.selectedValues.map((value) => ({
            value,
            label: optionsByValue.get(value)?.label ?? value,
            secondaryLabel: "",
            swatchColor: filterValueSwatchColor,
          }))}
          onRemove={(value) => props.onSelectionChange(
            props.selectedValues.filter((selectedValue) => selectedValue !== value),
          )}
        />
        {props.options.length === 0 ? (
          <p className="filter-option-empty">{props.emptyOptionsMessage}</p>
        ) : (
          <FilterOptionList
            options={props.options.map((option) => ({
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

// Only the slug fits on the closed deck button, so two picked versions of one deck would read there
// as the same word twice. The slugs that more than one picked version shares are the ones that have
// to carry a discriminator; every other slug stays a bare word.
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

  // The applicable fields differ by area, so moving to an area that does not render the open field
  // would hide its popover while the outside-click and Escape effect below stayed armed on a control
  // nobody can see or dismiss.
  useEffect(() => {
    setOpenField((currentField) => (
      currentField === null || analyticsFilterFieldsByArea[props.area].includes(currentField)
        ? currentField
        : null
    ));
  }, [props.area]);

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

  // The committed thresholds as one string, which is what the field button reads.
  const committedMinimumEventCountsSummary = getMinimumEventCountsSummary(
    props.filters.minimumEventCounts,
  );

  // Opening or closing any popover ends every draft at once: the input a draft was typed in is gone,
  // so there is nothing left for the text to be finished in.
  useEffect(() => {
    setMinimumCountDrafts((drafts) => (drafts.size === 0 ? drafts : new Map()));
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
  // `Reset all`, `Clear every threshold`, a removed chip and the user's own accepted keystroke. It
  // ends the draft on that event type alone: an accepted count typed into one input must not erase
  // text still being edited in another, untouched one. The previous counts are held in a ref because
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
  const selectedUserFilters = useMemo(
    () => buildActiveUserFilters(props.filters.users, userOptionById),
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

  // An empty input is no threshold on that event type, which is how this input clears one; removing
  // its chip and `Clear every threshold` clear one too. Text that does not name a whole count of at
  // least one is not a threshold this filter can hold: it is kept as a draft and named as not
  // applied, so the selection it failed to change stays exactly what the chips and the summary say it
  // is, rather than being silently dropped or reread into a different one. A keystroke that lands on
  // the count already applied commits nothing, because every commit repaints the bar as `Updating`
  // and refetches every report in the area.
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
    props.onFiltersChange(defaultFilters);

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
            <FilterChipRow
              fieldLabel={getAnalyticsFilterFieldLabel(props.area, "users")}
              chips={selectedUserFilters.map((userFilter) => ({
                value: userFilter.userId,
                label: userFilter.label,
                secondaryLabel: userFilter.secondaryLabel,
                swatchColor: userFilter.hasUserInReport
                  ? props.userColorScale(userFilter.userId)
                  : unknownUserSwatchColor,
              }))}
              onRemove={(userId) => props.onFiltersChange({
                ...props.filters,
                users: props.filters.users.filter((selectedUserId) => selectedUserId !== userId),
              })}
            />
            <UserFilterOptions
              searchableOptions={searchableUserOptions}
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
            <FilterChipRow
              fieldLabel={getAnalyticsFilterFieldLabel(props.area, "userCohorts")}
              chips={reviewEventCohorts
                .filter((cohort) => selectedCohorts.has(cohort))
                .map((cohort) => ({
                  value: cohort,
                  label: uniqueUserCohortLabels[cohort],
                  secondaryLabel: "",
                  swatchColor: uniqueUserCohortColors[cohort],
                }))}
              onRemove={(cohort) => props.onFiltersChange({
                ...props.filters,
                userCohorts: props.filters.userCohorts.filter(
                  (selectedCohort) => selectedCohort !== cohort,
                ),
              })}
            />
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
            <FilterChipRow
              fieldLabel={getAnalyticsFilterFieldLabel(props.area, "eventPlatforms")}
              chips={reviewEventPlatforms
                .filter((platform) => selectedPlatforms.has(platform))
                .map((platform) => ({
                  value: platform,
                  label: platformLabels[platform],
                  secondaryLabel: "",
                  swatchColor: getPlatformColor(platform),
                }))}
              onRemove={(platform) => props.onFiltersChange({
                ...props.filters,
                eventPlatforms: props.filters.eventPlatforms.filter(
                  (selectedPlatform) => selectedPlatform !== platform,
                ),
              })}
            />
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
      // while the chips keep showing the selection it failed to change.
      const rejectedMinimumCountLabels = analyticsThresholdEventTypes
        .filter((eventType) => minimumCountDrafts.has(eventType))
        .map((eventType) => analyticsThresholdEventTypeLabels[eventType]);

      return {
        summary: committedMinimumEventCountsSummary,
        isFiltered: props.filters.minimumEventCounts.length > 0,
        isWide: false,
        content: (
          <>
            <FilterChipRow
              fieldLabel={getAnalyticsFilterFieldLabel(props.area, "minimumEventCounts")}
              chips={props.filters.minimumEventCounts.map((entry) => ({
                value: entry.eventType,
                label: formatMinimumEventCountLabel(entry),
                secondaryLabel: "",
                swatchColor: filterValueSwatchColor,
              }))}
              onRemove={(eventType) => props.onFiltersChange({
                ...props.filters,
                minimumEventCounts: props.filters.minimumEventCounts.filter(
                  (entry) => entry.eventType !== eventType,
                ),
              })}
            />
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
        fieldLabel: getAnalyticsFilterFieldLabel(props.area, "connectionCountries"),
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
        fieldLabel: getAnalyticsFilterFieldLabel(props.area, "appUiLanguages"),
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
        fieldLabel: getAnalyticsFilterFieldLabel(props.area, "installedDecks"),
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
        fieldLabel: getAnalyticsFilterFieldLabel(props.area, "catalogPlacements"),
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
        fieldLabel: getAnalyticsFilterFieldLabel(props.area, "catalogSources"),
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
        fieldLabel: getAnalyticsFilterFieldLabel(props.area, "catalogDeviceCategories"),
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
        fieldLabel: getAnalyticsFilterFieldLabel(props.area, "catalogClickBrowserLanguages"),
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

  const fieldViews = analyticsFilterFieldsByArea[props.area]
    .map((field) => ({ field, view: buildFilterFieldView(field) }));

  return (
    <section className="filter-panel" aria-labelledby="analytics-filters-title" ref={panelRef}>
      <div className="filter-panel-header">
        <div>
          <p className="eyebrow">Filters</p>
          <h2 id="analytics-filters-title">Filters</h2>
        </div>
        <span className={`filter-status${props.isReportLoading ? " active" : ""}`} aria-live="polite">
          {props.isReportLoading ? "Updating" : `Default ${props.defaultRange.from} to ${props.defaultRange.to}`}
        </span>
      </div>

      <div className="filter-bar" aria-label={`${analyticsAreaLabels[props.area]} filters`}>
        {fieldViews.map((entry, index) => {
          const popoverId = `analytics-filter-${entry.field}-popover`;
          const fieldLabel = getAnalyticsFilterFieldLabel(props.area, entry.field);

          return (
            <div
              key={entry.field}
              className={getPopoverAnchorClassName(index, fieldViews.length, entry.view.isWide)}
            >
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
                aria-expanded={openField === entry.field}
                aria-controls={popoverId}
                onClick={() => setOpenField(
                  (currentField) => (currentField === entry.field ? null : entry.field),
                )}
              >
                {fieldLabel}: {entry.view.summary}
              </button>
              {openField === entry.field ? (
                <div id={popoverId} className="filter-popover">
                  <div className="filter-popover-header">
                    <span>{fieldLabel}</span>
                    <span>{entry.view.summary}</span>
                  </div>
                  <p className="filter-popover-explanation">
                    {getAnalyticsFilterFieldExplanation(props.area, entry.field)}
                  </p>
                  {entry.view.content}
                </div>
              ) : null}
            </div>
          );
        })}

        <button
          className="filter-button filter-button-reset-all"
          type="button"
          disabled={props.isReportLoading}
          onClick={handleAllFiltersReset}
        >
          Reset all
        </button>
      </div>

      {props.dateRangeError !== "" && openField !== "dateRange" ? (
        <p className="filter-error" role="alert">{props.dateRangeError}</p>
      ) : null}
    </section>
  );
}
