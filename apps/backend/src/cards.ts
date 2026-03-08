/**
 * Card persistence is responsible for enforcing the persisted FSRS invariants
 * described in docs/fsrs-scheduling-logic.md. Card rows and org.workspaces
 * fsrs_* columns are the runtime source of truth for scheduling.
 *
 * This file mirrors the scheduler-entrypoint and persisted-state handling in
 * `apps/ios/Flashcards/Flashcards/LocalDatabase.swift`.
 * If you change scheduler-state validation or review persistence here, make
 * the same change in the iOS mirror and update docs/fsrs-scheduling-logic.md.
 */
import { randomUUID } from "node:crypto";
import { query, transaction, type DatabaseExecutor } from "./db";
import { HttpError } from "./errors";
import {
  computeReviewSchedule,
  type FsrsCardState,
  type ReviewRating,
  type ReviewableCardScheduleState,
} from "./schedule";
import { getWorkspaceSchedulerConfig } from "./workspaceSchedulerSettings";

type TimestampValue = Date | string;

export type EffortLevel = "fast" | "medium" | "long";

type CardRow = Readonly<{
  card_id: string;
  front_text: string;
  back_text: string;
  tags: ReadonlyArray<string>;
  effort_level: EffortLevel;
  due_at: TimestampValue | null;
  reps: number;
  lapses: number;
  fsrs_card_state: FsrsCardState;
  fsrs_step_index: number | null;
  fsrs_stability: number | null;
  fsrs_difficulty: number | null;
  fsrs_last_reviewed_at: TimestampValue | null;
  fsrs_scheduled_days: number | null;
  updated_at: TimestampValue;
}>;

type ReviewableCardRow = Readonly<{
  card_id: string;
  front_text: string;
  back_text: string;
  due_at: TimestampValue | null;
  reps: number;
  lapses: number;
  fsrs_card_state: FsrsCardState;
  fsrs_step_index: number | null;
  fsrs_stability: number | null;
  fsrs_difficulty: number | null;
  fsrs_last_reviewed_at: TimestampValue | null;
  fsrs_scheduled_days: number | null;
}>;

type ReviewHistoryRow = Readonly<{
  review_event_id: string;
  card_id: string;
  rating: number;
  reviewed_at_client: TimestampValue;
  reviewed_at_server: TimestampValue;
}>;

type DeckSummaryRow = Readonly<{
  total_cards: string | number;
  due_cards: string | number;
  new_cards: string | number;
  reviewed_cards: string | number;
  total_reps: string | number;
  total_lapses: string | number;
}>;

export type Card = Readonly<{
  cardId: string;
  frontText: string;
  backText: string;
  tags: ReadonlyArray<string>;
  effortLevel: EffortLevel;
  dueAt: string | null;
  reps: number;
  lapses: number;
  fsrsCardState: FsrsCardState;
  fsrsStepIndex: number | null;
  fsrsStability: number | null;
  fsrsDifficulty: number | null;
  fsrsLastReviewedAt: string | null;
  fsrsScheduledDays: number | null;
  updatedAt: string;
}>;

export type CreateCardInput = Readonly<{
  frontText: string;
  backText: string;
  tags: ReadonlyArray<string>;
  effortLevel: EffortLevel;
}>;

export type UpdateCardInput = Readonly<{
  frontText?: string;
  backText?: string;
  tags?: ReadonlyArray<string>;
  effortLevel?: EffortLevel;
}>;

export type SubmitReviewInput = Readonly<{
  cardId: string;
  rating: ReviewRating;
  reviewedAtClient: string;
}>;

export type ReviewResult = Readonly<{
  card: Card;
  nextDueAt: string;
}>;

export type ReviewHistoryItem = Readonly<{
  reviewEventId: string;
  cardId: string;
  rating: number;
  reviewedAtClient: string;
  reviewedAtServer: string;
}>;

export type DeckSummary = Readonly<{
  totalCards: number;
  dueCards: number;
  newCards: number;
  reviewedCards: number;
  totalReps: number;
  totalLapses: number;
}>;

type UpdateQueryParts = Readonly<{
  assignments: ReadonlyArray<string>;
  params: ReadonlyArray<string | ReadonlyArray<string>>;
}>;

