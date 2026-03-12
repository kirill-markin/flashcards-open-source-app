import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Card, Deck, ReviewEvent, WorkspaceSummary } from "../types";
import {
  ALL_CARDS_REVIEW_FILTER,
  buildDeletedDeck,
  cardsMatchingDeck,
  cardsMatchingReviewFilter,
  deriveReviewTimeline,
  findWorkspaceById,
  compareLww,
  deriveReviewQueue,
  isCardNew,
  isCardReviewed,
  makeDeckCardStats,
  makeReviewQueue,
  makeReviewTimeline,
  matchesCardFilter,
  matchesDeckFilterDefinition,
  normalizeCreateCardInput,
  normalizeCreateDeckInput,
  normalizeUpdateCardInput,
  normalizeUpdateDeckInput,
  currentReviewCard,
  isReviewFilterEqual,
  reviewFilterTitle,
  resolveReviewFilter,
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

function createWorkspaceSummary(overrides: Partial<WorkspaceSummary>): WorkspaceSummary {
  return {
    workspaceId: "workspace-1",
    name: "Personal",
    createdAt: "2026-03-10T09:00:00.000Z",
    isSelected: false,
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

  it("finds persisted selected workspace only when it exists in available items", () => {
    const workspaces = [
      createWorkspaceSummary({
        workspaceId: "workspace-1",
        name: "Personal",
      }),
      createWorkspaceSummary({
        workspaceId: "workspace-2",
        name: "Flash Cards",
      }),
    ];

    expect(findWorkspaceById(workspaces, "workspace-2")).toEqual(workspaces[1]);
    expect(findWorkspaceById(workspaces, "workspace-3")).toBeNull();
    expect(findWorkspaceById(workspaces, null)).toBeNull();
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

    expect(() => normalizeCreateDeckInput({
      name: "   ",
      filterDefinition: {
        version: 2,
        effortLevels: [],
        tags: [],
      },
    })).toThrow("Deck name must not be empty");
  });

  it("matches deck filters using effort inclusion and tag overlap semantics", () => {
    const matchingCard = createCard({
      cardId: "matching-card",
      effortLevel: "fast",
      tags: ["grammar", "spanish"],
    });
    const wrongEffortCard = createCard({
      cardId: "wrong-effort-card",
      effortLevel: "long",
      tags: ["verbs", "spanish"],
    });
    const missingTagCard = createCard({
      cardId: "missing-tag-card",
      effortLevel: "fast",
      tags: ["travel"],
    });
    const deck = createDeck({
      filterDefinition: {
        version: 2,
        effortLevels: ["fast", "medium"],
        tags: ["grammar", "verbs"],
      },
    });

    expect(matchesDeckFilterDefinition(deck.filterDefinition, matchingCard)).toBe(true);
    expect(matchesDeckFilterDefinition(deck.filterDefinition, wrongEffortCard)).toBe(false);
    expect(matchesDeckFilterDefinition(deck.filterDefinition, missingTagCard)).toBe(false);
  });

  it("matches card filters when any selected tag overlaps and effort also matches", () => {
    expect(matchesCardFilter(
      {
        tags: ["grammar", "verbs"],
        effort: ["fast"],
      },
      createCard({
        cardId: "matching-card",
        effortLevel: "fast",
        tags: ["verbs"],
      }),
    )).toBe(true);

    expect(matchesCardFilter(
      {
        tags: ["grammar", "verbs"],
        effort: ["fast"],
      },
      createCard({
        cardId: "wrong-tag-card",
        effortLevel: "fast",
        tags: ["travel"],
      }),
    )).toBe(false);

    expect(matchesCardFilter(
      {
        tags: ["grammar", "verbs"],
        effort: ["fast"],
      },
      createCard({
        cardId: "wrong-effort-card",
        effortLevel: "medium",
        tags: ["grammar"],
      }),
    )).toBe(false);
  });

  it("derives deck card stats using iOS parity helpers", () => {
    const dueNewCard = createCard({
      cardId: "due-new-card",
      dueAt: null,
      reps: 0,
      lapses: 0,
    });
    const dueReviewedCard = createCard({
      cardId: "due-reviewed-card",
      dueAt: "2026-03-10T11:00:00.000Z",
      reps: 1,
      lapses: 0,
    });
    const upcomingReviewedCard = createCard({
      cardId: "upcoming-reviewed-card",
      dueAt: "2026-03-10T15:00:00.000Z",
      reps: 2,
      lapses: 0,
    });

    expect(isCardNew(dueNewCard)).toBe(true);
    expect(isCardReviewed(dueNewCard)).toBe(false);
    expect(isCardReviewed(dueReviewedCard)).toBe(true);
    expect(makeDeckCardStats([
      dueNewCard,
      dueReviewedCard,
      upcomingReviewedCard,
    ], Date.now())).toEqual({
      totalCards: 3,
      dueCards: 2,
      newCards: 1,
      reviewedCards: 2,
    });
  });

  it("excludes deleted cards from deck matching so derived all-cards and deck stats stay active-only", () => {
    const matchingActiveCard = createCard({
      cardId: "matching-active-card",
      tags: ["grammar", "verbs"],
      reps: 1,
      lapses: 0,
    });
    const deletedMatchingCard = createCard({
      cardId: "deleted-matching-card",
      tags: ["grammar", "verbs"],
      deletedAt: "2026-03-10T11:30:00.000Z",
    });
    const nonMatchingActiveCard = createCard({
      cardId: "non-matching-active-card",
      tags: ["travel"],
    });
    const deck = createDeck({
      filterDefinition: {
        version: 2,
        effortLevels: [],
        tags: ["grammar", "verbs"],
      },
    });

    expect(cardsMatchingDeck(deck, [
      deletedMatchingCard,
      nonMatchingActiveCard,
      matchingActiveCard,
    ])).toEqual([matchingActiveCard]);
  });

  it("resolves missing deck review filters back to All cards", () => {
    expect(resolveReviewFilter({
      kind: "deck",
      deckId: "missing-deck",
    }, [
      createDeck({ deckId: "deck-1" }),
    ], [])).toEqual(ALL_CARDS_REVIEW_FILTER);
  });

  it("resolves missing tag review filters back to All cards", () => {
    expect(resolveReviewFilter({
      kind: "tag",
      tag: "missing-tag",
    }, [], [
      createCard({
        cardId: "card-1",
        tags: ["grammar"],
      }),
    ])).toEqual(ALL_CARDS_REVIEW_FILTER);
  });

  it("matches cards and titles for persisted and virtual review filters", () => {
    const grammarDeck = createDeck({
      deckId: "grammar",
      name: "Grammar",
      filterDefinition: {
        version: 2,
        effortLevels: ["fast"],
        tags: ["grammar"],
      },
    });
    const grammarCard = createCard({
      cardId: "grammar-card",
      effortLevel: "fast",
      tags: ["grammar", "verbs"],
    });
    const travelCard = createCard({
      cardId: "travel-card",
      effortLevel: "long",
      tags: ["travel"],
    });

    expect(cardsMatchingReviewFilter(ALL_CARDS_REVIEW_FILTER, [grammarDeck], [
      grammarCard,
      travelCard,
    ])).toEqual([grammarCard, travelCard]);
    expect(cardsMatchingReviewFilter({
      kind: "deck",
      deckId: "grammar",
    }, [grammarDeck], [
      grammarCard,
      travelCard,
    ])).toEqual([grammarCard]);
    expect(cardsMatchingReviewFilter({
      kind: "tag",
      tag: "verbs",
    }, [grammarDeck], [
      grammarCard,
      travelCard,
    ])).toEqual([grammarCard]);
    expect(reviewFilterTitle(ALL_CARDS_REVIEW_FILTER, [grammarDeck], [
      grammarCard,
      travelCard,
    ])).toBe("All cards");
    expect(reviewFilterTitle({
      kind: "deck",
      deckId: "grammar",
    }, [grammarDeck], [
      grammarCard,
      travelCard,
    ])).toBe("Grammar");
    expect(reviewFilterTitle({
      kind: "tag",
      tag: "verbs",
    }, [grammarDeck], [
      grammarCard,
      travelCard,
    ])).toBe("verbs");
  });

  it("distinguishes deck and tag review filters with the same identifier text", () => {
    expect(isReviewFilterEqual({
      kind: "deck",
      deckId: "grammar",
    }, {
      kind: "tag",
      tag: "grammar",
    })).toBe(false);
  });

  it("builds filtered review timeline and queue from the selected review filter", () => {
    const grammarDeck = createDeck({
      deckId: "grammar",
      filterDefinition: {
        version: 2,
        effortLevels: ["fast"],
        tags: ["grammar"],
      },
    });
    const dueGrammarCard = createCard({
      cardId: "due-grammar-card",
      effortLevel: "fast",
      tags: ["grammar"],
      dueAt: "2026-03-10T11:00:00.000Z",
    });
    const futureGrammarCard = createCard({
      cardId: "future-grammar-card",
      effortLevel: "fast",
      tags: ["grammar"],
      dueAt: "2026-03-10T15:00:00.000Z",
    });
    const dueTravelCard = createCard({
      cardId: "due-travel-card",
      effortLevel: "long",
      tags: ["travel"],
      dueAt: "2026-03-10T10:00:00.000Z",
    });

    expect(makeReviewTimeline({
      kind: "deck",
      deckId: "grammar",
    }, [grammarDeck], [
      dueTravelCard,
      futureGrammarCard,
      dueGrammarCard,
    ])).toEqual([
      dueGrammarCard,
      futureGrammarCard,
    ]);
    expect(makeReviewQueue({
      kind: "deck",
      deckId: "grammar",
    }, [grammarDeck], [
      dueTravelCard,
      futureGrammarCard,
      dueGrammarCard,
    ])).toEqual([dueGrammarCard]);
  });

  it("builds deck tombstones for delete mutations", () => {
    const deletedDeck = buildDeletedDeck(
      createDeck({
        deckId: "deck-1",
        deletedAt: null,
      }),
      "2026-03-10T13:00:00.000Z",
      "device-b",
      "op-b",
    );

    expect(deletedDeck.deletedAt).toBe("2026-03-10T13:00:00.000Z");
    expect(deletedDeck.updatedAt).toBe("2026-03-10T13:00:00.000Z");
    expect(normalizeUpdateDeckInput({
      name: "  Grammar  ",
      filterDefinition: {
        version: 2,
        effortLevels: ["fast", "fast"],
        tags: [" verbs ", "verbs", "grammar"],
      },
    })).toEqual({
      name: "Grammar",
      filterDefinition: {
        version: 2,
        effortLevels: ["fast"],
        tags: ["verbs", "grammar"],
      },
    });
  });

  it("derives the review queue with canonical due ordering only", () => {
    const noDueDateCard = createCard({
      cardId: "no-due-date-card",
      dueAt: null,
      updatedAt: "2026-03-10T09:00:00.000Z",
    });
    const earlyDueCard = createCard({
      cardId: "early-due-card",
      dueAt: "2026-03-10T09:30:00.000Z",
      updatedAt: "2026-03-10T08:00:00.000Z",
    });
    const tiedDueNewerCard = createCard({
      cardId: "tied-due-newer-card",
      dueAt: "2026-03-10T10:00:00.000Z",
      updatedAt: "2026-03-10T11:00:00.000Z",
    });
    const tiedDueOlderCard = createCard({
      cardId: "tied-due-older-card",
      dueAt: "2026-03-10T10:00:00.000Z",
      updatedAt: "2026-03-10T10:00:00.000Z",
    });
    const futureReviewCard = createCard({
      cardId: "future-review-card",
      dueAt: "2026-03-10T15:00:00.000Z",
      fsrsCardState: "review",
      updatedAt: "2026-03-10T12:00:00.000Z",
    });
    const malformedDueAtCard = createCard({
      cardId: "malformed-due-at-card",
      dueAt: "not-an-iso-date",
      updatedAt: "2026-03-10T13:00:00.000Z",
    });
    const deletedCard = createCard({
      cardId: "deleted-card",
      dueAt: "2026-03-10T08:00:00.000Z",
      deletedAt: "2026-03-10T08:30:00.000Z",
      updatedAt: "2026-03-10T14:00:00.000Z",
    });

    expect(deriveReviewQueue([
      deletedCard,
      futureReviewCard,
      noDueDateCard,
      earlyDueCard,
      tiedDueOlderCard,
      tiedDueNewerCard,
      malformedDueAtCard,
    ])).toEqual([
      noDueDateCard,
      earlyDueCard,
      tiedDueNewerCard,
      tiedDueOlderCard,
    ]);
  });

  it("derives the review timeline with active cards before upcoming cards", () => {
    const noDueDateCard = createCard({
      cardId: "no-due-date-card",
      dueAt: null,
      updatedAt: "2026-03-10T09:00:00.000Z",
    });
    const earlyDueCard = createCard({
      cardId: "early-due-card",
      dueAt: "2026-03-10T09:30:00.000Z",
      updatedAt: "2026-03-10T08:00:00.000Z",
    });
    const futureEarlierCard = createCard({
      cardId: "future-earlier-card",
      dueAt: "2026-03-10T14:00:00.000Z",
      updatedAt: "2026-03-10T12:00:00.000Z",
    });
    const futureTieNewerCard = createCard({
      cardId: "future-tie-newer-card",
      dueAt: "2026-03-10T15:00:00.000Z",
      updatedAt: "2026-03-10T13:00:00.000Z",
    });
    const futureTieOlderCard = createCard({
      cardId: "future-tie-older-card",
      dueAt: "2026-03-10T15:00:00.000Z",
      updatedAt: "2026-03-10T11:00:00.000Z",
    });
    const malformedDueAtCard = createCard({
      cardId: "malformed-due-at-card",
      dueAt: "not-an-iso-date",
      updatedAt: "2026-03-10T14:00:00.000Z",
    });

    expect(deriveReviewTimeline([
      futureTieOlderCard,
      malformedDueAtCard,
      noDueDateCard,
      futureEarlierCard,
      futureTieNewerCard,
      earlyDueCard,
    ])).toEqual([
      noDueDateCard,
      earlyDueCard,
      futureEarlierCard,
      futureTieNewerCard,
      futureTieOlderCard,
      malformedDueAtCard,
    ]);
  });

  it("uses the canonical queue head as the current review card", () => {
    const topQueueCard = createCard({
      cardId: "top-queue-card",
      dueAt: "2026-03-10T09:30:00.000Z",
      updatedAt: "2026-03-10T08:00:00.000Z",
    });
    const remotelyUpdatedCard = createCard({
      cardId: "remotely-updated-card",
      dueAt: "2026-03-10T10:00:00.000Z",
      updatedAt: "2026-03-10T14:00:00.000Z",
    });

    const reviewQueue = deriveReviewQueue([
      remotelyUpdatedCard,
      topQueueCard,
    ]);

    expect(reviewQueue.map((card) => card.cardId)).toEqual([
      "top-queue-card",
      "remotely-updated-card",
    ]);
    expect(currentReviewCard(reviewQueue)?.cardId).toBe("top-queue-card");
    expect(currentReviewCard([])).toBeNull();
  });

  it("does not treat future new cards as due when dueAt is in the future", () => {
    const futureNewCard = createCard({
      cardId: "future-new-card",
      dueAt: "2026-03-10T15:00:00.000Z",
      fsrsCardState: "new",
      updatedAt: "2026-03-10T11:00:00.000Z",
    });

    expect(deriveReviewQueue([
      futureNewCard,
      createCard({
        cardId: "due-card",
        dueAt: "2026-03-10T11:00:00.000Z",
        updatedAt: "2026-03-10T10:00:00.000Z",
      }),
    ])).toEqual([
      createCard({
        cardId: "due-card",
        dueAt: "2026-03-10T11:00:00.000Z",
        updatedAt: "2026-03-10T10:00:00.000Z",
      }),
    ]);
  });
});
