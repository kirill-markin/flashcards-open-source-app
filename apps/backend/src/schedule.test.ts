import { readFileSync } from "node:fs";
import path from "node:path";
import assert from "node:assert/strict";
import test from "node:test";
import {
  computeReviewSchedule,
  createEmptyReviewableCardScheduleState,
  rebuildCardScheduleState,
  type FsrsCardState,
  type ReviewRating,
  type ReviewSchedule,
  type ReviewableCardScheduleState,
} from "./schedule";
import {
  defaultWorkspaceSchedulerConfig,
  type WorkspaceSchedulerConfig,
} from "./workspaceSchedulerSettings";

/**
 * Backend FSRS parity tests.
 *
 * Keep in sync with:
 * - apps/ios/Flashcards/FlashcardsTests/FsrsSchedulerParityTests.swift
 * - tests/fsrs-full-vectors.json
 * - docs/fsrs-scheduling-logic.md
 */

type ReviewVector = Readonly<{
  at: string;
  rating: ReviewRating;
}>;

type ExpectedSchedule = Readonly<{
  dueAt: string | null;
  reps: number;
  lapses: number;
  fsrsCardState: FsrsCardState;
  fsrsStepIndex: number | null;
  fsrsStability: number | null;
  fsrsDifficulty: number | null;
  fsrsLastReviewedAt: string | null;
  fsrsScheduledDays: number | null;
}>;

type Fixture = Readonly<{
  name: string;
  cardId: string;
  settings: WorkspaceSchedulerConfig;
  reviews: ReadonlyArray<ReviewVector>;
  expected: ExpectedSchedule;
  rebuiltExpected: ExpectedSchedule;
}>;

const fixtures = JSON.parse(
  readFileSync(path.resolve(process.cwd(), "../../tests/fsrs-full-vectors.json"), "utf8"),
) as ReadonlyArray<Fixture>;

function applyReviewSequence(
  cardId: string,
  settings: WorkspaceSchedulerConfig,
  reviews: ReadonlyArray<ReviewVector>,
): ReviewSchedule | undefined {
  let state: ReviewableCardScheduleState = createEmptyReviewableCardScheduleState(cardId);
  let lastSchedule: ReviewSchedule | undefined;

  for (const review of reviews) {
    lastSchedule = computeReviewSchedule(state, settings, review.rating, new Date(review.at));
    state = {
      cardId: state.cardId,
      reps: lastSchedule.reps,
      lapses: lastSchedule.lapses,
      fsrsCardState: lastSchedule.fsrsCardState,
      fsrsStepIndex: lastSchedule.fsrsStepIndex,
      fsrsStability: lastSchedule.fsrsStability,
      fsrsDifficulty: lastSchedule.fsrsDifficulty,
      fsrsLastReviewedAt: lastSchedule.fsrsLastReviewedAt,
      fsrsScheduledDays: lastSchedule.fsrsScheduledDays,
    };
  }

  return lastSchedule;
}

function assertScheduleMatches(actual: ExpectedSchedule, expected: ExpectedSchedule): void {
  assert.equal(actual.dueAt, expected.dueAt);
  assert.equal(actual.reps, expected.reps);
  assert.equal(actual.lapses, expected.lapses);
  assert.equal(actual.fsrsCardState, expected.fsrsCardState);
  assert.equal(actual.fsrsStepIndex, expected.fsrsStepIndex);
  assert.equal(actual.fsrsStability, expected.fsrsStability);
  assert.equal(actual.fsrsDifficulty, expected.fsrsDifficulty);
  assert.equal(actual.fsrsLastReviewedAt, expected.fsrsLastReviewedAt);
  assert.equal(actual.fsrsScheduledDays, expected.fsrsScheduledDays);
}

function toExpectedSchedule(schedule: ReviewSchedule | undefined): ExpectedSchedule {
  if (schedule === undefined) {
    return {
      dueAt: null,
      reps: 0,
      lapses: 0,
      fsrsCardState: "new",
      fsrsStepIndex: null,
      fsrsStability: null,
      fsrsDifficulty: null,
      fsrsLastReviewedAt: null,
      fsrsScheduledDays: null,
    };
  }

  return {
    dueAt: schedule.dueAt.toISOString(),
    reps: schedule.reps,
    lapses: schedule.lapses,
    fsrsCardState: schedule.fsrsCardState,
    fsrsStepIndex: schedule.fsrsStepIndex,
    fsrsStability: schedule.fsrsStability,
    fsrsDifficulty: schedule.fsrsDifficulty,
    fsrsLastReviewedAt: schedule.fsrsLastReviewedAt.toISOString(),
    fsrsScheduledDays: schedule.fsrsScheduledDays,
  };
}

