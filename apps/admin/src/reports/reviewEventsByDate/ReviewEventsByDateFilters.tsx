import type { FormEvent, JSX } from "react";
import type { ReviewEventsByDateUser } from "../../adminApi";
import type { ReviewEventsByDateRange } from "./query";
import { getUserFilterLabel, type ActiveUserFilter } from "./userFilters";

type ReviewEventsByDateFiltersProps = Readonly<{
  defaultRange: ReviewEventsByDateRange;
  draftRange: ReviewEventsByDateRange;
  isReportLoading: boolean;
  dateRangeError: string;
  reportUsers: ReadonlyArray<ReviewEventsByDateUser>;
  selectedUserIds: ReadonlyArray<string>;
  selectedUserIdSet: ReadonlySet<string>;
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
}>;

export function ReviewEventsByDateFilters(props: ReviewEventsByDateFiltersProps): JSX.Element {
  function handleDateRangeSubmit(event: FormEvent<HTMLFormElement>): void {
    event.preventDefault();
    props.onDateRangeSubmit();
  }

  return (
    <section className="filter-panel" aria-labelledby="review-filters-title">
      <div className="filter-panel-header">
        <div>
          <p className="eyebrow">Filters</p>
          <h2 id="review-filters-title">Filters</h2>
        </div>
        <span className={`filter-status${props.isReportLoading ? " active" : ""}`} aria-live="polite">
          {props.isReportLoading ? "Updating" : `Default ${props.defaultRange.from} to ${props.defaultRange.to}`}
        </span>
      </div>
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
        <div className="date-filter-actions">
          <button className="filter-button filter-button-primary" type="submit" disabled={props.isReportLoading}>
            Apply
          </button>
          <button
            className="filter-button"
            type="button"
            disabled={props.isReportLoading}
            onClick={props.onDateRangeReset}
          >
            Reset
          </button>
        </div>
      </form>
      <div className="user-filter-section" aria-label="User filter">
        <div className="user-filter-header">
          <span>User</span>
          <span>
            {props.selectedUserIds.length === 0
              ? "All users"
              : `${props.selectedUserIds.length} selected`}
          </span>
        </div>
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
                    <span className="user-filter-swatch" style={{ backgroundColor: props.userColorScale(user.userId) }} />
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
      </div>
      {props.dateRangeError !== "" ? (
        <p className="filter-error" role="alert">{props.dateRangeError}</p>
      ) : null}
    </section>
  );
}
