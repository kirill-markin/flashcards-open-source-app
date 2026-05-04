// @vitest-environment jsdom

import "fake-indexeddb/auto";
import { beforeEach, describe, expect, it } from "vitest";
import { buildCardUpsertOperation } from "../appData/domain";
import { shiftLocalDate } from "../progress/progressDates";
import { putCard, replaceCards } from "./cards";
import { clearWebSyncCache } from "./cache";
import { putOutboxRecord, type PersistedOutboxRecord } from "./outbox";
import {
  calculatePendingProgressReviewScheduleCardTotalDelta,
  hasPendingProgressReviewScheduleCardChanges,
  loadLocalProgressReviewSchedule,
} from "./reviewSchedule";
import { makeCard, workspaceId } from "./testSupport";
import type { Card, ProgressReviewScheduleBucketKey } from "../types";

function dueAtUtcStart(today: string, offsetDays: number): string {
  return `${shiftLocalDate(today, offsetDays)}T00:00:00.000Z`;
}

function countByBucket(
  cards: ReadonlyArray<Card>,
  input: Readonly<{
    today: string;
    timeZone: string;
  }>,
): Promise<ReadonlyMap<ProgressReviewScheduleBucketKey, number>> {
  return replaceCards(workspaceId, cards)
    .then(() => loadLocalProgressReviewSchedule([workspaceId], input))
    .then((schedule) => new Map(schedule.buckets.map((bucket) => [bucket.key, bucket.count])));
}

function makePendingCardOutboxRecord(input: Readonly<{
  operationId: string;
  cardId?: string;
  cardCreatedAt?: string;
  clientUpdatedAt?: string;
  deletedAt?: string | null;
  affectsReviewSchedule?: boolean;
}>): PersistedOutboxRecord {
  const clientUpdatedAt = input.clientUpdatedAt ?? "2026-05-03T09:00:00.000Z";
  const cardCreatedAt = input.cardCreatedAt ?? clientUpdatedAt;
  const cardId = input.cardId ?? input.operationId;
  const card: Card = {
    ...makeCard({
      cardId,
      frontText: "Pending",
      backText: "back",
      tags: [],
      effortLevel: "fast",
      dueAt: null,
      createdAt: cardCreatedAt,
      deletedAt: input.deletedAt ?? null,
    }),
    clientUpdatedAt,
    lastOperationId: input.operationId,
    updatedAt: clientUpdatedAt,
  };
  const record: PersistedOutboxRecord = {
    operationId: input.operationId,
    workspaceId,
    createdAt: clientUpdatedAt,
    attemptCount: 0,
    lastError: "",
    operation: buildCardUpsertOperation(card),
  };

  if (input.affectsReviewSchedule === undefined) {
    return record;
  }

  return {
    ...record,
    affectsReviewSchedule: input.affectsReviewSchedule,
  };
}

