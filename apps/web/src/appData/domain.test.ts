import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Card, Deck, ReviewEvent } from "../types";
import {
  compareLww,
  deriveReviewQueue,
  normalizeCreateCardInput,
  normalizeUpdateCardInput,
  upsertCard,
  upsertDeck,
  upsertReviewEvent,
} from "./domain";

function createCard(overrides: Partial<Card>): Card {
  return {
    cardId: "card-1",
    frontText: "Front",
    backText: "Back",
    tags: [],
    effortLevel: "medium",
    dueAt: "2026-03-10T09:00:00.000Z",
    reps: 0,
    lapses: 0,
    fsrsCardState: "review",
    fsrsStepIndex: null,
    fsrsStability: null,
    fsrsDifficulty: null,
    fsrsLastReviewedAt: null,
    fsrsScheduledDays: null,
    clientUpdatedAt: "2026-03-10T09:00:00.000Z",
    lastModifiedByDeviceId: "device-a",
    lastOperationId: "op-a",
    updatedAt: "2026-03-10T09:00:00.000Z",
    deletedAt: null,
    ...overrides,
  };
}

function createDeck(overrides: Partial<Deck>): Deck {
  return {
    deckId: "deck-1",
    workspaceId: "workspace-1",
    name: "Deck",
    filterDefinition: {
      version: 2,
      effortLevels: [],
      tags: [],
    },
    createdAt: "2026-03-10T09:00:00.000Z",
    clientUpdatedAt: "2026-03-10T09:00:00.000Z",
    lastModifiedByDeviceId: "device-a",
    lastOperationId: "op-a",
    updatedAt: "2026-03-10T09:00:00.000Z",
    deletedAt: null,
    ...overrides,
  };
}

function createReviewEvent(overrides: Partial<ReviewEvent>): ReviewEvent {
  return {
    reviewEventId: "review-1",
    workspaceId: "workspace-1",
    cardId: "card-1",
    deviceId: "device-a",
    clientEventId: "client-event-1",
    rating: 3,
    reviewedAtClient: "2026-03-10T09:00:00.000Z",
    reviewedAtServer: "2026-03-10T09:00:00.000Z",
    ...overrides,
  };
}

describe("appData domain helpers", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-03-10T12:00:00.000Z"));
  });

  it("orders last-write-wins records by timestamp, device, and operation id", () => {
    expect(compareLww(
      {
        clientUpdatedAt: "2026-03-10T12:00:00.000Z",
        lastModifiedByDeviceId: "device-a",
        lastOperationId: "op-a",
      },
      {
        clientUpdatedAt: "2026-03-10T13:00:00.000Z",
        lastModifiedByDeviceId: "device-a",
        lastOperationId: "op-a",
      },
    )).toBeLessThan(0);

    expect(compareLww(
      {
        clientUpdatedAt: "2026-03-10T13:00:00.000Z",
        lastModifiedByDeviceId: "device-a",
        lastOperationId: "op-a",
      },
      {
        clientUpdatedAt: "2026-03-10T13:00:00.000Z",
        lastModifiedByDeviceId: "device-b",
        lastOperationId: "op-a",
      },
    )).toBeLessThan(0);

    expect(compareLww(
      {
        clientUpdatedAt: "2026-03-10T13:00:00.000Z",
        lastModifiedByDeviceId: "device-b",
        lastOperationId: "op-a",
      },
      {
        clientUpdatedAt: "2026-03-10T13:00:00.000Z",
        lastModifiedByDeviceId: "device-b",
        lastOperationId: "op-b",
      },
    )).toBeLessThan(0);
  });

  it("upserts cards, decks, and review events by id", () => {
    const updatedCard = createCard({ cardId: "card-1", frontText: "Updated" });
    const updatedDeck = createDeck({ deckId: "deck-1", name: "Updated Deck" });
    const updatedReviewEvent = createReviewEvent({ reviewEventId: "review-1", rating: 1 });

    expect(upsertCard([createCard({ cardId: "card-1" }), createCard({ cardId: "card-2" })], updatedCard))
      .toEqual([updatedCard, createCard({ cardId: "card-2" })]);
    expect(upsertDeck([createDeck({ deckId: "deck-1" }), createDeck({ deckId: "deck-2" })], updatedDeck))
      .toEqual([updatedDeck, createDeck({ deckId: "deck-2" })]);
    expect(
      upsertReviewEvent(
        [createReviewEvent({ reviewEventId: "review-1" }), createReviewEvent({ reviewEventId: "review-2" })],
        updatedReviewEvent,
      ),
    ).toEqual([updatedReviewEvent, createReviewEvent({ reviewEventId: "review-2" })]);
  });

  it("normalizes create and update card input", () => {
    expect(normalizeCreateCardInput({
      frontText: "  Front  ",
      backText: "  Back  ",
      tags: ["tag"],
      effortLevel: "fast",
    })).toEqual({
      frontText: "Front",
      backText: "Back",
      tags: ["tag"],
      effortLevel: "fast",
    });

    expect(normalizeUpdateCardInput({
      frontText: "  Edited front  ",
      backText: "  Edited back  ",
      tags: ["edited"],
      effortLevel: "long",
    })).toEqual({
      frontText: "Edited front",
      backText: "Edited back",
      tags: ["edited"],
      effortLevel: "long",
    });
  });

  it("throws when normalized card front text is empty", () => {
    expect(() => normalizeCreateCardInput({
      frontText: "   ",
      backText: "",
      tags: [],
      effortLevel: "medium",
    })).toThrow("Card front text must not be empty");

    expect(() => normalizeUpdateCardInput({
      frontText: "   ",
    })).toThrow("Card front text must not be empty");
  });

  it("derives the review queue from due and new cards only", () => {
    const dueCard = createCard({
      cardId: "due-card",
      dueAt: "2026-03-10T10:00:00.000Z",
      updatedAt: "2026-03-10T10:00:00.000Z",
    });
    const newCard = createCard({
      cardId: "new-card",
      dueAt: "2026-03-10T15:00:00.000Z",
      fsrsCardState: "new",
      updatedAt: "2026-03-10T11:00:00.000Z",
    });
    const noDueDateCard = createCard({
      cardId: "no-due-date-card",
      dueAt: null,
      updatedAt: "2026-03-10T09:00:00.000Z",
    });
    const futureReviewCard = createCard({
      cardId: "future-review-card",
      dueAt: "2026-03-10T15:00:00.000Z",
      fsrsCardState: "review",
      updatedAt: "2026-03-10T12:00:00.000Z",
    });
    const deletedCard = createCard({
      cardId: "deleted-card",
      dueAt: "2026-03-10T08:00:00.000Z",
      deletedAt: "2026-03-10T08:30:00.000Z",
      updatedAt: "2026-03-10T13:00:00.000Z",
    });

    expect(deriveReviewQueue([
      deletedCard,
      futureReviewCard,
      dueCard,
      noDueDateCard,
      newCard,
    ])).toEqual([
      newCard,
      dueCard,
      noDueDateCard,
    ]);
  });
});