type FsrsStateSnapshot = Readonly<{
  due_at: TimestampValue | null;
  reps: number;
  lapses: number;
  fsrs_card_state: FsrsCardState;
  fsrs_step_index: number | null;
  fsrs_stability: number | null;
  fsrs_difficulty: number | null;
  fsrs_last_reviewed_at: TimestampValue | null;
  fsrs_scheduled_days: number | null;
}>;

const CARD_COLUMNS = [
  "card_id, front_text, back_text, tags, effort_level, due_at, reps, lapses,",
  "fsrs_card_state, fsrs_step_index, fsrs_stability, fsrs_difficulty, fsrs_last_reviewed_at, fsrs_scheduled_days, updated_at",
].join(" ");

const REVIEWABLE_CARD_COLUMNS = [
  "card_id, front_text, back_text, due_at, reps, lapses,",
  "fsrs_card_state, fsrs_step_index, fsrs_stability, fsrs_difficulty, fsrs_last_reviewed_at, fsrs_scheduled_days",
].join(" ");

const CARD_SELECT = [
  "SELECT",
  CARD_COLUMNS,
  "FROM content.cards",
].join(" ");

function toIsoString(value: TimestampValue): string {
  if (value instanceof Date) {
    return value.toISOString();
  }

  return new Date(value).toISOString();
}

function toDate(value: TimestampValue): Date {
  if (value instanceof Date) {
    return value;
  }

  return new Date(value);
}

function toNumber(value: string | number): number {
  return typeof value === "number" ? value : Number.parseInt(value, 10);
}

function mapCard(row: CardRow): Card {
  return {
    cardId: row.card_id,
    frontText: row.front_text,
    backText: row.back_text,
    tags: row.tags,
    effortLevel: row.effort_level,
    dueAt: row.due_at === null ? null : toIsoString(row.due_at),
    reps: row.reps,
    lapses: row.lapses,
    fsrsCardState: row.fsrs_card_state,
    fsrsStepIndex: row.fsrs_step_index,
    fsrsStability: row.fsrs_stability,
    fsrsDifficulty: row.fsrs_difficulty,
    fsrsLastReviewedAt: row.fsrs_last_reviewed_at === null ? null : toIsoString(row.fsrs_last_reviewed_at),
    fsrsScheduledDays: row.fsrs_scheduled_days,
    updatedAt: toIsoString(row.updated_at),
  };
}

function mapReviewHistoryItem(row: ReviewHistoryRow): ReviewHistoryItem {
  return {
    reviewEventId: row.review_event_id,
    cardId: row.card_id,
    rating: row.rating,
    reviewedAtClient: toIsoString(row.reviewed_at_client),
    reviewedAtServer: toIsoString(row.reviewed_at_server),
  };
}

function mapDeckSummary(row: DeckSummaryRow): DeckSummary {
  return {
    totalCards: toNumber(row.total_cards),
    dueCards: toNumber(row.due_cards),
    newCards: toNumber(row.new_cards),
    reviewedCards: toNumber(row.reviewed_cards),
    totalReps: toNumber(row.total_reps),
    totalLapses: toNumber(row.total_lapses),
  };
}

function buildCardUpdateQueryParts(input: UpdateCardInput): UpdateQueryParts {
  const assignments: Array<string> = [];
  const params: Array<string | ReadonlyArray<string>> = [];

  if (input.frontText !== undefined) {
    assignments.push(`front_text = $${assignments.length + 1}`);
    params.push(input.frontText);
  }

  if (input.backText !== undefined) {
    assignments.push(`back_text = $${assignments.length + 1}`);
    params.push(input.backText);
  }

  if (input.tags !== undefined) {
    assignments.push(`tags = $${assignments.length + 1}`);
    params.push(input.tags);
  }

  if (input.effortLevel !== undefined) {
    assignments.push(`effort_level = $${assignments.length + 1}`);
    params.push(input.effortLevel);
  }

  return { assignments, params };
}

function hasNewCardFsrsValues(card: FsrsStateSnapshot): boolean {
  return (
    card.fsrs_step_index !== null
    || card.fsrs_stability !== null
    || card.fsrs_difficulty !== null
    || card.fsrs_last_reviewed_at !== null
    || card.fsrs_scheduled_days !== null
  );
}