describe("local review schedule", () => {
  beforeEach(async () => {
    await clearWebSyncCache();
  });

  it("aggregates active cards into stable non-overlapping UTC buckets", async () => {
    const today = "2026-05-03";
    const cards: ReadonlyArray<Card> = [
      makeCard({
        cardId: "new-card",
        frontText: "New",
        backText: "back",
        tags: [],
        effortLevel: "fast",
        dueAt: null,
        createdAt: "2026-05-01T00:00:00.000Z",
      }),
      makeCard({
        cardId: "overdue-card",
        frontText: "Overdue",
        backText: "back",
        tags: [],
        effortLevel: "fast",
        dueAt: dueAtUtcStart(today, -10),
        createdAt: "2026-05-01T00:00:00.000Z",
      }),
      makeCard({
        cardId: "today-card",
        frontText: "Today",
        backText: "back",
        tags: [],
        effortLevel: "fast",
        dueAt: "2026-05-03T23:59:59.999Z",
        createdAt: "2026-05-01T00:00:00.000Z",
      }),
      makeCard({
        cardId: "pre-1970-card",
        frontText: "Pre 1970",
        backText: "back",
        tags: [],
        effortLevel: "fast",
        dueAt: "1969-12-31T23:59:59.999Z",
        createdAt: "2026-05-01T00:00:00.000Z",
      }),
      makeCard({
        cardId: "days-1-to-7-card",
        frontText: "1 to 7",
        backText: "back",
        tags: [],
        effortLevel: "fast",
        dueAt: dueAtUtcStart(today, 1),
        createdAt: "2026-05-01T00:00:00.000Z",
      }),
      makeCard({
        cardId: "days-8-to-30-card",
        frontText: "8 to 30",
        backText: "back",
        tags: [],
        effortLevel: "fast",
        dueAt: dueAtUtcStart(today, 8),
        createdAt: "2026-05-01T00:00:00.000Z",
      }),
      makeCard({
        cardId: "days-31-to-90-card",
        frontText: "31 to 90",
        backText: "back",
        tags: [],
        effortLevel: "fast",
        dueAt: dueAtUtcStart(today, 31),
        createdAt: "2026-05-01T00:00:00.000Z",
      }),
      makeCard({
        cardId: "days-91-to-360-card",
        frontText: "91 to 360",
        backText: "back",
        tags: [],
        effortLevel: "fast",
        dueAt: dueAtUtcStart(today, 91),
        createdAt: "2026-05-01T00:00:00.000Z",
      }),
      makeCard({
        cardId: "years-1-to-2-card",
        frontText: "1 to 2 years",
        backText: "back",
        tags: [],
        effortLevel: "fast",
        dueAt: dueAtUtcStart(today, 361),
        createdAt: "2026-05-01T00:00:00.000Z",
      }),
      makeCard({
        cardId: "later-card",
        frontText: "Later",
        backText: "back",
        tags: [],
        effortLevel: "fast",
        dueAt: dueAtUtcStart(today, 721),
        createdAt: "2026-05-01T00:00:00.000Z",
      }),
      makeCard({
        cardId: "deleted-new-card",
        frontText: "Deleted",
        backText: "back",
        tags: [],
        effortLevel: "fast",
        dueAt: null,
        createdAt: "2026-05-01T00:00:00.000Z",
        deletedAt: "2026-05-02T00:00:00.000Z",
      }),
    ];

    const counts = await countByBucket(cards, {
      today,
      timeZone: "UTC",
    });

    expect([...counts.entries()]).toEqual([
      ["new", 1],
      ["today", 3],
      ["days1To7", 1],
      ["days8To30", 1],
      ["days31To90", 1],
      ["days91To360", 1],
      ["years1To2", 1],
      ["later", 1],
    ]);
  });

  it("uses the requested timezone boundary between Today and 1-7 days", async () => {
    const counts = await countByBucket([
      makeCard({
        cardId: "madrid-today-card",
        frontText: "Madrid today",
        backText: "back",
        tags: [],
        effortLevel: "fast",
        dueAt: "2026-05-03T21:59:59.999Z",
        createdAt: "2026-05-01T00:00:00.000Z",
      }),
      makeCard({
        cardId: "madrid-tomorrow-card",
        frontText: "Madrid tomorrow",
        backText: "back",
        tags: [],
        effortLevel: "fast",
        dueAt: "2026-05-03T22:00:00.000Z",
        createdAt: "2026-05-01T00:00:00.000Z",
      }),
    ], {
      today: "2026-05-03",
      timeZone: "Europe/Madrid",
    });

    expect(counts.get("today")).toBe(1);
    expect(counts.get("days1To7")).toBe(1);
  });

  it("rejects active malformed dueAt cards instead of counting them as new", async () => {
    await replaceCards(workspaceId, [
      makeCard({
        cardId: "malformed-due-card",
        frontText: "Malformed due",
        backText: "back",
        tags: [],
        effortLevel: "fast",
        dueAt: "2026-02-31T12:00:00.000Z",
        createdAt: "2026-05-01T00:00:00.000Z",
      }),
    ]);

    await expect(loadLocalProgressReviewSchedule([workspaceId], {
      today: "2026-05-03",
      timeZone: "UTC",
    })).rejects.toThrow(/invalid dueAt/);
  });

  it("ignores pending card upserts explicitly marked as schedule-irrelevant", async () => {
    await putOutboxRecord(makePendingCardOutboxRecord({
      operationId: "content-only-edit",
      affectsReviewSchedule: false,
    }));

    await expect(hasPendingProgressReviewScheduleCardChanges([workspaceId])).resolves.toBe(false);
  });

  it("treats pending card upserts marked as schedule-relevant as overlay-relevant", async () => {
    await putOutboxRecord(makePendingCardOutboxRecord({
      operationId: "review-schedule-edit",
      affectsReviewSchedule: true,
    }));

    await expect(hasPendingProgressReviewScheduleCardChanges([workspaceId])).resolves.toBe(true);
  });

  it("keeps legacy pending card upserts schedule-relevant when metadata is missing", async () => {
    await putOutboxRecord(makePendingCardOutboxRecord({
      operationId: "legacy-card-upsert",
    }));

    await expect(hasPendingProgressReviewScheduleCardChanges([workspaceId])).resolves.toBe(true);
  });

  it("returns a consistent bucket snapshot when single-card writes interleave with reads", async () => {
    // Regression for: bucket counts read across many independent transactions
    // could double-count a card moved between buckets by a concurrent writer.
    // With per-(workspace, bucket) readonly transactions, an interleaving
    // putCard call that moves the mover card from "new" to "days1To7" between
    // two of the bucket reads makes the same card visible to both, so the
    // schedule reports one extra card. With a single readonly transaction
    // covering all bucket reads, the snapshot is internally consistent.
    const today = "2026-05-03";
    const baseCardCount = 4;
    const moverCardId = "mover-card";
    const stableCards: ReadonlyArray<Card> = Array.from({ length: baseCardCount }).map((_, index) => makeCard({
      cardId: `stable-card-${index}`,
      frontText: "Stable",
      backText: "back",
      tags: [],
      effortLevel: "fast",
      dueAt: null,
      createdAt: "2026-05-01T00:00:00.000Z",
    }));
    const moverNewCard = makeCard({
      cardId: moverCardId,
      frontText: "Mover",
      backText: "back",
      tags: [],
      effortLevel: "fast",
      dueAt: null,
      createdAt: "2026-05-01T00:00:00.000Z",
    });
    const moverTimedCard = makeCard({
      cardId: moverCardId,
      frontText: "Mover",
      backText: "back",
      tags: [],
      effortLevel: "fast",
      dueAt: dueAtUtcStart(today, 5),
      createdAt: "2026-05-01T00:00:00.000Z",
    });

    await replaceCards(workspaceId, [...stableCards, moverNewCard]);
    const expectedTotal = stableCards.length + 1;

    // Race many concurrent reader/writer pairs. The writer moves the same
    // card identity between buckets via single-transaction puts so the only
    // observable inconsistency is bucket double-counting (the card always
    // exists somewhere, never disappears).
    const iterations = 16;
    const racePromises: ReadonlyArray<Promise<unknown>> = Array.from({ length: iterations })
      .flatMap((_unused, index) => {
        const movedCard = index % 2 === 0 ? moverTimedCard : moverNewCard;
        return [
          loadLocalProgressReviewSchedule([workspaceId], {
            today,
            timeZone: "UTC",
          }),
          putCard(workspaceId, movedCard),
        ];
      });
    const settled = await Promise.all(racePromises);

    const schedules = settled.filter((value): value is Awaited<ReturnType<typeof loadLocalProgressReviewSchedule>> => {
      return typeof value === "object" && value !== null && "buckets" in value;
    });
    expect(schedules.length).toBe(iterations);

    for (const schedule of schedules) {
      const summed = schedule.buckets.reduce((total, bucket) => total + bucket.count, 0);
      // Self-consistency: the local builder computes totalCards from the
      // bucket sum, so this guards the wiring.
      expect(summed).toBe(schedule.totalCards);
      // External consistency: the mover card must never be visible in two
      // buckets at once. A snapshot ever reporting expectedTotal + 1 means a
      // card moved between bucket reads inside the same load.
      expect(schedule.totalCards).toBe(expectedTotal);
    }
  });

  it("calculates pending card create and delete totals by final card state", async () => {
    await putOutboxRecord(makePendingCardOutboxRecord({
      operationId: "pending-create",
    }));
    await putOutboxRecord(makePendingCardOutboxRecord({
      operationId: "pending-update-before-delete",
      cardId: "pending-create-then-delete",
      clientUpdatedAt: "2026-05-03T09:10:00.000Z",
    }));
    await putOutboxRecord(makePendingCardOutboxRecord({
      operationId: "pending-delete-after-create",
      cardId: "pending-create-then-delete",
      cardCreatedAt: "2026-05-03T09:10:00.000Z",
      clientUpdatedAt: "2026-05-03T09:20:00.000Z",
      deletedAt: "2026-05-03T09:20:00.000Z",
    }));
    await putOutboxRecord(makePendingCardOutboxRecord({
      operationId: "pending-delete-existing",
      cardId: "existing-card",
      cardCreatedAt: "2026-05-01T09:00:00.000Z",
      clientUpdatedAt: "2026-05-03T09:30:00.000Z",
      deletedAt: "2026-05-03T09:30:00.000Z",
    }));

    await expect(calculatePendingProgressReviewScheduleCardTotalDelta([workspaceId])).resolves.toBe(0);
  });
});