for (const fixture of fixtures) {
  test(`full fsrs vector: ${fixture.name}`, () => {
    const lastSchedule = applyReviewSequence(fixture.cardId, fixture.settings, fixture.reviews);
    assertScheduleMatches(toExpectedSchedule(lastSchedule), fixture.expected);

    const rebuilt = rebuildCardScheduleState(
      fixture.cardId,
      fixture.settings,
      fixture.reviews.map((review) => ({
        rating: review.rating,
        reviewedAt: new Date(review.at),
      })),
    );
    assertScheduleMatches(
      {
        dueAt: rebuilt.dueAt?.toISOString() ?? null,
        reps: rebuilt.reps,
        lapses: rebuilt.lapses,
        fsrsCardState: rebuilt.fsrsCardState,
        fsrsStepIndex: rebuilt.fsrsStepIndex,
        fsrsStability: rebuilt.fsrsStability,
        fsrsDifficulty: rebuilt.fsrsDifficulty,
        fsrsLastReviewedAt: rebuilt.fsrsLastReviewedAt?.toISOString() ?? null,
        fsrsScheduledDays: rebuilt.fsrsScheduledDays,
      },
      fixture.rebuiltExpected,
    );
  });
}

test("workspace scheduler config changes affect only future reviews", () => {
  const cardId = "config-change-card";
  const updatedSettings: WorkspaceSchedulerConfig = {
    ...defaultWorkspaceSchedulerConfig,
    learningStepsMinutes: [1],
  };

  const firstReviewAt = new Date("2026-03-08T09:00:00.000Z");
  const secondReviewAt = new Date("2026-03-08T09:01:00.000Z");
  const thirdReviewAt = new Date("2026-03-16T09:00:00.000Z");
  const initialSchedule = computeReviewSchedule(
    createEmptyReviewableCardScheduleState(cardId),
    defaultWorkspaceSchedulerConfig,
    2,
    firstReviewAt,
  );

  const persistedState: ReviewableCardScheduleState = {
    cardId,
    reps: initialSchedule.reps,
    lapses: initialSchedule.lapses,
    fsrsCardState: initialSchedule.fsrsCardState,
    fsrsStepIndex: initialSchedule.fsrsStepIndex,
    fsrsStability: initialSchedule.fsrsStability,
    fsrsDifficulty: initialSchedule.fsrsDifficulty,
    fsrsLastReviewedAt: initialSchedule.fsrsLastReviewedAt,
    fsrsScheduledDays: initialSchedule.fsrsScheduledDays,
  };
  const secondFutureSchedule = computeReviewSchedule(
    persistedState,
    updatedSettings,
    0,
    secondReviewAt,
  );
  const thirdFutureSchedule = computeReviewSchedule(
    {
      cardId,
      reps: secondFutureSchedule.reps,
      lapses: secondFutureSchedule.lapses,
      fsrsCardState: secondFutureSchedule.fsrsCardState,
      fsrsStepIndex: secondFutureSchedule.fsrsStepIndex,
      fsrsStability: secondFutureSchedule.fsrsStability,
      fsrsDifficulty: secondFutureSchedule.fsrsDifficulty,
      fsrsLastReviewedAt: secondFutureSchedule.fsrsLastReviewedAt,
      fsrsScheduledDays: secondFutureSchedule.fsrsScheduledDays,
    },
    updatedSettings,
    0,
    thirdReviewAt,
  );
  const rebuiltSchedule = rebuildCardScheduleState(
    cardId,
    updatedSettings,
    [
      { rating: 2, reviewedAt: firstReviewAt },
      { rating: 0, reviewedAt: secondReviewAt },
      { rating: 0, reviewedAt: thirdReviewAt },
    ],
  );

  assert.equal(thirdFutureSchedule.fsrsLastReviewedAt.toISOString(), thirdReviewAt.toISOString());
  assert.notEqual(rebuiltSchedule.dueAt?.toISOString() ?? null, thirdFutureSchedule.dueAt.toISOString());
  assert.notEqual(rebuiltSchedule.fsrsCardState, thirdFutureSchedule.fsrsCardState);
  assert.notEqual(rebuiltSchedule.lapses, thirdFutureSchedule.lapses);
});

