// @vitest-environment jsdom

import { beforeEach, describe, expect, it } from "vitest";
import {
  activateWorkspaceReviewFilterState,
  buildSelectedReviewFilterStorageKey,
  LEGACY_SELECTED_REVIEW_FILTER_STORAGE_KEY,
  loadSelectedReviewFilterForWorkspace,
  parsePersistedReviewFilter,
  storeSelectedReviewFilterForWorkspace,
} from "../context/reviewFilterPersistence";

function createStorageMock(): Storage {
  const state = new Map<string, string>();
  return {
    get length(): number {
      return state.size;
    },
    clear(): void {
      state.clear();
    },
    getItem(key: string): string | null {
      return state.get(key) ?? null;
    },
    key(index: number): string | null {
      return [...state.keys()][index] ?? null;
    },
    removeItem(key: string): void {
      state.delete(key);
    },
    setItem(key: string, value: string): void {
      state.set(key, value);
    },
  };
}

describe("workspace review filter persistence", () => {
  beforeEach(() => {
    Object.defineProperty(window, "localStorage", {
      configurable: true,
      value: createStorageMock(),
    });
  });

  it("decodes normalized multi-tag values and legacy single-tag, effort, and deck values", () => {
    expect(parsePersistedReviewFilter(JSON.stringify({
      kind: "tags",
      tags: [" verbs ", "Grammar", "grammar"],
    }))).toEqual({
      kind: "tags",
      tags: ["Grammar", "verbs"],
    });
    expect(parsePersistedReviewFilter(JSON.stringify({ kind: "tag", tag: "grammar" }))).toEqual({
      kind: "tags",
      tags: ["grammar"],
    });
    expect(parsePersistedReviewFilter(JSON.stringify({ kind: "effort", effortLevel: "long" }))).toEqual({
      kind: "tags",
      tags: ["long"],
    });
    expect(parsePersistedReviewFilter(JSON.stringify({ kind: "effort", effortLevel: "short" }))).toEqual({
      kind: "allCards",
    });
    expect(parsePersistedReviewFilter(JSON.stringify({ kind: "deck", deckId: "deck-1" }))).toEqual({
      kind: "deck",
      deckId: "deck-1",
    });
    expect(parsePersistedReviewFilter(JSON.stringify({
      kind: "tags",
      tags: [" E\u0301clair ", "Éclair"],
    }))).toEqual({
      kind: "tags",
      tags: ["Éclair"],
    });
  });

  it("migrates the legacy global selection into only the first activated workspace", () => {
    window.localStorage.setItem(
      LEGACY_SELECTED_REVIEW_FILTER_STORAGE_KEY,
      JSON.stringify({ kind: "tag", tag: "grammar" }),
    );

    expect(loadSelectedReviewFilterForWorkspace("workspace-1")).toEqual({
      kind: "tags",
      tags: ["grammar"],
    });
    expect(window.localStorage.getItem(LEGACY_SELECTED_REVIEW_FILTER_STORAGE_KEY)).toBeNull();
    expect(JSON.parse(window.localStorage.getItem(buildSelectedReviewFilterStorageKey("workspace-1")) ?? "null")).toEqual({
      kind: "tags",
      tags: ["grammar"],
    });
    expect(loadSelectedReviewFilterForWorkspace("workspace-2")).toEqual({ kind: "allCards" });
  });

  it("stores and restores independent selections for each workspace, including an empty tag set", () => {
    storeSelectedReviewFilterForWorkspace("workspace-1", { kind: "tags", tags: [] });
    storeSelectedReviewFilterForWorkspace("workspace-2", { kind: "deck", deckId: "deck-2" });

    expect(loadSelectedReviewFilterForWorkspace("workspace-1")).toEqual({
      kind: "tags",
      tags: [],
    });
    expect(loadSelectedReviewFilterForWorkspace("workspace-2")).toEqual({
      kind: "deck",
      deckId: "deck-2",
    });
  });

  it("stores canonically normalized tag selections while keeping legacy values readable", () => {
    storeSelectedReviewFilterForWorkspace("workspace-1", {
      kind: "tags",
      tags: [" E\u0301clair ", "Éclair"],
    });

    expect(window.localStorage.getItem(buildSelectedReviewFilterStorageKey("workspace-1"))).toBe(
      JSON.stringify({ kind: "tags", tags: ["Éclair"] }),
    );
    expect(loadSelectedReviewFilterForWorkspace("workspace-1")).toEqual({
      kind: "tags",
      tags: ["Éclair"],
    });
  });

  it("activates a workspace and its persisted filter as one state transition", () => {
    storeSelectedReviewFilterForWorkspace("workspace-2", { kind: "tags", tags: [] });
    const currentState = {
      activeWorkspace: {
        workspaceId: "workspace-1",
        name: "First",
        createdAt: "2026-03-10T00:00:00.000Z",
        isSelected: true,
      },
      selection: {
        workspaceId: "workspace-1",
        reviewFilter: { kind: "allCards" },
      },
    } as const;
    const nextWorkspace = {
      workspaceId: "workspace-2",
      name: "Second",
      createdAt: "2026-03-11T00:00:00.000Z",
      isSelected: true,
    } as const;

    expect(activateWorkspaceReviewFilterState(
      currentState,
      nextWorkspace,
      loadSelectedReviewFilterForWorkspace,
    )).toEqual({
      activeWorkspace: nextWorkspace,
      selection: {
        workspaceId: "workspace-2",
        reviewFilter: { kind: "tags", tags: [] },
      },
    });
  });
});