function hasMissingReviewStateFsrsValues(card: FsrsStateSnapshot): boolean {
  return (
    card.fsrs_stability === null
    || card.fsrs_difficulty === null
    || card.fsrs_last_reviewed_at === null
    || card.fsrs_scheduled_days === null
  );
}

export function getInvalidFsrsStateReason(card: FsrsStateSnapshot): string | null {
  // Keep in sync with apps/ios/Flashcards/Flashcards/FsrsScheduler.swift::getMemoryState(card:) and LocalDatabase persisted-state expectations.
  if (card.fsrs_card_state === "new") {
    if (card.due_at !== null) {
      return "New card must not persist due_at";
    }

    if (hasNewCardFsrsValues(card)) {
      return "New card has persisted FSRS state";
    }

    return null;
  }

  if (hasMissingReviewStateFsrsValues(card)) {
    return "Persisted FSRS card state is incomplete";
  }

  if (card.fsrs_card_state === "review" && card.fsrs_step_index !== null) {
    return "Review card must not persist fsrs_step_index";
  }

  if ((card.fsrs_card_state === "learning" || card.fsrs_card_state === "relearning") && card.fsrs_step_index === null) {
    return "Learning or relearning card is missing fsrs_step_index";
  }

  return null;
}

function assertConsistentFsrsState(card: FsrsStateSnapshot): void {
  const invalidReason = getInvalidFsrsStateReason(card);
  if (invalidReason !== null) {
    throw new Error(invalidReason);
  }
}

function logFsrsStateReset(workspaceId: string, cardId: string, reason: string): void {
  console.error(JSON.stringify({
    domain: "cards",
    action: "reset_invalid_fsrs_state",
    workspaceId,
    cardId,
    reason,
    repair: "reset",
  }));
}

async function resetCardRow(
  executor: DatabaseExecutor,
  workspaceId: string,
  cardId: string,
): Promise<CardRow> {
  const result = await executor.query<CardRow>(
    [
      "UPDATE content.cards",
      "SET due_at = NULL, reps = 0, lapses = 0, fsrs_card_state = 'new', fsrs_step_index = NULL,",
      "fsrs_stability = NULL, fsrs_difficulty = NULL, fsrs_last_reviewed_at = NULL, fsrs_scheduled_days = NULL,",
      "updated_at = now(), server_version = nextval('content.cards_server_version_seq')",
      "WHERE workspace_id = $1 AND card_id = $2 AND deleted_at IS NULL",
      "RETURNING",
      CARD_COLUMNS,
    ].join(" "),
    [workspaceId, cardId],
  );

  const repairedCard = result.rows[0];
  if (repairedCard === undefined) {
    throw new HttpError(404, "Card not found");
  }

  return repairedCard;
}

async function resetReviewableCardRow(
  executor: DatabaseExecutor,
  workspaceId: string,
  cardId: string,
): Promise<ReviewableCardRow> {
  const result = await executor.query<ReviewableCardRow>(
    [
      "UPDATE content.cards",
      "SET due_at = NULL, reps = 0, lapses = 0, fsrs_card_state = 'new', fsrs_step_index = NULL,",
      "fsrs_stability = NULL, fsrs_difficulty = NULL, fsrs_last_reviewed_at = NULL, fsrs_scheduled_days = NULL,",
      "updated_at = now(), server_version = nextval('content.cards_server_version_seq')",
      "WHERE workspace_id = $1 AND card_id = $2 AND deleted_at IS NULL",
      "RETURNING",
      REVIEWABLE_CARD_COLUMNS,
    ].join(" "),
    [workspaceId, cardId],
  );

  const repairedCard = result.rows[0];
  if (repairedCard === undefined) {
    throw new HttpError(404, "Card not found");
  }

  return repairedCard;
}

export async function validateOrResetCardRowForRead(
  executor: DatabaseExecutor,
  workspaceId: string,
  card: CardRow,
): Promise<CardRow> {
  const invalidReason = getInvalidFsrsStateReason(card);
  if (invalidReason === null) {
    return card;
  }

  logFsrsStateReset(workspaceId, card.card_id, invalidReason);
  return resetCardRow(executor, workspaceId, card.card_id);
}

async function validateOrResetReviewableCardRow(
  executor: DatabaseExecutor,
  workspaceId: string,
  card: ReviewableCardRow,
): Promise<ReviewableCardRow> {
  const invalidReason = getInvalidFsrsStateReason(card);
  if (invalidReason === null) {
    return card;
  }

  logFsrsStateReset(workspaceId, card.card_id, invalidReason);
  return resetReviewableCardRow(executor, workspaceId, card.card_id);
}

