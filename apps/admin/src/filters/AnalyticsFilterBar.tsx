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
import { analyticsAreaLabels, type AnalyticsArea } from "../routing";
import {
  analyticsFilterFieldLabels,
  analyticsFilterFieldsByArea,
  buildDefaultAnalyticsFilterState,
  getAnalyticsFilterFieldExplanation,
  type AnalyticsDateRange,
  type AnalyticsFilterField,
  type AnalyticsFilterState,
} from "./analyticsFilters";
import { DateRangeCalendar, type DateRangeCalendarRange } from "./DateRangeCalendar";
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

function FilterOptionList<Value extends string>(
  props: Readonly<{
    options: ReadonlyArray<FilterOption<Value>>;
    selectedValues: ReadonlySet<Value>;
    onToggle: (value: Value, isChecked: boolean) => void;
  }>,
): JSX.Element {
  return (
    <div className="filter-option-list">
      {props.options.map((option) => (
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

  const defaultFilters = buildDefaultAnalyticsFilterState(props.defaultRange);
  const selectedUserIds = useMemo(() => new Set(props.filters.users), [props.filters.users]);
  const selectedCohorts = useMemo(() => new Set(props.filters.userCohorts), [props.filters.userCohorts]);
  const selectedPlatforms = useMemo(
    () => new Set(props.filters.eventPlatforms),
    [props.filters.eventPlatforms],
  );
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

  function handleAllFiltersReset(): void {
    setUserSearchValue("");
    props.onFiltersChange(defaultFilters);

    if (openField !== null) {
      closeField(openField, true);
    }
  }

  function buildFilterFieldView(field: AnalyticsFilterField): FilterFieldView | null {
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
              fieldLabel={analyticsFilterFieldLabels.users}
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
              fieldLabel={analyticsFilterFieldLabels.userCohorts}
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
              fieldLabel={analyticsFilterFieldLabels.eventPlatforms}
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

    // The remaining fields of the filter model are declared and already reach SQL, but their
    // controls are not built yet: thresholds, countries and languages, and the catalog attribution
    // fields each land with their own item. An unwired field is left out of the bar rather than
    // shown as an empty control.
    return null;
  }

  const fieldViews = analyticsFilterFieldsByArea[props.area]
    .map((field) => ({ field, view: buildFilterFieldView(field) }))
    .filter((entry): entry is Readonly<{ field: AnalyticsFilterField; view: FilterFieldView }> => (
      entry.view !== null
    ));

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
          const fieldLabel = analyticsFilterFieldLabels[entry.field];

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
