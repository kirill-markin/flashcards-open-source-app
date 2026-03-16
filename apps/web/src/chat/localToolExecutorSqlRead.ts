import { loadAllActiveCardsForSql } from "../localDb/cards";
import { loadAllActiveDecksForSql } from "../localDb/decks";
import { loadReviewEventsForSql } from "../localDb/reviews";
import { loadWorkspaceSettings } from "../localDb/workspace";
import type {
  Card,
  Deck,
  ReviewEvent,
  WorkspaceSummary,
} from "../types";
import {
  executeSqlSelect,
  getSqlResourceDescriptor,
  getSqlResourceDescriptors,
  likePatternToRegExp,
  type ParsedSqlStatement,
  type SqlResourceName,
  type SqlRow,
} from "../../../backend/src/aiTools/sqlDialect";
import type {
  LocalSqlExecutionResult,
  SqlSingleExecutionPayload,
} from "./localToolExecutorTypes";
import { MAX_SQL_LIMIT } from "./localToolExecutorTypes";

type LocalReadStatement = Extract<
  ParsedSqlStatement,
  Readonly<{ type: "show_tables" | "describe" | "select" }>
>;

function compareCardsByCreatedAt(left: Card, right: Card): number {
  const createdAtDifference = right.createdAt.localeCompare(left.createdAt);
  if (createdAtDifference !== 0) {
    return createdAtDifference;
  }

  return left.cardId.localeCompare(right.cardId);
}

function compareDecksByCreatedAt(left: Deck, right: Deck): number {
  const createdAtDifference = right.createdAt.localeCompare(left.createdAt);
  if (createdAtDifference !== 0) {
    return createdAtDifference;
  }

  return right.deckId.localeCompare(left.deckId);
}

export function toCardRow(card: Card): SqlRow {
  return {
    card_id: card.cardId,
    front_text: card.frontText,
    back_text: card.backText,
    tags: card.tags,
    effort_level: card.effortLevel,
    due_at: card.dueAt,
    created_at: card.createdAt,
    reps: card.reps,
    lapses: card.lapses,
    updated_at: card.updatedAt,
    deleted_at: card.deletedAt,
    fsrs_card_state: card.fsrsCardState,
    fsrs_step_index: card.fsrsStepIndex,
    fsrs_stability: card.fsrsStability,
    fsrs_difficulty: card.fsrsDifficulty,
    fsrs_last_reviewed_at: card.fsrsLastReviewedAt,
    fsrs_scheduled_days: card.fsrsScheduledDays,
  };
}

export function toDeckRow(deck: Deck): SqlRow {
  return {
    deck_id: deck.deckId,
    name: deck.name,
    tags: deck.filterDefinition.tags,
    effort_levels: deck.filterDefinition.effortLevels,
    created_at: deck.createdAt,
    updated_at: deck.updatedAt,
    deleted_at: deck.deletedAt,
  };
}

async function loadSelectRows(
  activeWorkspace: WorkspaceSummary,
  resourceName: SqlResourceName,
): Promise<ReadonlyArray<SqlRow>> {
  if (resourceName === "workspace") {
    const workspaceSettings = await loadWorkspaceSettings(activeWorkspace.workspaceId);
    if (workspaceSettings === null) {
      throw new Error("Workspace scheduler settings are not loaded");
    }

    return [{
      workspace_id: activeWorkspace.workspaceId,
      name: activeWorkspace.name,
      created_at: activeWorkspace.createdAt,
      algorithm: workspaceSettings.algorithm,
      desired_retention: workspaceSettings.desiredRetention,
      learning_steps_minutes: workspaceSettings.learningStepsMinutes,
      relearning_steps_minutes: workspaceSettings.relearningStepsMinutes,
      maximum_interval_days: workspaceSettings.maximumIntervalDays,
      enable_fuzz: workspaceSettings.enableFuzz,
    }];
  }

  if (resourceName === "cards") {
    const cards = await loadAllActiveCardsForSql(activeWorkspace.workspaceId);
    return [...cards].sort(compareCardsByCreatedAt).map(toCardRow);
  }

  if (resourceName === "decks") {
    const decks = await loadAllActiveDecksForSql(activeWorkspace.workspaceId);
    return [...decks].sort(compareDecksByCreatedAt).map(toDeckRow);
  }

  const reviewEvents = await loadReviewEventsForSql(activeWorkspace.workspaceId);
  return reviewEvents.map((event: ReviewEvent) => ({
    review_event_id: event.reviewEventId,
    card_id: event.cardId,
    device_id: event.deviceId,
    client_event_id: event.clientEventId,
    rating: event.rating,
    reviewed_at_client: event.reviewedAtClient,
    reviewed_at_server: event.reviewedAtServer,
  }));
}

export async function executeLocalSqlReadStatement(
  activeWorkspace: WorkspaceSummary,
  sql: string,
  statement: LocalReadStatement,
): Promise<LocalSqlExecutionResult> {
  if (statement.type === "show_tables") {
    const rows = getSqlResourceDescriptors()
      .filter((descriptor) => statement.likePattern === null || likePatternToRegExp(statement.likePattern).test(descriptor.resourceName))
      .map((descriptor) => ({
        table_name: descriptor.resourceName,
        writable: descriptor.writable,
        description: descriptor.description,
      }));
    return {
      payload: {
        statementType: "show_tables",
        resource: null,
        sql,
        normalizedSql: statement.normalizedSql,
        rows,
        rowCount: rows.length,
        limit: null,
        offset: null,
        hasMore: false,
      },
      didMutateAppState: false,
    };
  }

  if (statement.type === "describe") {
    const rows = getSqlResourceDescriptor(statement.resourceName).columns.map((column) => ({
      column_name: column.columnName,
      type: column.type,
      nullable: column.nullable,
      read_only: column.readOnly,
      filterable: column.filterable,
      sortable: column.sortable,
      description: column.description,
    }));
    return {
      payload: {
        statementType: "describe",
        resource: statement.resourceName,
        sql,
        normalizedSql: statement.normalizedSql,
        rows,
        rowCount: rows.length,
        limit: null,
        offset: null,
        hasMore: false,
      },
      didMutateAppState: false,
    };
  }

  const rows = await loadSelectRows(activeWorkspace, statement.source.resourceName);
  const result = executeSqlSelect(statement, rows, MAX_SQL_LIMIT);
  const payload: SqlSingleExecutionPayload = {
    statementType: "select",
    resource: statement.source.resourceName,
    sql,
    normalizedSql: statement.normalizedSql,
    rows: result.rows,
    rowCount: result.rowCount,
    limit: result.limit,
    offset: result.offset,
    hasMore: result.hasMore,
  };
  return {
    payload,
    didMutateAppState: false,
  };
}
