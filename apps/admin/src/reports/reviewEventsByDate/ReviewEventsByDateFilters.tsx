import { useEffect, useRef, useState, type FormEvent, type JSX, type ReactNode } from "react";
import {
  reviewEventCohorts,
  reviewEventPlatforms,
  type ReviewEventCohort,
  type ReviewEventPlatform,
  type ReviewEventsByDateUser,
} from "../../adminApi";
import {
  getPlatformColor,
  platformLabels,
  uniqueUserCohortColors,
  uniqueUserCohortLabels,
} from "./chartModel";
import type { ReviewEventsByDateRange } from "./query";
import { getUserFilterLabel, type ActiveUserFilter } from "./userFilters";

type ReviewEventsByDateFilterPopover = "time" | "users" | "cohort" | "platform";

type FilterButtonClassNameState = Readonly<{
  isActive: boolean;
  isFiltered: boolean;
}>;

type ReviewEventsByDateFiltersProps = Readonly<{
  defaultRange: ReviewEventsByDateRange;
  appliedRange: ReviewEventsByDateRange;
  draftRange: ReviewEventsByDateRange;
  isReportLoading: boolean;
  dateRangeError: string;
  reportUsers: ReadonlyArray<ReviewEventsByDateUser>;
  selectedUserIds: ReadonlyArray<string>;
  selectedUserIdSet: ReadonlySet<string>;
  selectedCohorts: ReadonlyArray<ReviewEventCohort>;
  selectedCohortSet: ReadonlySet<ReviewEventCohort>;
  selectedPlatforms: ReadonlyArray<ReviewEventPlatform>;
  selectedPlatformSet: ReadonlySet<ReviewEventPlatform>;
  userFilterSearchValue: string;
  visibleUserFilterOptions: ReadonlyArray<ReviewEventsByDateUser>;
  matchingUserFilterOptionCount: number;
  hiddenUserFilterOptionCount: number;
  activeUserFilters: ReadonlyArray<ActiveUserFilter>;
  userColorScale: (userId: string) => string;
  onFromDateChange: (from: string) => void;
  onToDateChange: (to: string) => void;
  onDateRangeSubmit: () => void;
  onDateRangeReset: () => void;
  onUserFilterSearchChange: (searchValue: string) => void;
  onUserFilterChange: (userId: string, isChecked: boolean) => void;
  onUserFilterRemove: (userId: string) => void;
  onUserFilterClear: () => void;
  onCohortFilterChange: (cohort: ReviewEventCohort, isChecked: boolean) => void;
  onPlatformFilterChange: (platform: ReviewEventPlatform, isChecked: boolean) => void;
  onAllFiltersReset: () => void;
}>;

function getFilterButtonClassName(state: FilterButtonClassNameState): string {
  const classNames = ["filter-menu-button"];

  if (state.isActive) {
    classNames.push("active");
  }

  if (state.isFiltered) {
    classNames.push("filtered");
  }

  return classNames.join(" ");
}

function getUserFilterButtonLabel(selectedUserCount: number): string {
  return selectedUserCount === 0 ? "Users: All users" : `Users: ${selectedUserCount} selected`;
}

function getCohortFilterButtonLabel(selectedCohorts: ReadonlyArray<ReviewEventCohort>): string {
  if (selectedCohorts.length === 0) {
    return "Cohort: None";
  }

  const selectedLabels = reviewEventCohorts
    .filter((cohort) => selectedCohorts.includes(cohort))
    .map((cohort) => uniqueUserCohortLabels[cohort]);

  return `Cohort: ${selectedLabels.join(" + ")}`;
}

function getPlatformFilterButtonLabel(selectedPlatforms: ReadonlyArray<ReviewEventPlatform>): string {
  if (selectedPlatforms.length === 0) {
    return "Platform: None";
  }

  const selectedLabels = reviewEventPlatforms
    .filter((platform) => selectedPlatforms.includes(platform))
    .map((platform) => platformLabels[platform]);

  return `Platform: ${selectedLabels.join(" + ")}`;
}

function getUserFilterCountLabel(selectedUserIds: ReadonlyArray<string>): string {
  return selectedUserIds.length === 0
    ? "All users"
    : `${selectedUserIds.length.toLocaleString("en-US")} selected`;
}

function FilterPopover(
  props: Readonly<{
    id: string;
    children: ReactNode;
  }>,
): JSX.Element {
  return (
    <div id={props.id} className="filter-popover">
      {props.children}
    </div>
  );
}

