import { randomUUID } from "node:crypto";
import { query, transaction } from "./db";
import { HttpError } from "./errors";
import { computeReviewSchedule, type ReviewRating } from "./schedule";

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
  updated_at: TimestampValue;
}>;

type ReviewableCardRow = Readonly<{
  card_id: string;
  front_text: string;
  back_text: string;
  reps: number;
  lapses: number;
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

function toIsoString(value: TimestampValue): string {
  if (value instanceof Date) {
    return value.toISOString();
  }

  return new Date(value).toISOString();
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

const CARD_SELECT = [
  "SELECT card_id, front_text, back_text, tags, effort_level, due_at, reps, lapses, updated_at",
  "FROM content.cards",
].join(" ");

export async function listCards(workspaceId: string): Promise<ReadonlyArray<Card>> {
  const result = await query<CardRow>(
    [
      CARD_SELECT,
      "WHERE workspace_id = $1 AND deleted_at IS NULL",
      "ORDER BY updated_at DESC",
    ].join(" "),
    [workspaceId],
  );

  return result.rows.map(mapCard);
}

export async function getCard(workspaceId: string, cardId: string): Promise<Card> {
  const result = await query<CardRow>(
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

  return mapCard(row);
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
      "RETURNING card_id, front_text, back_text, tags, effort_level, due_at, reps, lapses, updated_at",
    ].join(" "),
    [randomUUID(), workspaceId, input.frontText, input.backText, input.tags, input.effortLevel],
  );

  const row = result.rows[0];
  if (row === undefined) {
    throw new Error("Card insert did not return a row");
  }

  return mapCard(row);
}

type UpdateQueryParts = Readonly<{
  assignments: ReadonlyArray<string>;
  params: ReadonlyArray<string | ReadonlyArray<string>>;
}>;

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
      "RETURNING card_id, front_text, back_text, tags, effort_level, due_at, reps, lapses, updated_at",
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
  const result = await query<CardRow>(
    [
      CARD_SELECT,
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

export async function searchCards(
  workspaceId: string,
  searchText: string,
  limit: number,
): Promise<ReadonlyArray<Card>> {
  const likeValue = `%${searchText}%`;
  const result = await query<CardRow>(
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

  return result.rows.map(mapCard);
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
        "RETURNING card_id, front_text, back_text, tags, effort_level, due_at, reps, lapses, updated_at",
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