async function validateOrResetCardRowsForRead(
  executor: DatabaseExecutor,
  workspaceId: string,
  rows: ReadonlyArray<CardRow>,
): Promise<ReadonlyArray<CardRow>> {
  const repairedRows: Array<CardRow> = [];
  for (const row of rows) {
    repairedRows.push(await validateOrResetCardRowForRead(executor, workspaceId, row));
  }

  return repairedRows;
}

function compareCardsForReviewQueue(leftCard: CardRow, rightCard: CardRow): number {
  if (leftCard.due_at === null && rightCard.due_at === null) {
    return toDate(rightCard.updated_at).getTime() - toDate(leftCard.updated_at).getTime();
  }

  if (leftCard.due_at === null) {
    return -1;
  }

  if (rightCard.due_at === null) {
    return 1;
  }

  const dueDifference = toDate(leftCard.due_at).getTime() - toDate(rightCard.due_at).getTime();
  if (dueDifference !== 0) {
    return dueDifference;
  }

  return toDate(rightCard.updated_at).getTime() - toDate(leftCard.updated_at).getTime();
}

// Keep in sync with apps/ios/Flashcards/Flashcards/FsrsScheduler.swift::makeReviewableCardScheduleState(card:).
function toReviewableCardScheduleState(card: ReviewableCardRow): ReviewableCardScheduleState {
  return {
    cardId: card.card_id,
    reps: card.reps,
    lapses: card.lapses,
    fsrsCardState: card.fsrs_card_state,
    fsrsStepIndex: card.fsrs_step_index,
    fsrsStability: card.fsrs_stability,
    fsrsDifficulty: card.fsrs_difficulty,
    fsrsLastReviewedAt: card.fsrs_last_reviewed_at === null ? null : toDate(card.fsrs_last_reviewed_at),
    fsrsScheduledDays: card.fsrs_scheduled_days,
  };
}

async function loadReviewableCardForUpdate(
  executor: DatabaseExecutor,
  workspaceId: string,
  cardId: string,
): Promise<ReviewableCardRow> {
  const cardResult = await executor.query<ReviewableCardRow>(
    [
      "SELECT",
      REVIEWABLE_CARD_COLUMNS,
      "FROM content.cards",
      "WHERE workspace_id = $1 AND card_id = $2 AND deleted_at IS NULL",
      "FOR UPDATE",
    ].join(" "),
    [workspaceId, cardId],
  );

  const existingCard = cardResult.rows[0];
  if (existingCard === undefined) {
    throw new HttpError(404, "Card not found");
  }

  return validateOrResetReviewableCardRow(executor, workspaceId, existingCard);
}

export async function listCards(workspaceId: string): Promise<ReadonlyArray<Card>> {
  return transaction(async (executor) => {
    const result = await executor.query<CardRow>(
      [
        CARD_SELECT,
        "WHERE workspace_id = $1 AND deleted_at IS NULL",
        "ORDER BY updated_at DESC",
      ].join(" "),
      [workspaceId],
    );

    const repairedRows = await validateOrResetCardRowsForRead(executor, workspaceId, result.rows);
    return repairedRows.map(mapCard);
  });
}

export async function getCard(workspaceId: string, cardId: string): Promise<Card> {
  return transaction(async (executor) => {
    const result = await executor.query<CardRow>(
      [
        CARD_SELECT,
        "WHERE workspace_id = $1 AND card_id = $2 AND deleted_at IS NULL",
      ].join(" "),
      [workspaceId, cardId],
    );

    const row = result.rows[0];
    if (row === undefined) {
      throw new HttpError(404, "Card not found");
    }

    return mapCard(await validateOrResetCardRowForRead(executor, workspaceId, row));
  });
}