export function ReviewEventsByDateFilters(props: ReviewEventsByDateFiltersProps): JSX.Element {
  const [activePopover, setActivePopover] = useState<ReviewEventsByDateFilterPopover | null>(null);
  const panelRef = useRef<HTMLElement | null>(null);
  const timeButtonRef = useRef<HTMLButtonElement | null>(null);
  const usersButtonRef = useRef<HTMLButtonElement | null>(null);
  const cohortButtonRef = useRef<HTMLButtonElement | null>(null);
  const platformButtonRef = useRef<HTMLButtonElement | null>(null);

  function getPopoverTriggerElement(popover: ReviewEventsByDateFilterPopover): HTMLButtonElement | null {
    if (popover === "time") {
      return timeButtonRef.current;
    }

    if (popover === "users") {
      return usersButtonRef.current;
    }

    if (popover === "cohort") {
      return cohortButtonRef.current;
    }

    return platformButtonRef.current;
  }

  function focusPopoverTrigger(popover: ReviewEventsByDateFilterPopover): void {
    const triggerElement = getPopoverTriggerElement(popover);
    if (triggerElement === null || triggerElement.disabled) {
      return;
    }

    triggerElement.focus();
  }

  function closePopover(popover: ReviewEventsByDateFilterPopover, shouldRestoreFocus: boolean): void {
    setActivePopover((currentPopover) => (currentPopover === popover ? null : currentPopover));

    if (shouldRestoreFocus) {
      window.requestAnimationFrame(() => focusPopoverTrigger(popover));
    }
  }

  function closeActivePopover(shouldRestoreFocus: boolean): void {
    if (activePopover === null) {
      return;
    }

    closePopover(activePopover, shouldRestoreFocus);
  }

  useEffect(() => {
    if (activePopover === null) {
      return;
    }

    const popoverToClose = activePopover;

    function handlePointerDown(event: PointerEvent): void {
      const panelElement = panelRef.current;
      if (panelElement === null || event.target instanceof Node === false) {
        return;
      }

      if (panelElement.contains(event.target) === false) {
        closePopover(popoverToClose, false);
      }
    }

    function handleKeyDown(event: KeyboardEvent): void {
      if (event.key === "Escape") {
        event.preventDefault();
        closePopover(popoverToClose, true);
      }
    }

    document.addEventListener("pointerdown", handlePointerDown);
    document.addEventListener("keydown", handleKeyDown);

    return () => {
      document.removeEventListener("pointerdown", handlePointerDown);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [activePopover]);

  function handleDateRangeSubmit(event: FormEvent<HTMLFormElement>): void {
    event.preventDefault();
    props.onDateRangeSubmit();
  }

  function handleDateRangeReset(): void {
    props.onDateRangeReset();
    closePopover("time", true);
  }

  function handleAllFiltersReset(): void {
    props.onAllFiltersReset();
    closeActivePopover(true);
  }

  function handlePopoverToggle(popover: ReviewEventsByDateFilterPopover): void {
    setActivePopover((currentPopover) => (currentPopover === popover ? null : popover));
  }

  const timePopoverId = "review-filter-time-popover";
  const usersPopoverId = "review-filter-users-popover";
  const cohortPopoverId = "review-filter-cohort-popover";
  const platformPopoverId = "review-filter-platform-popover";
  const isTimeFilterActive = props.appliedRange.from !== props.defaultRange.from || props.appliedRange.to !== props.defaultRange.to;
  const isUserFilterActive = props.selectedUserIds.length > 0;
  const isCohortFilterActive = props.selectedCohorts.length !== reviewEventCohorts.length;
  const isPlatformFilterActive = props.selectedPlatforms.length !== reviewEventPlatforms.length;

  return (
    <section className="filter-panel" aria-labelledby="review-filters-title" ref={panelRef}>
      <div className="filter-panel-header">
        <div>
          <p className="eyebrow">Filters</p>
          <h2 id="review-filters-title">Filters</h2>
        </div>
        <span className={`filter-status${props.isReportLoading ? " active" : ""}`} aria-live="polite">
          {props.isReportLoading ? "Updating" : `Default ${props.defaultRange.from} to ${props.defaultRange.to}`}
        </span>
      </div>

      <div className="filter-bar" aria-label="Report filters">
        <div className="filter-popover-anchor filter-popover-anchor-start filter-popover-anchor-wide">
          <button
            ref={timeButtonRef}
            className={getFilterButtonClassName({
              isActive: activePopover === "time",
              isFiltered: isTimeFilterActive,
            })}
            type="button"
            aria-expanded={activePopover === "time"}
            aria-controls={timePopoverId}
            disabled={props.isReportLoading}
            onClick={() => handlePopoverToggle("time")}
          >
            Time: {props.appliedRange.from} to {props.appliedRange.to}
          </button>
          {activePopover === "time" ? (
            <FilterPopover id={timePopoverId}>
              <form className="date-filter-form" noValidate onSubmit={handleDateRangeSubmit}>
                <label className="date-filter-field">
                  <span>From</span>
                  <input
                    type="date"
                    value={props.draftRange.from}
                    min={props.defaultRange.from}
                    max={props.defaultRange.to}
                    disabled={props.isReportLoading}
                    onChange={(event) => props.onFromDateChange(event.currentTarget.value)}
                  />
                </label>
                <label className="date-filter-field">
                  <span>To</span>
                  <input
                    type="date"
                    value={props.draftRange.to}
                    min={props.defaultRange.from}
                    max={props.defaultRange.to}
                    disabled={props.isReportLoading}
                    onChange={(event) => props.onToDateChange(event.currentTarget.value)}
                  />
                </label>
                {props.dateRangeError !== "" ? (
                  <p className="filter-error filter-popover-error" role="alert">{props.dateRangeError}</p>
                ) : null}
                <div className="date-filter-actions">
                  <button className="filter-button filter-button-primary" type="submit" disabled={props.isReportLoading}>
                    Apply
                  </button>
                  <button
                    className="filter-button"
                    type="button"
                    disabled={props.isReportLoading}
                    onClick={handleDateRangeReset}
                  >
                    Reset time
                  </button>
                </div>
              </form>
            </FilterPopover>
          ) : null}
        </div>

        <div className="filter-popover-anchor filter-popover-anchor-center filter-popover-anchor-wide">
          <button
            ref={usersButtonRef}
            className={getFilterButtonClassName({
              isActive: activePopover === "users",
              isFiltered: isUserFilterActive,
            })}
            type="button"
            aria-expanded={activePopover === "users"}
            aria-controls={usersPopoverId}
            disabled={props.isReportLoading}
            onClick={() => handlePopoverToggle("users")}
          >
            {getUserFilterButtonLabel(props.selectedUserIds.length)}
          </button>
          {activePopover === "users" ? (
            <FilterPopover id={usersPopoverId}>
              <div className="filter-popover-header">
                <span>User</span>
                <span>{getUserFilterCountLabel(props.selectedUserIds)}</span>
              </div>
              {props.activeUserFilters.length > 0 ? (
                <div className="active-filter-chips" aria-label="Active user filters">
                  {props.activeUserFilters.map((filter) => (
                    <span key={filter.userId} className="active-filter-chip">
                      <span
                        className="active-filter-swatch"
                        style={{
                          backgroundColor: filter.hasUserInReport
                            ? props.userColorScale(filter.userId)
                            : "rgba(255, 255, 255, 0.36)",
                        }}
                      />
                      <span className="active-filter-text">
                        <span>{filter.label}</span>
                        <span>{filter.secondaryLabel}</span>
                      </span>
                      <button
                        className="active-filter-remove"
                        type="button"
                        disabled={props.isReportLoading}
                        aria-label={`Remove user filter ${filter.label}`}
                        onClick={() => props.onUserFilterRemove(filter.userId)}
                      >
                        x
                      </button>
                    </span>
                  ))}
                  <button
                    className="filter-button filter-button-compact"
                    type="button"
                    disabled={props.isReportLoading}
                    onClick={props.onUserFilterClear}
                  >
                    Clear users
                  </button>
                </div>
              ) : null}
              {props.reportUsers.length > 0 ? (
                <>
                  <label className="user-filter-search">
                    <span>Search users</span>
                    <input
                      type="search"
                      value={props.userFilterSearchValue}
                      placeholder="Email or user ID"
                      disabled={props.isReportLoading}
                      onChange={(event) => props.onUserFilterSearchChange(event.currentTarget.value)}
                    />
                  </label>
                  {props.visibleUserFilterOptions.length > 0 ? (
                    <div className="user-filter-options">
                      {props.visibleUserFilterOptions.map((user) => (
                        <label
                          key={user.userId}
                          className={`user-filter-option${props.selectedUserIdSet.has(user.userId) ? " selected" : ""}`}
                        >
                          <input
                            type="checkbox"
                            value={user.userId}
                            checked={props.selectedUserIdSet.has(user.userId)}
                            disabled={props.isReportLoading}
                            onChange={(event) => props.onUserFilterChange(user.userId, event.currentTarget.checked)}
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
                  {props.hiddenUserFilterOptionCount > 0 ? (
                    <p className="user-filter-limit">
                      Showing {props.visibleUserFilterOptions.length.toLocaleString("en-US")} of {props.matchingUserFilterOptionCount.toLocaleString("en-US")} matching users.
                    </p>
                  ) : null}
                </>
              ) : (
                <p className="user-filter-empty">No users with review events in this range.</p>
              )}
            </FilterPopover>
          ) : null}
        </div>

        <div className="filter-popover-anchor filter-popover-anchor-end">
          <button
            ref={cohortButtonRef}
            className={getFilterButtonClassName({
              isActive: activePopover === "cohort",
              isFiltered: isCohortFilterActive,
            })}
            type="button"
            aria-expanded={activePopover === "cohort"}
            aria-controls={cohortPopoverId}
            disabled={props.isReportLoading}
            onClick={() => handlePopoverToggle("cohort")}
          >
            {getCohortFilterButtonLabel(props.selectedCohorts)}
          </button>
          {activePopover === "cohort" ? (
            <FilterPopover id={cohortPopoverId}>
              <div className="filter-popover-header">
                <span>Cohort</span>
                <span>{props.selectedCohorts.length.toLocaleString("en-US")} selected</span>
              </div>
              <div className="filter-option-list">
                {reviewEventCohorts.map((cohort) => (
                  <label
                    key={cohort}
                    className={`filter-checkbox-option${props.selectedCohortSet.has(cohort) ? " selected" : ""}`}
                  >
                    <input
                      type="checkbox"
                      checked={props.selectedCohortSet.has(cohort)}
                      disabled={props.isReportLoading}
                      onChange={(event) => props.onCohortFilterChange(cohort, event.currentTarget.checked)}
                    />
                    <span className="platform-key-swatch" style={{ backgroundColor: uniqueUserCohortColors[cohort] }} />
                    <span>{uniqueUserCohortLabels[cohort]}</span>
                  </label>
                ))}
              </div>
            </FilterPopover>
          ) : null}
        </div>

        <div className="filter-popover-anchor filter-popover-anchor-end">
          <button
            ref={platformButtonRef}
            className={getFilterButtonClassName({
              isActive: activePopover === "platform",
              isFiltered: isPlatformFilterActive,
            })}
            type="button"
            aria-expanded={activePopover === "platform"}
            aria-controls={platformPopoverId}
            disabled={props.isReportLoading}
            onClick={() => handlePopoverToggle("platform")}
          >
            {getPlatformFilterButtonLabel(props.selectedPlatforms)}
          </button>
          {activePopover === "platform" ? (
            <FilterPopover id={platformPopoverId}>
              <div className="filter-popover-header">
                <span>Platform</span>
                <span>{props.selectedPlatforms.length.toLocaleString("en-US")} selected</span>
              </div>
              <div className="filter-option-list">
                {reviewEventPlatforms.map((platform) => (
                  <label
                    key={platform}
                    className={`filter-checkbox-option${props.selectedPlatformSet.has(platform) ? " selected" : ""}`}
                  >
                    <input
                      type="checkbox"
                      checked={props.selectedPlatformSet.has(platform)}
                      disabled={props.isReportLoading}
                      onChange={(event) => props.onPlatformFilterChange(platform, event.currentTarget.checked)}
                    />
                    <span className="platform-key-swatch" style={{ backgroundColor: getPlatformColor(platform) }} />
                    <span>{platformLabels[platform]}</span>
                  </label>
                ))}
              </div>
            </FilterPopover>
          ) : null}
        </div>

        <button
          className="filter-button filter-button-reset-all"
          type="button"
          disabled={props.isReportLoading}
          onClick={handleAllFiltersReset}
        >
          Reset all
        </button>
      </div>

      {props.dateRangeError !== "" && activePopover !== "time" ? (
        <p className="filter-error" role="alert">{props.dateRangeError}</p>
      ) : null}
    </section>
  );
}
