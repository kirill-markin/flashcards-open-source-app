import { getStableDeviceId } from "../clientIdentity";
import {
  buildCardUpsertOperation,
  buildDeck,
  buildDeckUpsertOperation,
  buildDeletedCard,
  buildDeletedDeck,
  buildInitialCard,
  buildUpdatedCard,
  buildUpdatedDeck,
  normalizeCreateCardInput,
  normalizeCreateDeckInput,
  normalizeUpdateCardInput,
  normalizeUpdateDeckInput,
  nowIso,
} from "../appData/domain";
import {
  loadAllActiveCardsForSql,
  loadCardById,
} from "../localDb/cards";
import { openDatabase, runReadwrite } from "../localDb/core";
import { loadAllActiveDecksForSql, loadDeckById } from "../localDb/decks";
import type { PersistedOutboxRecord } from "../localDb/outbox";
import { writeCardTagRecords } from "../localDb/cardTags";
import type {
  Card,
  CreateCardInput,
  CreateDeckInput,
  Deck,
  UpdateCardInput,
  UpdateDeckInput,
  WorkspaceSummary,
} from "../types";
import {
  executeSqlSelect,
  type ParsedSqlStatement,
  type SqlRow,
} from "../../../backend/src/aiTools/sqlDialect";
import type {
  LocalSqlExecutionResult,
  SqlSingleExecutionPayload,
  WebLocalToolExecutorDependencies,
} from "./localToolExecutorTypes";
import { MAX_SQL_LIMIT } from "./localToolExecutorTypes";
import {
  toCardRow,
  toDeckRow,
} from "./localToolExecutorSqlRead";

type LocalMutationStatement = Extract<
  ParsedSqlStatement,
  Readonly<{ type: "insert" | "update" | "delete" }>
>;

type LocalUpdateOrDeleteStatement = Extract<
  ParsedSqlStatement,
  Readonly<{ type: "update" | "delete" }>
>;

type WebMutationBatchState = Readonly<{
  cards: ReadonlyArray<Card>;
  decks: ReadonlyArray<Deck>;
}>;

function toCreateCardInput(row: Readonly<Record<string, unknown>>): CreateCardInput {
  const frontText = row.front_text;
  const backText = row.back_text;
  const effortLevel = row.effort_level;
  const tags = row.tags;

  if (typeof frontText !== "string" || typeof backText !== "string") {
    throw new Error("INSERT INTO cards requires front_text and back_text");
  }

  if (effortLevel !== "fast" && effortLevel !== "medium" && effortLevel !== "long") {
    throw new Error("INSERT INTO cards requires effort_level to be fast, medium, or long");
  }

  return {
    frontText,
    backText,
    tags: Array.isArray(tags) ? tags.filter((item): item is string => typeof item === "string") : [],
    effortLevel,
  };
}

function toCreateDeckInput(row: Readonly<Record<string, unknown>>): CreateDeckInput {
  const name = row.name;
  const effortLevels = row.effort_levels;
  const tags = row.tags;

  if (typeof name !== "string") {
    throw new Error("INSERT INTO decks requires name");
  }

  return {
    name,
    filterDefinition: {
      version: 2,
      effortLevels: Array.isArray(effortLevels)
        ? effortLevels.filter((item): item is Card["effortLevel"] => item === "fast" || item === "medium" || item === "long")
        : [],
      tags: Array.isArray(tags) ? tags.filter((item): item is string => typeof item === "string") : [],
    },
  };
}

function toResolvedCardUpdateInput(existingCard: Card, row: Readonly<Record<string, unknown>>): UpdateCardInput {
  const frontText = row.front_text;
  const backText = row.back_text;
  const tags = row.tags;
  const effortLevel = row.effort_level;

  return {
    frontText: typeof frontText === "string" ? frontText : existingCard.frontText,
    backText: typeof backText === "string" ? backText : existingCard.backText,
    tags: Array.isArray(tags) ? tags.filter((item): item is string => typeof item === "string") : existingCard.tags,
    effortLevel: effortLevel === "fast" || effortLevel === "medium" || effortLevel === "long"
      ? effortLevel
      : existingCard.effortLevel,
  };
}

function toResolvedDeckUpdateInput(existingDeck: Deck, row: Readonly<Record<string, unknown>>): UpdateDeckInput {
  const name = row.name;
  const effortLevels = row.effort_levels;
  const tags = row.tags;

  return {
    name: typeof name === "string" ? name : existingDeck.name,
    filterDefinition: {
      version: 2,
      effortLevels: Array.isArray(effortLevels)
        ? effortLevels.filter((item): item is Card["effortLevel"] => item === "fast" || item === "medium" || item === "long")
        : existingDeck.filterDefinition.effortLevels,
      tags: Array.isArray(tags) ? tags.filter((item): item is string => typeof item === "string") : existingDeck.filterDefinition.tags,
    },
  };
}

