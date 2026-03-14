// @vitest-environment jsdom

import { act } from "react";
import ReactDOM from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CardTagsInput, getTagSuggestionsFromCards } from "./CardTagsInput";
import type { Card, TagSuggestion } from "../types";

function createCard(overrides: Partial<Card>): Card {
  return {
    cardId: "card-1",
    frontText: "Front",
    backText: "Back",
    tags: [],
    effortLevel: "medium",
    dueAt: null,
    createdAt: "2026-03-10T09:00:00.000Z",
    reps: 0,
    lapses: 0,
    fsrsCardState: "new",
    fsrsStepIndex: null,
    fsrsStability: null,
    fsrsDifficulty: null,
    fsrsLastReviewedAt: null,
    fsrsScheduledDays: null,
    clientUpdatedAt: "2026-03-10T09:00:00.000Z",
    lastModifiedByDeviceId: "device-1",
    lastOperationId: "op-1",
    updatedAt: "2026-03-10T09:00:00.000Z",
    deletedAt: null,
    ...overrides,
  };
}

function setInputValue(input: HTMLInputElement, value: string): void {
  const descriptor = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value");
  descriptor?.set?.call(input, value);
  input.dispatchEvent(new Event("input", { bubbles: true }));
}

describe("CardTagsInput", () => {
  let container: HTMLDivElement;
  let root: ReactDOM.Root;

  beforeEach(() => {
    (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    container = document.createElement("div");
    document.body.appendChild(container);
    root = ReactDOM.createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
  });

  it("builds popularity-first suggestions from active cards only", () => {
    expect(getTagSuggestionsFromCards([
      createCard({ cardId: "card-1", tags: ["verbs", "grammar"] }),
      createCard({ cardId: "card-2", tags: ["grammar"] }),
      createCard({ cardId: "card-3", tags: ["animals"] }),
      createCard({ cardId: "card-4", tags: ["travel"], deletedAt: "2026-03-10T10:00:00.000Z" }),
    ])).toEqual([
      {
        tag: "grammar",
        countState: "ready",
        cardsCount: 2,
      },
      {
        tag: "animals",
        countState: "ready",
        cardsCount: 1,
      },
      {
        tag: "verbs",
        countState: "ready",
        cardsCount: 1,
      },
    ] satisfies ReadonlyArray<TagSuggestion>);
  });

  it("keeps popularity order while filtering and hides selected tags", async () => {
    const onChange = vi.fn();

    await act(async () => {
      root.render(
        <CardTagsInput
          value={["grammar"]}
          suggestions={[
            { tag: "grammar", countState: "ready", cardsCount: 4 },
            { tag: "verbs", countState: "ready", cardsCount: 3 },
            { tag: "vocabulary", countState: "ready", cardsCount: 2 },
            { tag: "travel", countState: "ready", cardsCount: 1 },
          ]}
          placeholder="Type and press Enter"
          onChange={onChange}
        />,
      );
    });

    const input = container.querySelector("input");
    expect(input).not.toBeNull();

    await act(async () => {
      (input as HTMLInputElement).focus();
    });

    await act(async () => {
      setInputValue(input as HTMLInputElement, "v");
    });

    const options = Array.from(container.querySelectorAll(".tag-suggestion-button"));
    expect(options.map((option) => option.textContent?.replace(/\s+/g, " ").trim())).toEqual([
      "Create \"v\"new",
      "verbs3",
      "vocabulary2",
      "travel1",
    ]);
  });

  it("renders a spinner when a known tag count is still loading", async () => {
    await act(async () => {
      root.render(
        <CardTagsInput
          value={[]}
          suggestions={[
            { tag: "grammar", countState: "loading" },
          ]}
          placeholder="Type and press Enter"
          onChange={vi.fn()}
        />,
      );
    });

    const input = container.querySelector("input");
    expect(input).not.toBeNull();

    await act(async () => {
      (input as HTMLInputElement).focus();
    });

    expect(container.querySelector(".tag-suggestion-spinner")).not.toBeNull();
    expect(container.textContent).toContain("grammar");
  });
});