test("UTC day boundaries use UTC calendar days", () => {
  const schedule = computeReviewSchedule(
    {
      cardId: "utc-boundary-card",
      reps: 1,
      lapses: 0,
      fsrsCardState: "review",
      fsrsStepIndex: null,
      fsrsStability: 8.2956,
      fsrsDifficulty: 1,
      fsrsLastReviewedAt: new Date("2026-03-08T23:30:00.000Z"),
      fsrsScheduledDays: 8,
    },
    defaultWorkspaceSchedulerConfig,
    2,
    new Date("2026-03-09T00:10:00.000Z"),
  );

  assert.equal(schedule.dueAt.toISOString(), "2026-03-22T00:10:00.000Z");
  assert.equal(schedule.reps, 2);
  assert.equal(schedule.lapses, 0);
  assert.equal(schedule.fsrsStability, 13.48506225);
  assert.equal(schedule.fsrsScheduledDays, 13);
});

test("same-day Hard lowers short-term stability", () => {
  const schedule = computeReviewSchedule(
    {
      cardId: "short-term-hard-card",
      reps: 1,
      lapses: 0,
      fsrsCardState: "learning",
      fsrsStepIndex: 1,
      fsrsStability: 2.3065,
      fsrsDifficulty: 2.11810397,
      fsrsLastReviewedAt: new Date("2026-03-08T09:00:00.000Z"),
      fsrsScheduledDays: 0,
    },
    defaultWorkspaceSchedulerConfig,
    1,
    new Date("2026-03-08T09:10:00.000Z"),
  );

  assert.equal(schedule.fsrsStability, 1.33337872);
  assert.equal(schedule.fsrsDifficulty, 4.75285849);
});

test("review failure relearning sequence matches official ts-fsrs 5.2.3", () => {
  const firstAgain = computeReviewSchedule(
    {
      cardId: "official-relearning-card",
      reps: 54,
      lapses: 8,
      fsrsCardState: "review",
      fsrsStepIndex: null,
      fsrsStability: 76.50524045,
      fsrsDifficulty: 9.7990791,
      fsrsLastReviewedAt: new Date("2036-06-15T00:27:00.000Z"),
      fsrsScheduledDays: 72,
    },
    defaultWorkspaceSchedulerConfig,
    0,
    new Date("2036-07-12T23:33:00.000Z"),
  );
  assert.equal(firstAgain.fsrsStability, 2.96872958);
  assert.equal(firstAgain.fsrsDifficulty, 9.91918704);

  const secondAgain = computeReviewSchedule(
    {
      cardId: "official-relearning-card",
      reps: firstAgain.reps,
      lapses: firstAgain.lapses,
      fsrsCardState: firstAgain.fsrsCardState,
      fsrsStepIndex: firstAgain.fsrsStepIndex,
      fsrsStability: firstAgain.fsrsStability,
      fsrsDifficulty: firstAgain.fsrsDifficulty,
      fsrsLastReviewedAt: firstAgain.fsrsLastReviewedAt,
      fsrsScheduledDays: firstAgain.fsrsScheduledDays,
    },
    defaultWorkspaceSchedulerConfig,
    0,
    new Date("2036-07-18T23:55:00.000Z"),
  );
  const hardRelearning = computeReviewSchedule(
    {
      cardId: "official-relearning-card",
      reps: secondAgain.reps,
      lapses: secondAgain.lapses,
      fsrsCardState: secondAgain.fsrsCardState,
      fsrsStepIndex: secondAgain.fsrsStepIndex,
      fsrsStability: secondAgain.fsrsStability,
      fsrsDifficulty: secondAgain.fsrsDifficulty,
      fsrsLastReviewedAt: secondAgain.fsrsLastReviewedAt,
      fsrsScheduledDays: secondAgain.fsrsScheduledDays,
    },
    defaultWorkspaceSchedulerConfig,
    1,
    new Date("2036-07-25T18:11:00.000Z"),
  );
  const easyGraduation = computeReviewSchedule(
    {
      cardId: "official-relearning-card",
      reps: hardRelearning.reps,
      lapses: hardRelearning.lapses,
      fsrsCardState: hardRelearning.fsrsCardState,
      fsrsStepIndex: hardRelearning.fsrsStepIndex,
      fsrsStability: hardRelearning.fsrsStability,
      fsrsDifficulty: hardRelearning.fsrsDifficulty,
      fsrsLastReviewedAt: hardRelearning.fsrsLastReviewedAt,
      fsrsScheduledDays: hardRelearning.fsrsScheduledDays,
    },
    defaultWorkspaceSchedulerConfig,
    3,
    new Date("2036-07-27T18:37:00.000Z"),
  );
  const finalReview = computeReviewSchedule(
    {
      cardId: "official-relearning-card",
      reps: easyGraduation.reps,
      lapses: easyGraduation.lapses,
      fsrsCardState: easyGraduation.fsrsCardState,
      fsrsStepIndex: easyGraduation.fsrsStepIndex,
      fsrsStability: easyGraduation.fsrsStability,
      fsrsDifficulty: easyGraduation.fsrsDifficulty,
      fsrsLastReviewedAt: easyGraduation.fsrsLastReviewedAt,
      fsrsScheduledDays: easyGraduation.fsrsScheduledDays,
    },
    defaultWorkspaceSchedulerConfig,
    3,
    new Date("2036-09-03T07:47:00.000Z"),
  );

  assert.equal(finalReview.dueAt.toISOString(), "2036-09-12T07:47:00.000Z");
  assert.equal(finalReview.fsrsStability, 6.82018621);
  assert.equal(finalReview.fsrsScheduledDays, 9);
});