function rowFromInsert(
  columnNames: ReadonlyArray<string>,
  values: ReadonlyArray<unknown>,
): Readonly<Record<string, unknown>> {
  return Object.fromEntries(columnNames.map((columnName, index) => [columnName, values[index]] as const));
}

function selectMutationRows(
  statement: LocalUpdateOrDeleteStatement,
  state: WebMutationBatchState,
): ReadonlyArray<SqlRow> {
  const currentRows = statement.resourceName === "cards"
    ? state.cards.map(toCardRow)
    : state.decks.map(toDeckRow);

  return executeSqlSelect({
    type: "select",
    source: {
      resourceName: statement.resourceName,
      unnestAlias: null,
      unnestColumnName: null,
    },
    selectItems: [{ type: "wildcard" }],
    predicateClauses: statement.predicateClauses,
    groupBy: [],
    orderBy: [],
    limit: MAX_SQL_LIMIT,
    offset: 0,
    normalizedSql: statement.normalizedSql,
  }, currentRows, Number.MAX_SAFE_INTEGER).rows;
}

async function commitMutationBatch(
  cardsById: ReadonlyMap<string, Card>,
  decksById: ReadonlyMap<string, Deck>,
  outboxRecords: ReadonlyArray<PersistedOutboxRecord>,
): Promise<void> {
  const database = await openDatabase();

  try {
    await runReadwrite(database, ["cards", "cardTags", "decks", "outbox"], (transaction) => {
      const cardsStore = transaction.objectStore("cards");
      const decksStore = transaction.objectStore("decks");
      const outboxStore = transaction.objectStore("outbox");

      for (const card of cardsById.values()) {
        cardsStore.put(card);
        writeCardTagRecords(transaction, card);
      }

      for (const deck of decksById.values()) {
        decksStore.put(deck);
      }

      for (const outboxRecord of outboxRecords) {
        outboxStore.put(outboxRecord);
      }

      return null;
    });
  } finally {
    database.close();
  }
}

async function loadCurrentMutationState(): Promise<WebMutationBatchState> {
  return {
    cards: await loadAllActiveCardsForSql(),
    decks: await loadAllActiveDecksForSql(),
  };
}

function toAssignmentRow(
  statement: Extract<ParsedSqlStatement, Readonly<{ type: "update" }>>,
): Readonly<Record<string, unknown>> {
  return Object.fromEntries(statement.assignments.map((assignment) => [assignment.columnName, assignment.value] as const));
}

