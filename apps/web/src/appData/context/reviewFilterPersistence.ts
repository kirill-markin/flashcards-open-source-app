import type { ReviewFilter, WorkspaceSummary } from "../../types";
import {
  ALL_CARDS_REVIEW_FILTER,
  makeTagsReviewFilter,
  normalizeReviewFilter,
} from "../domain";

export const LEGACY_SELECTED_REVIEW_FILTER_STORAGE_KEY = "selected-review-filter";
export const SELECTED_REVIEW_FILTER_STORAGE_KEY_PREFIX = "selected-review-filter:";

export type WorkspaceReviewFilterState = Readonly<{
  activeWorkspace: WorkspaceSummary | null;
  selection: Readonly<{
    workspaceId: string | null;
    reviewFilter: ReviewFilter;
  }>;
}>;

export function buildSelectedReviewFilterStorageKey(workspaceId: string): string {
  return `${SELECTED_REVIEW_FILTER_STORAGE_KEY_PREFIX}${workspaceId}`;
}

export function parsePersistedReviewFilter(value: string | null): ReviewFilter {
  if (value === null) {
    return ALL_CARDS_REVIEW_FILTER;
  }

  try {
    const parsedValue = JSON.parse(value) as unknown;
    if (typeof parsedValue !== "object" || parsedValue === null || !("kind" in parsedValue)) {
      return ALL_CARDS_REVIEW_FILTER;
    }

    if (parsedValue.kind === "allCards") {
      return ALL_CARDS_REVIEW_FILTER;
    }

    if (
      parsedValue.kind === "tags"
      && "tags" in parsedValue
      && Array.isArray(parsedValue.tags)
      && parsedValue.tags.every((tag) => typeof tag === "string")
    ) {
      return makeTagsReviewFilter(parsedValue.tags);
    }

    if (
      parsedValue.kind === "tag"
      && "tag" in parsedValue
      && typeof parsedValue.tag === "string"
      && parsedValue.tag.trim() !== ""
    ) {
      return makeTagsReviewFilter([parsedValue.tag]);
    }

    if (parsedValue.kind === "effort" && "effortLevel" in parsedValue) {
      return parsedValue.effortLevel === "medium" || parsedValue.effortLevel === "long"
        ? makeTagsReviewFilter([parsedValue.effortLevel])
        : ALL_CARDS_REVIEW_FILTER;
    }

    if (
      parsedValue.kind === "deck"
      && "deckId" in parsedValue
      && typeof parsedValue.deckId === "string"
      && parsedValue.deckId !== ""
    ) {
      return {
        kind: "deck",
        deckId: parsedValue.deckId,
      };
    }
  } catch {
    return ALL_CARDS_REVIEW_FILTER;
  }

  return ALL_CARDS_REVIEW_FILTER;
}

export function loadSelectedReviewFilterForWorkspace(workspaceId: string | null): ReviewFilter {
  if (workspaceId === null) {
    return ALL_CARDS_REVIEW_FILTER;
  }

  const workspaceStorageKey = buildSelectedReviewFilterStorageKey(workspaceId);
  const workspaceValue = window.localStorage.getItem(workspaceStorageKey);
  if (workspaceValue !== null) {
    return parsePersistedReviewFilter(workspaceValue);
  }

  const legacyValue = window.localStorage.getItem(LEGACY_SELECTED_REVIEW_FILTER_STORAGE_KEY);
  if (legacyValue === null) {
    return ALL_CARDS_REVIEW_FILTER;
  }

  const migratedReviewFilter = parsePersistedReviewFilter(legacyValue);
  window.localStorage.setItem(workspaceStorageKey, JSON.stringify(migratedReviewFilter));
  window.localStorage.removeItem(LEGACY_SELECTED_REVIEW_FILTER_STORAGE_KEY);
  return migratedReviewFilter;
}

export function storeSelectedReviewFilterForWorkspace(workspaceId: string, reviewFilter: ReviewFilter): void {
  window.localStorage.setItem(
    buildSelectedReviewFilterStorageKey(workspaceId),
    JSON.stringify(normalizeReviewFilter(reviewFilter)),
  );
}

export function activateWorkspaceReviewFilterState(
  currentState: WorkspaceReviewFilterState,
  activeWorkspace: WorkspaceSummary | null,
  loadReviewFilter: (workspaceId: string | null) => ReviewFilter,
): WorkspaceReviewFilterState {
  const currentWorkspaceId = currentState.activeWorkspace?.workspaceId ?? null;
  const nextWorkspaceId = activeWorkspace?.workspaceId ?? null;
  if (currentWorkspaceId === nextWorkspaceId) {
    return {
      ...currentState,
      activeWorkspace,
    };
  }

  return {
    activeWorkspace,
    selection: {
      workspaceId: nextWorkspaceId,
      reviewFilter: loadReviewFilter(nextWorkspaceId),
    },
  };
}
