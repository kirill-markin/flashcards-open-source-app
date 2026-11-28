import { toDate } from "../../../cards/shared";
import { fsrsDefaultWeights, type ReviewRating } from "../../../scheduling";
import type { AnkiExportReview, AnkiStudyProgress } from "./studyProgress";

const secondsPerDay = 86_400;
export const ankiRolloverHour = 4;
const rolloverSeconds = ankiRolloverHour * 3_600;

function ankiStudyDay(timestamp: number): number {
  return Math.floor((timestamp - rolloverSeconds) / secondsPerDay);
}

export function ankiCollectionCreatedAt(exportedAt: number): number {
  // Leave room for the importing device's local study day to lag UTC by a day.
  return (ankiStudyDay(exportedAt) - 1) * secondsPerDay + rolloverSeconds;
}

enum AnkiReviewKind {
  Learning = 0,
  Review = 1,
  Relearning = 2,
}

const { Learning, Review, Relearning } = AnkiReviewKind;
type PossibleReviewTransitions = Readonly<Record<ReviewRating, ReadonlyArray<AnkiReviewKind>>>;

// Good can graduate a short-term card depending on the steps in force when it was answered.
const nextReviewKinds: Readonly<Record<AnkiReviewKind, PossibleReviewTransitions>> = {
  [Learning]: { 0: [Learning], 1: [Learning], 2: [Review, Learning], 3: [Review] },
  [Review]: { 0: [Relearning], 1: [Review], 2: [Review], 3: [Review] },
  [Relearning]: { 0: [Relearning], 1: [Relearning], 2: [Review, Relearning], 3: [Review] },
};
const reviewKinds = [Review, Learning, Relearning];

type AnkiLastReview = Readonly<{
  interval: number;
  factor: number;
  resultingKind: AnkiReviewKind;
}>;

type AnkiCardSchedule = Readonly<{
  type: number;
  queue: number;
  due: number;
  interval: number;
  reps: number;
  lapses: number;
  remainingSteps: number;
  data: string;
  lastReview: AnkiLastReview | null;
}>;

export function buildAnkiCardSchedule(
  studyProgress: AnkiStudyProgress | null,
  cardId: string,
  newPosition: number,
  collectionCreatedAt: number,
  exportedAt: number,
): AnkiCardSchedule {
  const state = studyProgress === null ? null : studyProgress.cards.get(cardId);
  if (state === undefined) {
    throw new Error(`Anki export is missing scheduling state for selected card ${cardId}`);
  }
  if (state === null || state.fsrs_card_state === "new") {
    return {
      type: 0,
      queue: 0,
      due: newPosition,
      interval: 0,
      reps: state?.reps ?? 0,
      lapses: state?.lapses ?? 0,
      remainingSteps: 0,
      data: "{}",
      lastReview: null,
    };
  }

  const { fsrs_stability, fsrs_difficulty, fsrs_last_reviewed_at, fsrs_scheduled_days, fsrs_step_index } = state;
  if (fsrs_stability === null || fsrs_difficulty === null || fsrs_last_reviewed_at === null || fsrs_scheduled_days === null) {
    throw new Error(`Anki export found incomplete FSRS state for card ${cardId}`);
  }

  const lastReviewedAt = toDate(fsrs_last_reviewed_at).getTime();
  const dueMs = state.due_at === null ? null : toDate(state.due_at).getTime();
  const due = dueMs === null ? exportedAt : Math.floor(dueMs / 1_000);
  const data = JSON.stringify({
    s: fsrs_stability,
    d: fsrs_difficulty,
    decay: fsrsDefaultWeights[20],
    lrt: Math.floor(lastReviewedAt / 1_000),
  });
  const difficultyFactor = Math.round(((fsrs_difficulty - 1) / 9 + 0.1) * 1_000);
  const common = { reps: state.reps, lapses: state.lapses, data };
  if (state.fsrs_card_state === "review") {
    const interval = Math.max(1, fsrs_scheduled_days);
    return {
      ...common,
      type: 2,
      queue: 2,
      due: ankiStudyDay(due) - ankiStudyDay(collectionCreatedAt),
      interval,
      remainingSteps: 0,
      lastReview: { interval, factor: difficultyFactor, resultingKind: Review },
    };
  }

  if (studyProgress === null || fsrs_step_index === null) {
    throw new Error(`Anki export found no learning step for card ${cardId}`);
  }
  const learning = state.fsrs_card_state === "learning";
  const steps = learning ? studyProgress.settings.learningStepsMinutes : studyProgress.settings.relearningStepsMinutes;
  const delaySeconds = dueMs === null ? 0 : Math.round((dueMs - lastReviewedAt) / 1_000);
  return {
    ...common,
    type: learning ? 1 : 3,
    queue: 1,
    due,
    interval: fsrs_scheduled_days,
    // Anki stores remaining steps modulo 1,000. A preset edit can shorten the old step list.
    remainingSteps: Math.min(999, Math.max(1, steps.length - fsrs_step_index)),
    lastReview: {
      interval: -Math.max(0, delaySeconds),
      factor: difficultyFactor,
      resultingKind: learning ? Learning : Relearning,
    },
  };
}