export async function executeLocalSqlMutationStatement(
  dependencies: WebLocalToolExecutorDependencies,
  activeWorkspace: WorkspaceSummary,
  sql: string,
  statement: LocalMutationStatement,
): Promise<LocalSqlExecutionResult> {
  if (statement.type === "insert" && statement.resourceName === "cards") {
    const createdCards = await Promise.all(
      statement.rows.map((values) => dependencies.createCardItem(toCreateCardInput(rowFromInsert(statement.columnNames, values)))),
    );
    return {
      payload: {
        statementType: "insert",
        resource: "cards",
        sql,
        normalizedSql: statement.normalizedSql,
        rows: createdCards.map(toCardRow),
        affectedCount: createdCards.length,
      },
      didMutateAppState: true,
    };
  }

  if (statement.type === "insert" && statement.resourceName === "decks") {
    const createdDecks = await Promise.all(
      statement.rows.map((values) => dependencies.createDeckItem(toCreateDeckInput(rowFromInsert(statement.columnNames, values)))),
    );
    return {
      payload: {
        statementType: "insert",
        resource: "decks",
        sql,
        normalizedSql: statement.normalizedSql,
        rows: createdDecks.map(toDeckRow),
        affectedCount: createdDecks.length,
      },
      didMutateAppState: true,
    };
  }

  if (statement.type === "update" && statement.resourceName === "cards") {
    const currentRows = selectMutationRows(statement, await loadCurrentMutationState());
    const assignmentRow = toAssignmentRow(statement);
    const updatedCards = await Promise.all(currentRows.map(async (row) => {
      const cardId = row.card_id;
      if (typeof cardId !== "string") {
        throw new Error("Expected card_id in selected row");
      }

      const existingCard = await loadCardById(cardId);
      if (existingCard === null) {
        throw new Error(`Card not found: ${cardId}`);
      }

      return dependencies.updateCardItem(cardId, toResolvedCardUpdateInput(existingCard, assignmentRow));
    }));
    return {
      payload: {
        statementType: "update",
        resource: "cards",
        sql,
        normalizedSql: statement.normalizedSql,
        rows: updatedCards.map(toCardRow),
        affectedCount: updatedCards.length,
      },
      didMutateAppState: true,
    };
  }

  if (statement.type === "update" && statement.resourceName === "decks") {
    const currentRows = selectMutationRows(statement, await loadCurrentMutationState());
    const assignmentRow = toAssignmentRow(statement);
    const updatedDecks = await Promise.all(currentRows.map(async (row) => {
      const deckId = row.deck_id;
      if (typeof deckId !== "string") {
        throw new Error("Expected deck_id in selected row");
      }

      const existingDeck = await loadDeckById(deckId);
      if (existingDeck === null) {
        throw new Error(`Deck not found: ${deckId}`);
      }

      return dependencies.updateDeckItem(deckId, toResolvedDeckUpdateInput(existingDeck, assignmentRow));
    }));
    return {
      payload: {
        statementType: "update",
        resource: "decks",
        sql,
        normalizedSql: statement.normalizedSql,
        rows: updatedDecks.map(toDeckRow),
        affectedCount: updatedDecks.length,
      },
      didMutateAppState: true,
    };
  }

  if (statement.type === "delete" && statement.resourceName === "cards") {
    const currentRows = selectMutationRows(statement, await loadCurrentMutationState());
    const cardIds = currentRows.map((row) => {
      const cardId = row.card_id;
      if (typeof cardId !== "string") {
        throw new Error("Expected card_id in selected row");
      }

      return cardId;
    });
    await Promise.all(cardIds.map((cardId) => dependencies.deleteCardItem(cardId)));
    return {
      payload: {
        statementType: "delete",
        resource: "cards",
        sql,
        normalizedSql: statement.normalizedSql,
        rows: [],
        affectedCount: cardIds.length,
      },
      didMutateAppState: true,
    };
  }

  if (statement.type === "delete" && statement.resourceName === "decks") {
    const currentRows = selectMutationRows(statement, await loadCurrentMutationState());
    const deckIds = currentRows.map((row) => {
      const deckId = row.deck_id;
      if (typeof deckId !== "string") {
        throw new Error("Expected deck_id in selected row");
      }

      return deckId;
    });
    await Promise.all(deckIds.map((deckId) => dependencies.deleteDeckItem(deckId)));
    return {
      payload: {
        statementType: "delete",
        resource: "decks",
        sql,
        normalizedSql: statement.normalizedSql,
        rows: [],
        affectedCount: deckIds.length,
      },
      didMutateAppState: true,
    };
  }

  throw new Error("Unsupported SQL statement");
}

