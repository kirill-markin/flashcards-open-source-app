import { runAdminQuery, type AdminQueryRow } from "../../adminApi";
import type { AdminAppConfig } from "../../config";
import { escapeSqlStringLiteral } from "../../sql";
import { buildDataTableSqlClauses, type DataTableSqlClauses } from "../../table/dataTableSql";
import type { DataTableColumn, DataTableState } from "../../table/dataTableModel";
import {
  buildDistinctOptionsSql,
  buildNamedColumnsSql,
  emptyEnumOptions,
  parseEnumOptionsResponse,
  parsePageTotal,
} from "../../table/dataTableServerQuery";
import { utcInstantSql } from "../usersQuery";
import { readRowNullableNumber, readRowNullableString, readRowNumber, readRowString } from "./queryRowValues";
import { buildMatchesUserIdSql, buildUserSubjectSql } from "./userSubjectSql";

const listLabel = "User cards";
const fullTextLabel = "User card text";

/** Front and back are cut to this many characters in the list, so a page of long cards stays small. */
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

type CardField = keyof CardRow;

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

/**
 * The SQL every column's filter and sort read, keyed by the column ids `CardsTab` declares. Front and
 * back read the whole stored text, not the preview the row shows.
 */
const cardColumnSqlById: Readonly<Record<string, string>> = {
  front: "cards.front_text",
  back: "cards.back_text",
  tags: "array_to_string(cards.tags, ', ')",
  "card-type": "cards.card_type",
  effort: "cards.effort_level",
  created: "cards.created_at",
  updated: "cards.updated_at",
  due: "cards.due_at",
  reps: "cards.reps",
  lapses: "cards.lapses",
  "fsrs-state": "cards.fsrs_card_state",
  stability: "cards.fsrs_stability",
  difficulty: "cards.fsrs_difficulty",
  "last-reviewed": "cards.fsrs_last_reviewed_at",
  workspace: "workspaces.name",
  deleted: "cards.deleted_at IS NOT NULL",
  "deleted-at": "cards.deleted_at",
};

/** Each `CardRow` field, selected under its own name by `buildCardsPageSql`. */
const cardFieldSql: Readonly<Record<CardField, string>> = {
  cardId: "cards.card_id::text",
  frontPreview: `left(cards.front_text, ${cardTextPreviewLength})`,
  frontLength: "length(cards.front_text)",
  backPreview: `left(cards.back_text, ${cardTextPreviewLength})`,
  backLength: "length(cards.back_text)",
  tags: "array_to_string(cards.tags, ', ')",
  cardType: "cards.card_type",
  effortLevel: "cards.effort_level",
  createdAt: utcInstantSql("cards.created_at"),
  updatedAt: utcInstantSql("cards.updated_at"),
  dueAt: utcInstantSql("cards.due_at"),
  reps: "cards.reps",
  lapses: "cards.lapses",
  fsrsState: "cards.fsrs_card_state",
  stability: "cards.fsrs_stability",
  difficulty: "cards.fsrs_difficulty",
  lastReviewedAt: utcInstantSql("cards.fsrs_last_reviewed_at"),
  workspaceName: "workspaces.name",
  deletedAt: utcInstantSql("cards.deleted_at"),
};

const defaultOrderBySql = "cards.created_at DESC";

const tiebreakOrderBySql = "cards.card_id DESC";

function buildCardsPageSql(userId: string, clauses: DataTableSqlClauses): string {
  return `SELECT ${buildNamedColumnsSql(cardFieldSql).join(",\n    ")}
  ${buildMemberCardsFromSql(userId)}
    AND ${clauses.whereConditionSql}
  ${clauses.orderBySql}
  ${clauses.limitOffsetSql}`;
}

function buildCardsTotalSql(userId: string, clauses: DataTableSqlClauses): string {
  return `SELECT count(*)::int AS total_count
  ${buildMemberCardsFromSql(userId)}
    AND ${clauses.whereConditionSql}`;
}

