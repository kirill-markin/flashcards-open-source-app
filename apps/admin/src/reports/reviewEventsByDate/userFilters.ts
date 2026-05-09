import type { ReviewEventsByDateUser } from "../../adminApi";

export type ActiveUserFilter = Readonly<{
  userId: string;
  label: string;
  secondaryLabel: string;
  hasUserInReport: boolean;
}>;

export type SearchableUserFilterOption = Readonly<{
  user: ReviewEventsByDateUser;
  searchableValue: string;
}>;

export const visibleUserFilterOptionLimit = 50;

export function getUserFilterLabel(user: ReviewEventsByDateUser): string {
  return user.email === "(no email)" ? user.userId : user.email;
}

export function getUserFilterSecondaryLabel(user: ReviewEventsByDateUser): string {
  return user.email === "(no email)" ? user.email : user.userId;
}

export function getNormalizedSearchValue(value: string): string {
  return value.trim().toLocaleLowerCase("en-US");
}

export function getUserFilterSearchableValue(user: ReviewEventsByDateUser): string {
  return getNormalizedSearchValue([
    getUserFilterLabel(user),
    user.userId,
    user.email,
  ].join(" "));
}

export function doesUserMatchSearch(
  option: SearchableUserFilterOption,
  normalizedSearchValue: string,
): boolean {
  return normalizedSearchValue === "" || option.searchableValue.includes(normalizedSearchValue);
}

export function buildActiveUserFilters(
  selectedUserIds: ReadonlyArray<string>,
  userById: ReadonlyMap<string, ReviewEventsByDateUser>,
): ReadonlyArray<ActiveUserFilter> {
  return selectedUserIds.map((userId) => {
    const user = userById.get(userId);
    return {
      userId,
      label: user === undefined ? userId : getUserFilterLabel(user),
      secondaryLabel: user === undefined ? "No review events in range" : getUserFilterSecondaryLabel(user),
      hasUserInReport: user !== undefined,
    };
  });
}

export function buildSearchableUserFilterOptions(
  users: ReadonlyArray<ReviewEventsByDateUser>,
): ReadonlyArray<SearchableUserFilterOption> {
  return users.map((user) => ({
    user,
    searchableValue: getUserFilterSearchableValue(user),
  }));
}