export async function executeLocalSqlMutationBatch(
  dependencies: WebLocalToolExecutorDependencies,
  activeWorkspace: WorkspaceSummary,
  sql: string,
  statements: ReadonlyArray<LocalMutationStatement>,
  statementSqls: ReadonlyArray<string>,
  normalizedSql: string,
): Promise<LocalSqlExecutionResult> {
  let state = await loadCurrentMutationState();
  const deviceId = getStableDeviceId();
  const payloads: Array<SqlSingleExecutionPayload> = [];
  const pendingCardsById = new Map<string, Card>();
  const pendingDecksById = new Map<string, Deck>();
  const outboxRecords: Array<PersistedOutboxRecord> = [];
  let affectedCountTotal = 0;

  for (const [index, statement] of statements.entries()) {
    const statementSql = statementSqls[index] ?? statement.normalizedSql;

    if (statement.type === "insert" && statement.resourceName === "cards") {
      const createdCards: Array<Card> = [];

      for (const values of statement.rows) {
        const normalizedInput = normalizeCreateCardInput(toCreateCardInput(rowFromInsert(statement.columnNames, values)));
        const clientUpdatedAt = nowIso();
        const operationId = crypto.randomUUID().toLowerCase();
        const nextCard = buildInitialCard(normalizedInput, clientUpdatedAt, deviceId, operationId);
        const outboxRecord: PersistedOutboxRecord = {
          operationId,
          workspaceId: activeWorkspace.workspaceId,
          createdAt: clientUpdatedAt,
          attemptCount: 0,
          lastError: "",
          operation: buildCardUpsertOperation(nextCard),
        };

        createdCards.push(nextCard);
        pendingCardsById.set(nextCard.cardId, nextCard);
        outboxRecords.push(outboxRecord);
      }

      state = {
        ...state,
        cards: [...createdCards, ...state.cards],
      };
      affectedCountTotal += createdCards.length;
      payloads.push({
        statementType: "insert",
        resource: "cards",
        sql: statementSql,
        normalizedSql: statement.normalizedSql,
        rows: createdCards.map(toCardRow),
        affectedCount: createdCards.length,
      });
      continue;
    }

    if (statement.type === "insert" && statement.resourceName === "decks") {
      const createdDecks: Array<Deck> = [];

      for (const values of statement.rows) {
        const normalizedInput = normalizeCreateDeckInput(toCreateDeckInput(rowFromInsert(statement.columnNames, values)));
        const clientUpdatedAt = nowIso();
        const operationId = crypto.randomUUID().toLowerCase();
        const nextDeck = {
          ...buildDeck(normalizedInput, clientUpdatedAt, deviceId, operationId),
          workspaceId: activeWorkspace.workspaceId,
        };
        const outboxRecord: PersistedOutboxRecord = {
          operationId,
          workspaceId: nextDeck.workspaceId,
          createdAt: clientUpdatedAt,
          attemptCount: 0,
          lastError: "",
          operation: buildDeckUpsertOperation(nextDeck),
        };

        createdDecks.push(nextDeck);
        pendingDecksById.set(nextDeck.deckId, nextDeck);
        outboxRecords.push(outboxRecord);
      }

      state = {
        ...state,
        decks: [...createdDecks, ...state.decks],
      };
      affectedCountTotal += createdDecks.length;
      payloads.push({
        statementType: "insert",
        resource: "decks",
        sql: statementSql,
        normalizedSql: statement.normalizedSql,
        rows: createdDecks.map(toDeckRow),
        affectedCount: createdDecks.length,
      });
      continue;
    }

    if (statement.type !== "update" && statement.type !== "delete") {
      throw new Error("Unsupported SQL statement");
    }

    const matchedRows = selectMutationRows(statement, state);

    if (statement.type === "update" && statement.resourceName === "cards") {
      const assignmentRow = toAssignmentRow(statement);
      const updatedCards: Array<Card> = [];

      for (const row of matchedRows) {
        const cardId = row.card_id;
        if (typeof cardId !== "string") {
          throw new Error("Expected card_id in selected row");
        }

        const existingCard = state.cards.find((card) => card.cardId === cardId);
        if (existingCard === undefined) {
          throw new Error(`Card not found: ${cardId}`);
        }

        const clientUpdatedAt = nowIso();
        const operationId = crypto.randomUUID().toLowerCase();
        const nextCard = buildUpdatedCard(
          existingCard,
          normalizeUpdateCardInput(toResolvedCardUpdateInput(existingCard, assignmentRow)),
          clientUpdatedAt,
          deviceId,
          operationId,
        );
        const outboxRecord: PersistedOutboxRecord = {
          operationId,
          workspaceId: activeWorkspace.workspaceId,
          createdAt: clientUpdatedAt,
          attemptCount: 0,
          lastError: "",
          operation: buildCardUpsertOperation(nextCard),
        };

        updatedCards.push(nextCard);
        pendingCardsById.set(nextCard.cardId, nextCard);
        outboxRecords.push(outboxRecord);
        state = {
          ...state,
          cards: state.cards.map((card) => card.cardId === nextCard.cardId ? nextCard : card),
        };
      }

      affectedCountTotal += updatedCards.length;
      payloads.push({
        statementType: "update",
        resource: "cards",
        sql: statementSql,
        normalizedSql: statement.normalizedSql,
        rows: updatedCards.map(toCardRow),
        affectedCount: updatedCards.length,
      });
      continue;
    }

    if (statement.type === "update" && statement.resourceName === "decks") {
      const assignmentRow = toAssignmentRow(statement);
      const updatedDecks: Array<Deck> = [];

      for (const row of matchedRows) {
        const deckId = row.deck_id;
        if (typeof deckId !== "string") {
          throw new Error("Expected deck_id in selected row");
        }

        const existingDeck = state.decks.find((deck) => deck.deckId === deckId);
        if (existingDeck === undefined) {
          throw new Error(`Deck not found: ${deckId}`);
        }

        const clientUpdatedAt = nowIso();
        const operationId = crypto.randomUUID().toLowerCase();
        const nextDeck = buildUpdatedDeck(
          existingDeck,
          normalizeUpdateDeckInput(toResolvedDeckUpdateInput(existingDeck, assignmentRow)),
          clientUpdatedAt,
          deviceId,
          operationId,
        );
        const outboxRecord: PersistedOutboxRecord = {
          operationId,
          workspaceId: nextDeck.workspaceId,
          createdAt: clientUpdatedAt,
          attemptCount: 0,
          lastError: "",
          operation: buildDeckUpsertOperation(nextDeck),
        };

        updatedDecks.push(nextDeck);
        pendingDecksById.set(nextDeck.deckId, nextDeck);
        outboxRecords.push(outboxRecord);
        state = {
          ...state,
          decks: state.decks.map((deck) => deck.deckId === nextDeck.deckId ? nextDeck : deck),
        };
      }

      affectedCountTotal += updatedDecks.length;
      payloads.push({
        statementType: "update",
        resource: "decks",
        sql: statementSql,
        normalizedSql: statement.normalizedSql,
        rows: updatedDecks.map(toDeckRow),
        affectedCount: updatedDecks.length,
      });
      continue;
    }

    if (statement.type === "delete" && statement.resourceName === "cards") {
      const deletedCards: Array<Card> = [];

      for (const row of matchedRows) {
        const cardId = row.card_id;
        if (typeof cardId !== "string") {
          throw new Error("Expected card_id in selected row");
        }

        const existingCard = state.cards.find((card) => card.cardId === cardId);
        if (existingCard === undefined) {
          throw new Error(`Card not found: ${cardId}`);
        }

        const clientUpdatedAt = nowIso();
        const operationId = crypto.randomUUID().toLowerCase();
        const nextCard = buildDeletedCard(existingCard, clientUpdatedAt, deviceId, operationId);
        const outboxRecord: PersistedOutboxRecord = {
          operationId,
          workspaceId: activeWorkspace.workspaceId,
          createdAt: clientUpdatedAt,
          attemptCount: 0,
          lastError: "",
          operation: buildCardUpsertOperation(nextCard),
        };

        deletedCards.push(nextCard);
        pendingCardsById.set(nextCard.cardId, nextCard);
        outboxRecords.push(outboxRecord);
        state = {
          ...state,
          cards: state.cards.filter((card) => card.cardId !== nextCard.cardId),
        };
      }

      affectedCountTotal += deletedCards.length;
      payloads.push({
        statementType: "delete",
        resource: "cards",
        sql: statementSql,
        normalizedSql: statement.normalizedSql,
        rows: [],
        affectedCount: deletedCards.length,
      });
      continue;
    }

    if (statement.type === "delete" && statement.resourceName === "decks") {
      const deletedDecks: Array<Deck> = [];

      for (const row of matchedRows) {
        const deckId = row.deck_id;
        if (typeof deckId !== "string") {
          throw new Error("Expected deck_id in selected row");
        }

        const existingDeck = state.decks.find((deck) => deck.deckId === deckId);
        if (existingDeck === undefined) {
          throw new Error(`Deck not found: ${deckId}`);
        }

        const clientUpdatedAt = nowIso();
        const operationId = crypto.randomUUID().toLowerCase();
        const nextDeck = buildDeletedDeck(existingDeck, clientUpdatedAt, deviceId, operationId);
        const outboxRecord: PersistedOutboxRecord = {
          operationId,
          workspaceId: nextDeck.workspaceId,
          createdAt: clientUpdatedAt,
          attemptCount: 0,
          lastError: "",
          operation: buildDeckUpsertOperation(nextDeck),
        };

        deletedDecks.push(nextDeck);
        pendingDecksById.set(nextDeck.deckId, nextDeck);
        outboxRecords.push(outboxRecord);
        state = {
          ...state,
          decks: state.decks.filter((deck) => deck.deckId !== nextDeck.deckId),
        };
      }

      affectedCountTotal += deletedDecks.length;
      payloads.push({
        statementType: "delete",
        resource: "decks",
        sql: statementSql,
        normalizedSql: statement.normalizedSql,
        rows: [],
        affectedCount: deletedDecks.length,
      });
      continue;
    }

    throw new Error("Unsupported SQL statement");
  }

  await commitMutationBatch(pendingCardsById, pendingDecksById, outboxRecords);
  await dependencies.refreshLocalData();

  return {
    payload: {
      statementType: "batch",
      resource: null,
      sql,
      normalizedSql,
      statements: payloads,
      statementCount: payloads.length,
      affectedCountTotal,
    },
    didMutateAppState: true,
  };
}