test("learning Good from the first short-term step graduates to review", () => {
  const againSchedule = computeReviewSchedule(
    createEmptyReviewableCardScheduleState("learning-again-good-card"),
    defaultWorkspaceSchedulerConfig,
    0,
    new Date("2026-03-08T09:00:00.000Z"),
  );
  const afterAgain = computeReviewSchedule(
    {
      cardId: "learning-again-good-card",
      reps: againSchedule.reps,
      lapses: againSchedule.lapses,
      fsrsCardState: againSchedule.fsrsCardState,
      fsrsStepIndex: againSchedule.fsrsStepIndex,
      fsrsStability: againSchedule.fsrsStability,
      fsrsDifficulty: againSchedule.fsrsDifficulty,
      fsrsLastReviewedAt: againSchedule.fsrsLastReviewedAt,
      fsrsScheduledDays: againSchedule.fsrsScheduledDays,
    },
    defaultWorkspaceSchedulerConfig,
    2,
    new Date("2026-03-08T09:01:00.000Z"),
  );
  assert.equal(afterAgain.dueAt.toISOString(), "2026-03-09T09:01:00.000Z");
  assert.equal(afterAgain.fsrsCardState, "review");
  assert.equal(afterAgain.fsrsStepIndex, null);
  assert.equal(afterAgain.fsrsScheduledDays, 1);

  const hardSchedule = computeReviewSchedule(
    createEmptyReviewableCardScheduleState("learning-hard-good-card"),
    defaultWorkspaceSchedulerConfig,
    1,
    new Date("2026-03-08T09:00:00.000Z"),
  );
  const afterHard = computeReviewSchedule(
    {
      cardId: "learning-hard-good-card",
      reps: hardSchedule.reps,
      lapses: hardSchedule.lapses,
      fsrsCardState: hardSchedule.fsrsCardState,
      fsrsStepIndex: hardSchedule.fsrsStepIndex,
      fsrsStability: hardSchedule.fsrsStability,
      fsrsDifficulty: hardSchedule.fsrsDifficulty,
      fsrsLastReviewedAt: hardSchedule.fsrsLastReviewedAt,
      fsrsScheduledDays: hardSchedule.fsrsScheduledDays,
    },
    defaultWorkspaceSchedulerConfig,
    2,
    new Date("2026-03-08T09:06:00.000Z"),
  );
  assert.equal(afterHard.dueAt.toISOString(), "2026-03-09T09:06:00.000Z");
  assert.equal(afterHard.fsrsCardState, "review");
  assert.equal(afterHard.fsrsStepIndex, null);
  assert.equal(afterHard.fsrsScheduledDays, 1);
});

