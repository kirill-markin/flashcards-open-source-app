import { randomUUID } from "node:crypto";
import { query, transaction } from "./db";
import { HttpError } from "./errors";
import { computeReviewSchedule, type ReviewRating } from "./schedule";

type TimestampValue = Date | string;

type CardRow = Readonly<{
  card_id: string;
  front_text: string;
  back_text: string;
  due_at: TimestampValue | null;
  reps: number;
  lapses: number;
  updated_at: TimestampValue;
}>;

type ReviewableCardRow = Readonly<{
  card_id: string;
  front_text: string;
  back_text: string;
  reps: number;
  lapses: number;
}>;

export type Card = Readonly<{
  cardId: string;
  frontText: string;
  backText: string;
  dueAt: string | null;
  reps: number;
  lapses: number;
  updatedAt: string;
}>;

export type CreateCardInput = Readonly<{
  frontText: string;
  backText: string;
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

function toIsoString(value: TimestampValue): string {
  if (value instanceof Date) {
    return value.toISOString();
  }

  return new Date(value).toISOString();
}

function mapCard(row: CardRow): Card {
  return {
    cardId: row.card_id,
    frontText: row.front_text,
    backText: row.back_text,
    dueAt: row.due_at === null ? null : toIsoString(row.due_at),
    reps: row.reps,
    lapses: row.lapses,
    updatedAt: toIsoString(row.updated_at),
  };
}

export async function listCards(workspaceId: string): Promise<ReadonlyArray<Card>> {
  const result = await query<CardRow>(
    [
      "SELECT card_id, front_text, back_text, due_at, reps, lapses, updated_at",
      "FROM content.cards",
      "WHERE workspace_id = $1 AND deleted_at IS NULL",
      "ORDER BY updated_at DESC",
    ].join(" "),
    [workspaceId],
  );

  return result.rows.map(mapCard);
}

export async function createCard(
  workspaceId: string,
  input: CreateCardInput,
): Promise<Card> {
  const result = await query<CardRow>(
    [
      "INSERT INTO content.cards",
      "(card_id, workspace_id, front_text, back_text, tags, effort_level, due_at, server_version)",
      "VALUES ($1, $2, $3, $4, $5, $6, now(), DEFAULT)",
      "RETURNING card_id, front_text, back_text, due_at, reps, lapses, updated_at",
    ].join(" "),
    [randomUUID(), workspaceId, input.frontText, input.backText, [], "fast"],
  );

  const row = result.rows[0];
  if (row === undefined) {
    throw new Error("Card insert did not return a row");
  }

  return mapCard(row);
}

export async function listReviewQueue(
  workspaceId: string,
  limit: number,
): Promise<ReadonlyArray<Card>> {
  const result = await query<CardRow>(
    [
      "SELECT card_id, front_text, back_text, due_at, reps, lapses, updated_at",
      "FROM content.cards",
      "WHERE workspace_id = $1",
      "AND deleted_at IS NULL",
      "AND (due_at IS NULL OR due_at <= now())",
      "ORDER BY due_at ASC NULLS FIRST, updated_at DESC",
      "LIMIT $2",
    ].join(" "),
    [workspaceId, limit],
  );

  return result.rows.map(mapCard);
}

export async function submitReview(
  workspaceId: string,
  deviceId: string,
  input: SubmitReviewInput,
): Promise<ReviewResult> {
  const reviewedAtClient = new Date(input.reviewedAtClient);
  if (Number.isNaN(reviewedAtClient.getTime())) {
    throw new HttpError(400, "reviewedAtClient must be a valid ISO timestamp");
  }

  return transaction(async (executor) => {
    const cardResult = await executor.query<ReviewableCardRow>(
      [
        "SELECT card_id, front_text, back_text, reps, lapses",
        "FROM content.cards",
        "WHERE workspace_id = $1 AND card_id = $2 AND deleted_at IS NULL",
        "FOR UPDATE",
      ].join(" "),
      [workspaceId, input.cardId],
    );

    const existingCard = cardResult.rows[0];
    if (existingCard === undefined) {
      throw new HttpError(404, "Card not found");
    }

    const now = new Date();
    const schedule = computeReviewSchedule(
      existingCard.reps,
      existingCard.lapses,
      input.rating,
      now,
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
        "SET due_at = $1, reps = $2, lapses = $3, updated_at = now(),",
        "server_version = nextval('content.cards_server_version_seq')",
        "WHERE workspace_id = $4 AND card_id = $5",
        "RETURNING card_id, front_text, back_text, due_at, reps, lapses, updated_at",
      ].join(" "),
      [schedule.dueAt, schedule.reps, schedule.lapses, workspaceId, input.cardId],
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
