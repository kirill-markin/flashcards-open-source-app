import { describe, expect, it } from "vitest";
import type { Card } from "../../types";
import {
  buildCardUpsertOperation,
  buildReviewEvent,
  buildReviewEventAppendOperation,
  cardsMatchingReviewFilter,
  compareCardsForReviewOrder,
  doesCardMutationAffectReviewSchedule,
  matchesCardFilter,
  matchesDeckFilterDefinition,
  normalizeTagKey,
  recentDuePriorityWindow,
  resolveReviewFilter,
} from "./index";

function makeReviewOrderCard(
  cardId: string,
  dueAt: string | null,
  createdAt: string,
  fsrsLastReviewedAt: string | null,
): Card {
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
    fsrsLastReviewedAt,
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
  it("uses an exact one-hour recent review priority window", () => {
    expect(recentDuePriorityWindow).toBe(60 * 60 * 1000);
  });

  it("orders recently reviewed due, other due, null, future, and malformed buckets", () => {
    const nowTimestamp = Date.parse("2026-03-10T12:00:00.000Z");
    const cards = [
      makeReviewOrderCard("future-tomorrow", "2026-03-11T12:00:00.000Z", "2026-03-10T09:00:00.000Z", "2026-03-10T11:55:00.000Z"),
      makeReviewOrderCard("recent-1155", "2026-03-10T11:55:00.000Z", "2026-03-10T09:00:00.000Z", "2026-03-10T11:55:00.000Z"),
      makeReviewOrderCard("new-null", null, "2026-03-10T09:00:00.000Z", null),
      makeReviewOrderCard("malformed", "not-a-date", "2026-03-10T09:00:00.000Z", "2026-03-10T11:55:00.000Z"),
      makeReviewOrderCard("old-yesterday", "2026-03-09T12:00:00.000Z", "2026-03-10T09:00:00.000Z", null),
      makeReviewOrderCard("recent-1115", "2026-03-10T11:15:00.000Z", "2026-03-10T09:00:00.000Z", "2026-03-10T11:15:00.000Z"),
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

  it("keeps recent review boundary inclusive and future due boundary exclusive", () => {
    const nowTimestamp = Date.parse("2026-03-10T12:00:00.000Z");
    const cards = [
      makeReviewOrderCard("future-one-ms", "2026-03-10T12:00:00.001Z", "2026-03-10T09:00:00.000Z", "2026-03-10T12:00:00.000Z"),
      makeReviewOrderCard("old-one-ms", "2026-03-10T10:59:59.999Z", "2026-03-10T09:00:00.000Z", "2026-03-10T10:59:59.999Z"),
      makeReviewOrderCard("due-now", "2026-03-10T12:00:00.000Z", "2026-03-10T09:00:00.000Z", "2026-03-10T12:00:00.000Z"),
      makeReviewOrderCard("recent-cutoff", "2026-03-10T11:00:00.000Z", "2026-03-10T09:00:00.000Z", "2026-03-10T11:00:00.000Z"),
      makeReviewOrderCard("new-null", null, "2026-03-10T09:00:00.000Z", null),
    ];

    expect(sortCardsForReviewOrder(cards, nowTimestamp).map((card) => card.cardId)).toEqual([
      "recent-cutoff",
      "due-now",
      "old-one-ms",
      "new-null",
      "future-one-ms",
    ]);
  });

  it("does not give recent priority to cards only due in the last hour", () => {
    const nowTimestamp = Date.parse("2026-03-10T12:00:00.000Z");
    const cards = [
      makeReviewOrderCard("old-backlog", "2026-03-09T12:00:00.000Z", "2026-03-10T09:00:00.000Z", null),
      makeReviewOrderCard("recently-reviewed-old-due", "2026-03-09T13:00:00.000Z", "2026-03-10T09:00:00.000Z", "2026-03-10T11:55:00.000Z"),
      makeReviewOrderCard("due-last-hour-old-review", "2026-03-10T11:55:00.000Z", "2026-03-10T09:00:00.000Z", "2026-03-10T10:55:00.000Z"),
      makeReviewOrderCard("new-null", null, "2026-03-10T09:00:00.000Z", null),
    ];

    expect(sortCardsForReviewOrder(cards, nowTimestamp).map((card) => card.cardId)).toEqual([
      "recently-reviewed-old-due",
      "old-backlog",
      "due-last-hour-old-review",
      "new-null",
    ]);
  });

  it("does not give recent priority for loosely parseable review timestamps", () => {
    const nowTimestamp = Date.parse("2026-03-10T12:00:00.000Z");
    const cards = [
      makeReviewOrderCard("loose-reviewed-old-due", "2026-03-09T10:00:00.000Z", "2026-03-10T09:00:00.000Z", "Tue, 10 Mar 2026 11:55:00 GMT"),
      makeReviewOrderCard("valid-recent-reviewed", "2026-03-10T11:00:00.000Z", "2026-03-10T09:00:00.000Z", "2026-03-10T11:55:00.000Z"),
      makeReviewOrderCard("new-null", null, "2026-03-10T09:00:00.000Z", null),
    ];

    expect(sortCardsForReviewOrder(cards, nowTimestamp).map((card) => card.cardId)).toEqual([
      "valid-recent-reviewed",
      "loose-reviewed-old-due",
      "new-null",
    ]);
  });

  it("keeps due bucket tie-breakers by dueAt, newer createdAt, then cardId", () => {
    const nowTimestamp = Date.parse("2026-03-10T12:00:00.000Z");
    const cards = [
      makeReviewOrderCard("recent-b", "2026-03-10T11:30:00.000Z", "2026-03-10T09:30:00.000Z", "2026-03-10T11:30:00.000Z"),
      makeReviewOrderCard("recent-a", "2026-03-10T11:30:00.000Z", "2026-03-10T09:30:00.000Z", "2026-03-10T11:30:00.000Z"),
      makeReviewOrderCard("recent-newer", "2026-03-10T11:30:00.000Z", "2026-03-10T09:45:00.000Z", "2026-03-10T11:30:00.000Z"),
      makeReviewOrderCard("old-b", "2026-03-09T11:30:00.000Z", "2026-03-10T09:30:00.000Z", null),
      makeReviewOrderCard("old-a", "2026-03-09T11:30:00.000Z", "2026-03-10T09:30:00.000Z", null),
      makeReviewOrderCard("old-newer", "2026-03-09T11:30:00.000Z", "2026-03-10T09:45:00.000Z", null),
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
    const card = makeReviewOrderCard("reviewed-card", "2026-03-10T12:00:00.1Z", "2026-03-10T09:00:00.000Z", null);
    const operation = buildCardUpsertOperation(card);

    expect(operation.payload.dueAt).toBe("2026-03-10T12:00:00.100Z");
    expect(operation.payload).not.toHaveProperty("dueAtMillis");
  });

  it("rejects malformed card dueAt during sync upsert serialization", () => {
    const card = makeReviewOrderCard("reviewed-card", "2026-02-31T12:00:00.000Z", "2026-03-10T09:00:00.000Z", null);

    expect(() => buildCardUpsertOperation(card)).toThrow(/invalid dueAt/);
  });

  it("serializes review event timezone only when present", () => {
    const reviewEvent = buildReviewEvent(
      "workspace-1",
      "card-1",
      "device-1",
      2,
      "2026-03-10T10:00:00.000Z",
      "Europe/Madrid",
      "review-1",
      "client-event-1",
    );
    const legacyReviewEvent = buildReviewEvent(
      "workspace-1",
      "card-1",
      "device-1",
      2,
      "2026-03-10T10:00:00.000Z",
      undefined,
      "review-2",
      "client-event-2",
    );

    expect(buildReviewEventAppendOperation(reviewEvent).payload).toEqual({
      reviewEventId: "review-1",
      cardId: "card-1",
      clientEventId: "client-event-1",
      rating: 2,
      reviewedAtClient: "2026-03-10T10:00:00.000Z",
      reviewedTimeZone: "Europe/Madrid",
    });
    expect(legacyReviewEvent).not.toHaveProperty("reviewedTimeZone");
    expect(buildReviewEventAppendOperation(legacyReviewEvent).payload).not.toHaveProperty("reviewedTimeZone");
  });

  it("classifies only schedule-relevant card mutations as review schedule changes", () => {
    const originalCard = makeReviewOrderCard("reviewed-card", null, "2026-03-10T09:00:00.000Z", null);
    const contentOnlyEdit: Card = {
      ...originalCard,
      frontText: "Edited front",
      backText: "Edited back",
      tags: ["edited"],
      effortLevel: "medium",
      clientUpdatedAt: "2026-03-10T10:00:00.000Z",
      lastOperationId: "operation-content-only-edit",
      updatedAt: "2026-03-10T10:00:00.000Z",
    };
    const dueAtEdit: Card = {
      ...originalCard,
      dueAt: "2026-03-11T09:00:00.000Z",
    };
    const fsrsEdit: Card = {
      ...originalCard,
      reps: 1,
      lapses: 1,
      fsrsCardState: "review",
      fsrsStepIndex: 0,
      fsrsStability: 2.5,
      fsrsDifficulty: 4.5,
      fsrsLastReviewedAt: "2026-03-10T10:00:00.000Z",
      fsrsScheduledDays: 1,
    };
    const deletedCard: Card = {
      ...originalCard,
      deletedAt: "2026-03-10T10:00:00.000Z",
    };

    expect(doesCardMutationAffectReviewSchedule(null, originalCard)).toBe(true);
    expect(doesCardMutationAffectReviewSchedule(originalCard, contentOnlyEdit)).toBe(false);
    expect(doesCardMutationAffectReviewSchedule(originalCard, dueAtEdit)).toBe(true);
    expect(doesCardMutationAffectReviewSchedule(originalCard, fsrsEdit)).toBe(true);
    expect(doesCardMutationAffectReviewSchedule(originalCard, deletedCard)).toBe(true);
  });
});

describe("review tag matching domain", () => {
  it("normalizes tag keys by trimming and lowercasing Unicode text", () => {
    expect(normalizeTagKey(" Éclair ")).toBe("éclair");
  });

  it("matches review tag filters by normalized key while preserving canonical stored tag text", () => {
    const matchingCard = {
      ...makeReviewOrderCard("unicode-tag", null, "2026-03-10T09:00:00.000Z", null),
      tags: ["Éclair"],
    };
    const otherCard = {
      ...makeReviewOrderCard("other-tag", null, "2026-03-10T09:00:00.000Z", null),
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
      ...makeReviewOrderCard("deck-unicode-tag", null, "2026-03-10T09:00:00.000Z", null),
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
      ...makeReviewOrderCard("card-filter-unicode-tag", null, "2026-03-10T09:00:00.000Z", null),
      tags: ["Éclair"],
    };

    expect(matchesCardFilter({
      effort: [],
      tags: ["éclair"],
    }, card)).toBe(true);
  });
});
