import { runAdminQuery, type AdminQueryValue } from "../../adminApi";
import type { AdminAppConfig } from "../../config";
import { escapeSqlStringLiteral } from "../../sql";
import { utcInstantSql } from "../usersQuery";
import { readNullableNumber, readNullableString, readNumber, readRowArray, readString } from "./queryRowValues";
import { buildMatchesUserIdSql, buildUserSubjectSql } from "./userSubjectSql";

const listLabel = "User cards";
const fullTextLabel = "User card text";

/**
 * Front and back are cut to this many characters in the list, so a large workspace still fits one
 * Lambda response; the full text of one card is loaded on demand.
 */
export const cardTextPreviewLength = 300;

export type CardRow = Readonly<{
  cardId: string;
  frontPreview: string;
  frontLength: number;
  backPreview: string;
  backLength: number;
  tags: string;
  cardType: string;
  effortLevel: string;
  createdAt: string;
  updatedAt: string;
  dueAt: string | null;
  reps: number;
  lapses: number;
  fsrsState: string;
  stability: number | null;
  difficulty: number | null;
  lastReviewedAt: string | null;
  workspaceName: string;
  deletedAt: string | null;
}>;

export type CardFullText = Readonly<{ frontText: string; backText: string }>;

/**
 * The cards of every workspace the person is a member of, deleted ones included. No workspace has
 * more than one member, so these are the person's own cards.
 */
function buildMemberCardsFromSql(userId: string): string {
  return `FROM org.workspace_memberships AS memberships
  JOIN org.workspaces AS workspaces ON workspaces.workspace_id = memberships.workspace_id
  JOIN content.cards AS cards ON cards.workspace_id = memberships.workspace_id
  WHERE ${buildMatchesUserIdSql("memberships.user_id", buildUserSubjectSql(userId))}`;
}

function buildCardsSql(userId: string): string {
  return `SELECT json_build_array(
    cards.card_id::text,
    left(cards.front_text, ${cardTextPreviewLength}),
    length(cards.front_text),
    left(cards.back_text, ${cardTextPreviewLength}),
    length(cards.back_text),
    array_to_string(cards.tags, ', '),
    cards.card_type,
    cards.effort_level,
    ${utcInstantSql("cards.created_at")},
    ${utcInstantSql("cards.updated_at")},
    ${utcInstantSql("cards.due_at")},
    cards.reps,
    cards.lapses,
    cards.fsrs_card_state,
    cards.fsrs_stability,
    cards.fsrs_difficulty,
    ${utcInstantSql("cards.fsrs_last_reviewed_at")},
    workspaces.name,
    ${utcInstantSql("cards.deleted_at")}
  ) AS c
  ${buildMemberCardsFromSql(userId)}
  ORDER BY cards.created_at DESC, cards.card_id DESC`;
}

function parseCardRow(value: AdminQueryValue | undefined, rowIndex: number): CardRow {
  const location = `${listLabel} row ${rowIndex}`;
  const values = readRowArray(value, 19, location);
  return {
    cardId: readString(values, 0, "cardId", location),
    frontPreview: readString(values, 1, "frontPreview", location),
    frontLength: readNumber(values, 2, "frontLength", location),
    backPreview: readString(values, 3, "backPreview", location),
    backLength: readNumber(values, 4, "backLength", location),
    tags: readString(values, 5, "tags", location),
    cardType: readString(values, 6, "cardType", location),
    effortLevel: readString(values, 7, "effortLevel", location),
    createdAt: readString(values, 8, "createdAt", location),
    updatedAt: readString(values, 9, "updatedAt", location),
    dueAt: readNullableString(values, 10, "dueAt", location),
    reps: readNumber(values, 11, "reps", location),
    lapses: readNumber(values, 12, "lapses", location),
    fsrsState: readString(values, 13, "fsrsState", location),
    stability: readNullableNumber(values, 14, "stability", location),
    difficulty: readNullableNumber(values, 15, "difficulty", location),
    lastReviewedAt: readNullableString(values, 16, "lastReviewedAt", location),
    workspaceName: readString(values, 17, "workspaceName", location),
    deletedAt: readNullableString(values, 18, "deletedAt", location),
  };
}

/** Every card of the person's workspaces, newest first, with front and back cut to the preview length. */
export async function loadCards(config: AdminAppConfig, userId: string): Promise<ReadonlyArray<CardRow>> {
  const response = await runAdminQuery(config, buildCardsSql(userId));
  const result = response.resultSets[0];
  if (response.resultSets.length !== 1 || result === undefined) {
    throw new Error(`${listLabel} query must return exactly one result set.`);
  }
  return result.rows.map((row, rowIndex) => parseCardRow(row.c, rowIndex));
}

/** `cardId` comes from a `loadCards` row; the card must still be in one of the person's workspaces. */
export async function loadCardFullText(config: AdminAppConfig, userId: string, cardId: string): Promise<CardFullText> {
  const response = await runAdminQuery(config, `SELECT json_build_array(cards.front_text, cards.back_text) AS c
  ${buildMemberCardsFromSql(userId)}
    AND cards.card_id = ${escapeSqlStringLiteral(cardId)}::uuid`);
  const rows = response.resultSets[0]?.rows ?? [];
  if (response.resultSets.length !== 1 || rows.length !== 1) {
    throw new Error(`${fullTextLabel} query must return exactly one row for card ${cardId}, got ${rows.length}.`);
  }
  const location = `${fullTextLabel} for card ${cardId}`;
  const values = readRowArray(rows[0]?.c, 2, location);
  return {
    frontText: readString(values, 0, "frontText", location),
    backText: readString(values, 1, "backText", location),
  };
}