function inferCompleteRunKinds(
  run: ReadonlyArray<AnkiExportReview>,
  lapses: number,
  resultingKind: AnkiReviewKind,
): ReadonlyArray<AnkiReviewKind> | null {
  const kindCount = reviewKinds.length;
  const minimumLapses = new Int32Array((run.length + 1) * kindCount);
  const maximumLapses = new Int32Array(minimumLapses.length).fill(-1);
  maximumLapses[run.length * kindCount + resultingKind] = 0;

  // Feasible lapse counts are contiguous for each suffix and starting kind.
  // At the first Good or Easy that can reach the saved kind via Review, all
  // feasible starts can share the same remaining path, with at most one prior
  // lapse. Without such an answer, the path is deterministic.
  for (let index = run.length - 1; index >= 0; index -= 1) {
    const { rating } = run[index];
    const offset = index * kindCount;
    const nextOffset = offset + kindCount;
    for (const kind of reviewKinds) {
      const lapse = kind === Review && rating === 0 ? 1 : 0;
      let minimum = Number.POSITIVE_INFINITY;
      let maximum = -1;
      for (const nextKind of nextReviewKinds[kind][rating]) {
        const nextState = nextOffset + nextKind;
        if (maximumLapses[nextState] >= 0) {
          minimum = Math.min(minimum, minimumLapses[nextState] + lapse);
          maximum = Math.max(maximum, maximumLapses[nextState] + lapse);
        }
      }
      if (maximum >= 0) {
        minimumLapses[offset + kind] = minimum;
        maximumLapses[offset + kind] = maximum;
      }
    }
  }

  if (lapses < minimumLapses[Learning] || lapses > maximumLapses[Learning]) {
    return null;
  }

  // Prefer Review when it leaves a complete path with the saved lapse count.
  const kinds: Array<AnkiReviewKind> = [];
  let kind: AnkiReviewKind = Learning;
  let remainingLapses = lapses;
  for (const [index, { rating }] of run.entries()) {
    kinds.push(kind);
    remainingLapses -= kind === Review && rating === 0 ? 1 : 0;
    const nextKind: AnkiReviewKind | undefined = nextReviewKinds[kind][rating].find((candidate) => {
      const nextState = (index + 1) * kindCount + candidate;
      return minimumLapses[nextState] <= remainingLapses && remainingLapses <= maximumLapses[nextState];
    });
    if (nextKind === undefined) {
      throw new Error("Anki export found no continuation for a feasible review history");
    }
    kind = nextKind;
  }
  return kinds;
}

export function buildAnkiReviewHistory(
  reviews: ReadonlyArray<AnkiExportReview>,
  schedule: AnkiCardSchedule,
): ReadonlyArray<Readonly<{ kind: AnkiReviewKind; interval: number; factor: number }>> {
  const runStart = reviews.findIndex((review) => review.in_current_run);
  const run = reviews.filter((review) => review.in_current_run);
  const matchingReviews = run.filter((review) => review.matches_last_review);
  const lastReview = matchingReviews.length === 1 ? matchingReviews[0] : undefined;
  const savedReview = schedule.lastReview;
  const hasCompleteRun = run.length === schedule.reps && run.at(-1)?.matches_last_review === true;
  const kinds = hasCompleteRun && savedReview !== null
    ? inferCompleteRunKinds(run, schedule.lapses, savedReview.resultingKind)
    : null;

  // Events outside the current run or incomplete histories can lack a known phase. A matched last
  // answer is still constrained by the saved ending phase.
  const lastKind = lastReview === undefined || savedReview === null ? undefined : reviewKinds.find((kind) => (
    nextReviewKinds[kind][lastReview.rating].includes(savedReview.resultingKind)
  ));
  return reviews.map((review, index) => ({
    kind: kinds?.[index - runStart] ?? (review === lastReview ? lastKind ?? Review : Review),
    interval: review === lastReview ? savedReview?.interval ?? 0 : 0,
    factor: review === lastReview ? savedReview?.factor ?? 0 : 0,
  }));
}