test("backwards timestamps throw during direct scheduling", () => {
  assert.throws(
    () => computeReviewSchedule(
      {
        cardId: "backwards-direct-card",
        reps: 1,
        lapses: 0,
        fsrsCardState: "review",
        fsrsStepIndex: null,
        fsrsStability: 8.2956,
        fsrsDifficulty: 1,
        fsrsLastReviewedAt: new Date("2026-03-09T09:00:00.000Z"),
        fsrsScheduledDays: 8,
      },
      defaultWorkspaceSchedulerConfig,
      2,
      new Date("2026-03-08T08:59:00.000Z"),
    ),
    /Review timestamp moved backwards: lastReviewedAt=2026-03-09T09:00:00.000Z, now=2026-03-08T08:59:00.000Z/,
  );
});

test("backwards timestamps throw during rebuild", () => {
  assert.throws(
    () => rebuildCardScheduleState(
      "backwards-rebuild-card",
      defaultWorkspaceSchedulerConfig,
      [
        { rating: 2, reviewedAt: new Date("2026-03-09T09:10:00.000Z") },
        { rating: 2, reviewedAt: new Date("2026-03-08T09:00:00.000Z") },
      ],
    ),
    /Review timestamp moved backwards: lastReviewedAt=2026-03-09T09:10:00.000Z, now=2026-03-08T09:00:00.000Z/,
  );
});

test("same-day backwards timestamps throw during direct scheduling", () => {
  assert.throws(
    () => computeReviewSchedule(
      {
        cardId: "same-day-backwards-direct-card",
        reps: 1,
        lapses: 0,
        fsrsCardState: "review",
        fsrsStepIndex: null,
        fsrsStability: 8.2956,
        fsrsDifficulty: 1,
        fsrsLastReviewedAt: new Date("2026-03-08T09:10:00.000Z"),
        fsrsScheduledDays: 8,
      },
      defaultWorkspaceSchedulerConfig,
      2,
      new Date("2026-03-08T09:00:00.000Z"),
    ),
    /Review timestamp moved backwards: lastReviewedAt=2026-03-08T09:10:00.000Z, now=2026-03-08T09:00:00.000Z/,
  );
});

test("same-day backwards timestamps throw during rebuild", () => {
  assert.throws(
    () => rebuildCardScheduleState(
      "same-day-backwards-rebuild-card",
      defaultWorkspaceSchedulerConfig,
      [
        { rating: 2, reviewedAt: new Date("2026-03-08T09:10:00.000Z") },
        { rating: 2, reviewedAt: new Date("2026-03-08T09:00:00.000Z") },
      ],
    ),
    /Review timestamp moved backwards: lastReviewedAt=2026-03-08T09:10:00.000Z, now=2026-03-08T09:00:00.000Z/,
  );
});

test("Again updates reps and lapses with official semantics", () => {
  const newAgain = computeReviewSchedule(
    createEmptyReviewableCardScheduleState("counter-new-card"),
    defaultWorkspaceSchedulerConfig,
    0,
    new Date("2026-03-08T09:00:00.000Z"),
  );
  assert.equal(newAgain.reps, 1);
  assert.equal(newAgain.lapses, 0);

  const learningAgain = computeReviewSchedule(
    {
      cardId: "counter-learning-card",
      reps: newAgain.reps,
      lapses: newAgain.lapses,
      fsrsCardState: newAgain.fsrsCardState,
      fsrsStepIndex: newAgain.fsrsStepIndex,
      fsrsStability: newAgain.fsrsStability,
      fsrsDifficulty: newAgain.fsrsDifficulty,
      fsrsLastReviewedAt: newAgain.fsrsLastReviewedAt,
      fsrsScheduledDays: newAgain.fsrsScheduledDays,
    },
    defaultWorkspaceSchedulerConfig,
    0,
    new Date("2026-03-08T09:01:00.000Z"),
  );
  assert.equal(learningAgain.reps, 2);
  assert.equal(learningAgain.lapses, 0);

  const reviewAgain = computeReviewSchedule(
    {
      cardId: "counter-review-card",
      reps: 1,
      lapses: 0,
      fsrsCardState: "review",
      fsrsStepIndex: null,
      fsrsStability: 8.2956,
      fsrsDifficulty: 1,
      fsrsLastReviewedAt: new Date("2026-03-08T09:00:00.000Z"),
      fsrsScheduledDays: 8,
    },
    defaultWorkspaceSchedulerConfig,
    0,
    new Date("2026-03-16T09:00:00.000Z"),
  );
  assert.equal(reviewAgain.reps, 2);
  assert.equal(reviewAgain.lapses, 1);
});