export async function createCard(
  workspaceId: string,
  input: CreateCardInput,
): Promise<Card> {
  const result = await query<CardRow>(
    [
      "INSERT INTO content.cards",
      "(",
      "card_id, workspace_id, front_text, back_text, tags, effort_level, due_at,",
      "reps, lapses, fsrs_card_state, fsrs_step_index, fsrs_stability, fsrs_difficulty, fsrs_last_reviewed_at, fsrs_scheduled_days, server_version",
      ")",
      "VALUES ($1, $2, $3, $4, $5, $6, NULL, 0, 0, 'new', NULL, NULL, NULL, NULL, NULL, DEFAULT)",
      "RETURNING",
      "card_id, front_text, back_text, tags, effort_level, due_at, reps, lapses,",
      "fsrs_card_state, fsrs_step_index, fsrs_stability, fsrs_difficulty, fsrs_last_reviewed_at, fsrs_scheduled_days, updated_at",
    ].join(" "),
    [randomUUID(), workspaceId, input.frontText, input.backText, input.tags, input.effortLevel],
  );

  const row = result.rows[0];
  if (row === undefined) {
    throw new Error("Card insert did not return a row");
  }

  return mapCard(row);
}

export async function updateCard(
  workspaceId: string,
  cardId: string,
  input: UpdateCardInput,
): Promise<Card> {
  const updateParts = buildCardUpdateQueryParts(input);

  if (updateParts.assignments.length === 0) {
    throw new HttpError(400, "At least one editable field must be provided");
  }

  const params = [...updateParts.params, workspaceId, cardId];
  const result = await query<CardRow>(
    [
      "UPDATE content.cards",
      `SET ${updateParts.assignments.join(", ")}, updated_at = now(),`,
      "server_version = nextval('content.cards_server_version_seq')",
      `WHERE workspace_id = $${params.length - 1} AND card_id = $${params.length} AND deleted_at IS NULL`,
      "RETURNING",
      "card_id, front_text, back_text, tags, effort_level, due_at, reps, lapses,",
      "fsrs_card_state, fsrs_step_index, fsrs_stability, fsrs_difficulty, fsrs_last_reviewed_at, fsrs_scheduled_days, updated_at",
    ].join(" "),
    params,
  );

  const row = result.rows[0];
  if (row === undefined) {
    throw new HttpError(404, "Card not found");
  }

  return mapCard(row);
}

export async function listReviewQueue(
  workspaceId: string,
  limit: number,
): Promise<ReadonlyArray<Card>> {
  return transaction(async (executor) => {
    const result = await executor.query<CardRow>(
      [
        CARD_SELECT,
        "WHERE workspace_id = $1",
        "AND deleted_at IS NULL",
        "AND (due_at IS NULL OR due_at <= now() OR fsrs_card_state = 'new')",
        "ORDER BY updated_at DESC",
      ].join(" "),
      [workspaceId],
    );

    const repairedRows = await validateOrResetCardRowsForRead(executor, workspaceId, result.rows);
    return repairedRows
      .filter((row) => row.due_at === null || toDate(row.due_at).getTime() <= Date.now())
      .sort(compareCardsForReviewQueue)
      .slice(0, limit)
      .map(mapCard);
  });
}

export async function searchCards(
  workspaceId: string,
  searchText: string,
  limit: number,
): Promise<ReadonlyArray<Card>> {
  const likeValue = `%${searchText}%`;
  return transaction(async (executor) => {
    const result = await executor.query<CardRow>(
      [
        CARD_SELECT,
        "WHERE workspace_id = $1",
        "AND deleted_at IS NULL",
        "AND (front_text ILIKE $2 OR back_text ILIKE $2 OR EXISTS (",
        "SELECT 1 FROM unnest(tags) AS tag WHERE tag ILIKE $2",
        "))",
        "ORDER BY updated_at DESC",
        "LIMIT $3",
      ].join(" "),
      [workspaceId, likeValue, limit],
    );

    const repairedRows = await validateOrResetCardRowsForRead(executor, workspaceId, result.rows);
    return repairedRows.map(mapCard);
  });
}

export async function listReviewHistory(
  workspaceId: string,
  limit: number,
  cardId?: string,
): Promise<ReadonlyArray<ReviewHistoryItem>> {
  const result = cardId === undefined
    ? await query<ReviewHistoryRow>(
      [
        "SELECT review_event_id, card_id, rating, reviewed_at_client, reviewed_at_server",
        "FROM content.review_events",
        "WHERE workspace_id = $1",
        "ORDER BY reviewed_at_server DESC",
        "LIMIT $2",
      ].join(" "),
      [workspaceId, limit],
    )
    : await query<ReviewHistoryRow>(
      [
        "SELECT review_event_id, card_id, rating, reviewed_at_client, reviewed_at_server",
        "FROM content.review_events",
        "WHERE workspace_id = $1 AND card_id = $2",
        "ORDER BY reviewed_at_server DESC",
        "LIMIT $3",
      ].join(" "),
      [workspaceId, cardId, limit],
    );

  return result.rows.map(mapReviewHistoryItem);
}

