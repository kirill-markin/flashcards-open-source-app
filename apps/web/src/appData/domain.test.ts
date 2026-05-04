import { describe, expect, it } from "vitest";
import type { Card } from "../types";
import {
  buildCardUpsertOperation,
  cardsMatchingReviewFilter,
  compareCardsForReviewOrder,
  matchesCardFilter,
  matchesDeckFilterDefinition,
  normalizeTagKey,
  recentDuePriorityWindow,
  resolveReviewFilter,
} from "./domain";

function makeReviewOrderCard(cardId: string, dueAt: string | null, createdAt: string): Card {
  return {
    cardId,
    frontText: cardId,
    backText: "Back",
    tags: [],
    effortLevel: "fast",
    dueAt,
    createdAt,
    reps: 0,
    lapses: 0,
    fsrsCardState: "new",
    fsrsStepIndex: null,
    fsrsStability: null,
    fsrsDifficulty: null,
    fsrsLastReviewedAt: null,
    fsrsScheduledDays: null,
    clientUpdatedAt: createdAt,
    lastModifiedByReplicaId: "device-1",
    lastOperationId: `operation-${cardId}`,
    updatedAt: createdAt,
    deletedAt: null,
  };
}

function sortCardsForReviewOrder(cards: ReadonlyArray<Card>, nowTimestamp: number): ReadonlyArray<Card> {
  return [...cards].sort((leftCard, rightCard) => compareCardsForReviewOrder(leftCard, rightCard, nowTimestamp));
}

describe("review order domain", () => {
  it("uses an exact one-hour recent due priority window", () => {
    expect(recentDuePriorityWindow).toBe(60 * 60 * 1000);
  });

  it("orders recent due, old due, null, future, and malformed buckets", () => {
    const nowTimestamp = Date.parse("2026-03-10T12:00:00.000Z");
    const cards = [
      makeReviewOrderCard("future-tomorrow", "2026-03-11T12:00:00.000Z", "2026-03-10T09:00:00.000Z"),
      makeReviewOrderCard("recent-1155", "2026-03-10T11:55:00.000Z", "2026-03-10T09:00:00.000Z"),
      makeReviewOrderCard("new-null", null, "2026-03-10T09:00:00.000Z"),
      makeReviewOrderCard("malformed", "not-a-date", "2026-03-10T09:00:00.000Z"),
      makeReviewOrderCard("old-yesterday", "2026-03-09T12:00:00.000Z", "2026-03-10T09:00:00.000Z"),
      makeReviewOrderCard("recent-1115", "2026-03-10T11:15:00.000Z", "2026-03-10T09:00:00.000Z"),
    ];

    expect(sortCardsForReviewOrder(cards, nowTimestamp).map((card) => card.cardId)).toEqual([
      "recent-1115",
      "recent-1155",
      "old-yesterday",
      "new-null",
      "future-tomorrow",
      "malformed",
    ]);
  });

  it("keeps recent boundary inclusive and future boundary exclusive", () => {
    const nowTimestamp = Date.parse("2026-03-10T12:00:00.000Z");
    const cards = [
      makeReviewOrderCard("future-one-ms", "2026-03-10T12:00:00.001Z", "2026-03-10T09:00:00.000Z"),
      makeReviewOrderCard("old-one-ms", "2026-03-10T10:59:59.999Z", "2026-03-10T09:00:00.000Z"),
      makeReviewOrderCard("due-now", "2026-03-10T12:00:00.000Z", "2026-03-10T09:00:00.000Z"),
      makeReviewOrderCard("recent-cutoff", "2026-03-10T11:00:00.000Z", "2026-03-10T09:00:00.000Z"),
      makeReviewOrderCard("new-null", null, "2026-03-10T09:00:00.000Z"),
    ];

    expect(sortCardsForReviewOrder(cards, nowTimestamp).map((card) => card.cardId)).toEqual([
      "recent-cutoff",
      "due-now",
      "old-one-ms",
      "new-null",
      "future-one-ms",
    ]);
  });

  it("keeps due bucket tie-breakers by dueAt, newer createdAt, then cardId", () => {
    const nowTimestamp = Date.parse("2026-03-10T12:00:00.000Z");
    const cards = [
      makeReviewOrderCard("recent-b", "2026-03-10T11:30:00.000Z", "2026-03-10T09:30:00.000Z"),
      makeReviewOrderCard("recent-a", "2026-03-10T11:30:00.000Z", "2026-03-10T09:30:00.000Z"),
      makeReviewOrderCard("recent-newer", "2026-03-10T11:30:00.000Z", "2026-03-10T09:45:00.000Z"),
      makeReviewOrderCard("old-b", "2026-03-09T11:30:00.000Z", "2026-03-10T09:30:00.000Z"),
      makeReviewOrderCard("old-a", "2026-03-09T11:30:00.000Z", "2026-03-10T09:30:00.000Z"),
      makeReviewOrderCard("old-newer", "2026-03-09T11:30:00.000Z", "2026-03-10T09:45:00.000Z"),
    ];

    expect(sortCardsForReviewOrder(cards, nowTimestamp).map((card) => card.cardId)).toEqual([
      "recent-newer",
      "recent-a",
      "recent-b",
      "old-newer",
      "old-a",
      "old-b",
    ]);
  });

  it("serializes card upserts with boundary dueAt and no local dueAtMillis", () => {
    const card = makeReviewOrderCard("reviewed-card", "2026-03-10T12:00:00.1Z", "2026-03-10T09:00:00.000Z");
    const operation = buildCardUpsertOperation(card);

    expect(operation.payload.dueAt).toBe("2026-03-10T12:00:00.100Z");
    expect(operation.payload).not.toHaveProperty("dueAtMillis");
  });

  it("rejects malformed card dueAt during sync upsert serialization", () => {
    const card = makeReviewOrderCard("reviewed-card", "2026-02-31T12:00:00.000Z", "2026-03-10T09:00:00.000Z");

    expect(() => buildCardUpsertOperation(card)).toThrow(/invalid dueAt/);
  });
});

