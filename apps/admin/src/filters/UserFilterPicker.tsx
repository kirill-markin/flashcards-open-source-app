import { useLayoutEffect, useMemo, useState, type JSX } from "react";
import type { ReviewEventsByDateUser } from "../adminApi";
import type { UserColorScale } from "../dashboard/userColors";
import { AdminLink } from "../navigation/AdminLink";
import { getUserPath } from "../routing";
import { FilterFieldResetButton } from "./FilterFieldResetButton";
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

// A user outside the offered range has no chart series to supply its colour.
const unknownUserSwatchColor = "rgba(255, 255, 255, 0.36)";

// A link inside the option's label: the label ignores a click on interactive content it holds, so
// following the link never toggles the checkbox.
function UserPageLink(
  props: Readonly<{
    userId: string;
    label: string;
    onNavigate: (path: string) => void;
  }>,
): JSX.Element {
  return (
    <AdminLink className="user-filter-open-link" path={getUserPath(props.userId, "profile")} onNavigate={props.onNavigate}>
      Open<span className="visually-hidden"> {props.label}</span>
    </AdminLink>
  );
}

function UserFilterOptions(
  props: Readonly<{
    searchableOptions: ReadonlyArray<SearchableUserFilterOption>;
    selectedUsersOutsideOptions: ReadonlyArray<ActiveUserFilter>;
    selectedUserIds: ReadonlyArray<string>;
    searchValue: string;
    userColorScale: UserColorScale;
    onSearchChange: (searchValue: string) => void;
    onSelectionChange: (selectedUserIds: ReadonlyArray<string>) => void;
    onNavigate: (path: string) => void;
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
  const selectedUserIds = useMemo(
    () => new Set(props.selectedUserIds),
    [props.selectedUserIds],
  );
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
  const matchingUsersOutsideOptions = useMemo(
    () => props.selectedUsersOutsideOptions.filter((userFilter) => (
      getNormalizedSearchValue(`${userFilter.label} ${userFilter.userId}`)
        .includes(normalizedSearchValue)
    )),
    [normalizedSearchValue, props.selectedUsersOutsideOptions],
  );
  const renderedUserCount = visibleOptions.length + matchingUsersOutsideOptions.length;
  const matchingUserCount = matchingOptions.length + matchingUsersOutsideOptions.length;

  function toggleUser(userId: string, isChecked: boolean): void {
    if (isChecked) {
      props.onSelectionChange(selectedUserIds.has(userId) ? props.selectedUserIds : [...props.selectedUserIds, userId]);
      return;
    }

    props.onSelectionChange(props.selectedUserIds.filter((selectedUserId) => selectedUserId !== userId));
  }

  if (searchableOptions.length === 0 && props.selectedUsersOutsideOptions.length === 0) {
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
      {renderedUserCount > 0 ? (
        <div className="user-filter-options">
          {matchingUsersOutsideOptions.map((userFilter) => (
            <label key={userFilter.userId} className="user-filter-option selected">
              <input
                type="checkbox"
                value={userFilter.userId}
                checked
                onChange={(event) => toggleUser(userFilter.userId, event.currentTarget.checked)}
              />
              <span
                className="user-filter-swatch"
                style={{ backgroundColor: unknownUserSwatchColor }}
              />
              <span className="user-filter-option-text">
                <span className="user-filter-option-primary">{userFilter.label}</span>
                <span className="user-filter-option-secondary">{userFilter.secondaryLabel}</span>
              </span>
              <UserPageLink userId={userFilter.userId} label={userFilter.label} onNavigate={props.onNavigate} />
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
                onChange={(event) => toggleUser(user.userId, event.currentTarget.checked)}
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
              <UserPageLink userId={user.userId} label={getUserFilterLabel(user)} onNavigate={props.onNavigate} />
            </label>
          ))}
        </div>
      ) : (
        <p className="user-filter-empty">No users match this search.</p>
      )}
      {renderedUserCount < matchingUserCount ? (
        <p className="user-filter-limit">
          Showing {renderedUserCount.toLocaleString("en-US")} of {matchingUserCount.toLocaleString("en-US")} matching users.
        </p>
      ) : null}
      {props.selectedUserIds.length === 0 ? null : (
        <FilterFieldResetButton label="Select all users" onReset={() => props.onSelectionChange([])} />
      )}
    </>
  );
}

export function useUserFilterPicker(props: Readonly<{
  userOptions: ReadonlyArray<ReviewEventsByDateUser>;
  selectedUserIds: ReadonlyArray<string>;
  isOpen: boolean;
  userColorScale: UserColorScale;
  onSelectionChange: (selectedUserIds: ReadonlyArray<string>) => void;
  onNavigate: (path: string) => void;
}>): JSX.Element {
  const [searchValue, setSearchValue] = useState<string>("");

  // The shell can hide the picker during an option reload without ending the search session.
  // Clear the preceding session's query before the next logical opening can paint.
  useLayoutEffect(() => {
    if (props.isOpen) {
      setSearchValue("");
    }
  }, [props.isOpen]);

  const userOptionById = useMemo(
    () => new Map(props.userOptions.map((user) => [user.userId, user])),
    [props.userOptions],
  );
  const searchableOptions = useMemo(
    () => buildSearchableUserFilterOptions(props.userOptions),
    [props.userOptions],
  );
  // Keep every selected user removable even if the current range has stopped offering them.
  const selectedUsersOutsideOptions = useMemo(
    () => buildActiveUserFilters(props.selectedUserIds, userOptionById)
      .filter((userFilter) => userFilter.hasUserInReport === false),
    [props.selectedUserIds, userOptionById],
  );

  return (
    <UserFilterOptions
      searchableOptions={searchableOptions}
      selectedUsersOutsideOptions={selectedUsersOutsideOptions}
      selectedUserIds={props.selectedUserIds}
      searchValue={searchValue}
      userColorScale={props.userColorScale}
      onSearchChange={setSearchValue}
      onSelectionChange={props.onSelectionChange}
      onNavigate={props.onNavigate}
    />
  );
}