export async function summarizeDeckState(workspaceId: string): Promise<DeckSummary> {
  const result = await query<DeckSummaryRow>(
    [
      "SELECT",
      "COUNT(*)::int AS total_cards,",
      "COUNT(*) FILTER (WHERE due_at IS NULL OR due_at <= now())::int AS due_cards,",
      "COUNT(*) FILTER (WHERE reps = 0 AND lapses = 0)::int AS new_cards,",
      "COUNT(*) FILTER (WHERE reps > 0 OR lapses > 0)::int AS reviewed_cards,",
      "COALESCE(SUM(reps), 0)::int AS total_reps,",
      "COALESCE(SUM(lapses), 0)::int AS total_lapses",
      "FROM content.cards",
      "WHERE workspace_id = $1 AND deleted_at IS NULL",
    ].join(" "),
    [workspaceId],
  );

  const row = result.rows[0];
  if (row === undefined) {
    throw new Error("Deck summary query did not return a row");
  }

  return mapDeckSummary(row);
}

export async function submitReview(
  workspaceId: string,
  deviceId: string,
  input: SubmitReviewInput,
): Promise<ReviewResult> {
  // Keep in sync with apps/ios/Flashcards/Flashcards/LocalDatabase.swift::submitReview(workspaceId:reviewSubmission:).
  const reviewedAtClient = new Date(input.reviewedAtClient);
  if (Number.isNaN(reviewedAtClient.getTime())) {
    throw new HttpError(400, "reviewedAtClient must be a valid ISO timestamp");
  }

  return transaction(async (executor) => {
    const existingCard = await loadReviewableCardForUpdate(executor, workspaceId, input.cardId);
    const schedulerConfig = await getWorkspaceSchedulerConfig(executor, workspaceId);
    const schedule = computeReviewSchedule(
      toReviewableCardScheduleState(existingCard),
      schedulerConfig,
      input.rating,
      reviewedAtClient,
    );

    await executor.query(
      [
        "INSERT INTO content.review_events",
        "(review_event_id, workspace_id, card_id, device_id, client_event_id, rating, reviewed_at_client)",
        "VALUES ($1, $2, $3, $4, $5, $6, $7)",
      ].join(" "),
      [
        randomUUID(),
        workspaceId,
        input.cardId,
        deviceId,
        randomUUID(),
        input.rating,
        reviewedAtClient,
      ],
    );

    const updatedCardResult = await executor.query<CardRow>(
      [
        "UPDATE content.cards",
        "SET due_at = $1, reps = $2, lapses = $3, fsrs_card_state = $4, fsrs_step_index = $5,",
        "fsrs_stability = $6, fsrs_difficulty = $7, fsrs_last_reviewed_at = $8, fsrs_scheduled_days = $9, updated_at = now(),",
        "server_version = nextval('content.cards_server_version_seq')",
        "WHERE workspace_id = $10 AND card_id = $11",
        "RETURNING",
        "card_id, front_text, back_text, tags, effort_level, due_at, reps, lapses,",
        "fsrs_card_state, fsrs_step_index, fsrs_stability, fsrs_difficulty, fsrs_last_reviewed_at, fsrs_scheduled_days, updated_at",
      ].join(" "),
      [
        schedule.dueAt,
        schedule.reps,
        schedule.lapses,
        schedule.fsrsCardState,
        schedule.fsrsStepIndex,
        schedule.fsrsStability,
        schedule.fsrsDifficulty,
        schedule.fsrsLastReviewedAt,
        schedule.fsrsScheduledDays,
        workspaceId,
        input.cardId,
      ],
    );

    const updatedCard = updatedCardResult.rows[0];
    if (updatedCard === undefined) {
      throw new Error("Card review update did not return a row");
    }

    return {
      card: mapCard(updatedCard),
      nextDueAt: schedule.dueAt.toISOString(),
    };
  });
}