function parseCardRow(row: AdminQueryRow, rowIndex: number): CardRow {
  const location = `${listLabel} row ${rowIndex}`;
  const string = (field: CardField): string => readRowString(row, field, location);
  const nullableString = (field: CardField): string | null => readRowNullableString(row, field, location);
  const number = (field: CardField): number => readRowNumber(row, field, location);
  const nullableNumber = (field: CardField): number | null => readRowNullableNumber(row, field, location);
  return {
    cardId: string("cardId"),
    frontPreview: string("frontPreview"),
    frontLength: number("frontLength"),
    backPreview: string("backPreview"),
    backLength: number("backLength"),
    tags: string("tags"),
    cardType: string("cardType"),
    effortLevel: string("effortLevel"),
    createdAt: string("createdAt"),
    updatedAt: string("updatedAt"),
    dueAt: nullableString("dueAt"),
    reps: number("reps"),
    lapses: number("lapses"),
    fsrsState: string("fsrsState"),
    stability: nullableNumber("stability"),
    difficulty: nullableNumber("difficulty"),
    lastReviewedAt: nullableString("lastReviewedAt"),
    workspaceName: string("workspaceName"),
    deletedAt: nullableString("deletedAt"),
  };
}

export type CardsPageResult = Readonly<{
  /** The cards matching the filters across every page. */
  totalCount: number;
  rows: ReadonlyArray<CardRow>;
}>;

/** The page at `state.page` of the person's cards and the matching total, in one request of two statements. */
export async function loadCardsPage(
  config: AdminAppConfig,
  userId: string,
  state: DataTableState,
  columns: ReadonlyArray<DataTableColumn<CardRow>>,
): Promise<CardsPageResult> {
  const clauses = buildDataTableSqlClauses(state, columns, cardColumnSqlById, defaultOrderBySql, tiebreakOrderBySql);
  const response = await runAdminQuery(config, `${buildCardsPageSql(userId, clauses)};\n${buildCardsTotalSql(userId, clauses)}`);
  const pageResult = response.resultSets[0];
  if (response.resultSets.length !== 2 || pageResult === undefined) {
    throw new Error(`${listLabel} query must return exactly two result sets.`);
  }
  return {
    totalCount: parsePageTotal(response.resultSets[1]?.rows[0]?.total_count, listLabel),
    rows: pageResult.rows.map((row, rowIndex) => parseCardRow(row, rowIndex)),
  };
}

/** Every enum column `CardsTab` declares. */
const cardEnumColumnIds: ReadonlyArray<string> = ["card-type", "effort", "fsrs-state", "workspace"];

/** Every value each enum column holds across the person's cards, NULL as `""`, in one scan. */
function buildCardsEnumOptionsSql(userId: string): string {
  const optionsSql = cardEnumColumnIds.map((columnId) => {
    const sqlExpression = cardColumnSqlById[columnId];
    if (sqlExpression === undefined) {
      throw new Error(`${listLabel} enum column "${columnId}" has no SQL expression.`);
    }
    return `'${columnId}', ${buildDistinctOptionsSql(`COALESCE(${sqlExpression}, '')`)}`;
  });
  return `SELECT json_build_object(
    ${optionsSql.join(",\n    ")}
  ) AS o
  ${buildMemberCardsFromSql(userId)}`;
}

export type CardsEnumOptions = ReadonlyMap<string, ReadonlyArray<string>>;

/** Every enum column with no options, which the table shows until `loadCardsEnumOptions` answers. */
export const emptyCardsEnumOptions: CardsEnumOptions = emptyEnumOptions(cardEnumColumnIds);

export async function loadCardsEnumOptions(config: AdminAppConfig, userId: string): Promise<CardsEnumOptions> {
  const response = await runAdminQuery(config, buildCardsEnumOptionsSql(userId));
  return parseEnumOptionsResponse(response, cardEnumColumnIds, listLabel);
}

/** `cardId` comes from a `loadCardsPage` row; the card must still be in one of the person's workspaces. */
export async function loadCardFullText(config: AdminAppConfig, userId: string, cardId: string): Promise<CardFullText> {
  const response = await runAdminQuery(config, `SELECT cards.front_text AS "frontText", cards.back_text AS "backText"
  ${buildMemberCardsFromSql(userId)}
    AND cards.card_id = ${escapeSqlStringLiteral(cardId)}::uuid`);
  const rows = response.resultSets[0]?.rows ?? [];
  const row = rows[0];
  if (response.resultSets.length !== 1 || rows.length !== 1 || row === undefined) {
    throw new Error(`${fullTextLabel} query must return exactly one row for card ${cardId}, got ${rows.length}.`);
  }
  const location = `${fullTextLabel} for card ${cardId}`;
  return {
    frontText: readRowString(row, "frontText", location),
    backText: readRowString(row, "backText", location),
  };
}