describe("review tag matching domain", () => {
  it("normalizes tag keys by trimming and lowercasing Unicode text", () => {
    expect(normalizeTagKey(" Éclair ")).toBe("éclair");
  });

  it("matches review tag filters by normalized key while preserving canonical stored tag text", () => {
    const matchingCard = {
      ...makeReviewOrderCard("unicode-tag", null, "2026-03-10T09:00:00.000Z"),
      tags: ["Éclair"],
    };
    const otherCard = {
      ...makeReviewOrderCard("other-tag", null, "2026-03-10T09:00:00.000Z"),
      tags: ["code"],
    };
    const reviewFilter = {
      kind: "tag",
      tag: "éclair",
    } as const;

    expect(resolveReviewFilter(reviewFilter, [], [matchingCard, otherCard])).toEqual({
      kind: "tag",
      tag: "Éclair",
    });
    expect(cardsMatchingReviewFilter(reviewFilter, [], [matchingCard, otherCard]).map((card) => card.cardId)).toEqual([
      "unicode-tag",
    ]);
  });

  it("matches deck filter definition tags by normalized key", () => {
    const card = {
      ...makeReviewOrderCard("deck-unicode-tag", null, "2026-03-10T09:00:00.000Z"),
      tags: ["Éclair"],
    };

    expect(matchesDeckFilterDefinition({
      version: 2,
      effortLevels: [],
      tags: ["éclair"],
    }, card)).toBe(true);
  });

  it("matches card filter tags by normalized key", () => {
    const card = {
      ...makeReviewOrderCard("card-filter-unicode-tag", null, "2026-03-10T09:00:00.000Z"),
      tags: ["Éclair"],
    };

    expect(matchesCardFilter({
      effort: [],
      tags: ["éclair"],
    }, card)).toBe(true);
  });
});
