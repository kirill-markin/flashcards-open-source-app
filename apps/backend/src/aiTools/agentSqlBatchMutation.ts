import { randomUUID } from "node:crypto";
import {
  createCardInExecutor,
  deleteCardInExecutor,
  listCardsInExecutor,
  updateCardInExecutor,
  type Card,
  type UpdateCardInput,
} from "../cards";
import {
  createDeckInExecutor,
  deleteDeckInExecutor,
  listDecksInExecutor,
  updateDeckInExecutor,
  type Deck,
  type DeckFilterDefinition,
  type UpdateDeckInput,
} from "../decks";
import { transactionWithWorkspaceScope } from "../db";
import { HttpError } from "../errors";
import type { AgentToolOperationDependencies } from "./agentToolOperations";
import { executeSqlSelect } from "./sqlDialect";
import {
  MAX_SQL_LIMIT,
  assertSqlMutationRecordLimit,
  buildBatchMutationInstructions,
  buildCreateCardInput,
  buildCreateDeckInput,
  makeBatchNormalizedSql,
  requireSqlMutationTargetIds,
  toCardRow,
  toCreatedCardRows,
  toCreatedDeckRows,
  toDeckRow,
  wrapBatchExecutionError,
  type AgentSqlContext,
  type AgentSqlExecutionResult,
  type AgentSqlMutationAssignment,
  type AgentSqlMutationStatement,
  type AgentSqlSinglePayload,
} from "./agentSqlShared";

type MutationBatchState = Readonly<{
  cards: ReadonlyArray<Card>;
  decks: ReadonlyArray<Deck>;
}>;

function buildMutationMetadata(
  replicaId: string,
): Readonly<{
  clientUpdatedAt: string;
  lastModifiedByReplicaId: string;
  lastOperationId: string;
}> {
  return {
    clientUpdatedAt: new Date().toISOString(),
    lastModifiedByReplicaId: replicaId,
    lastOperationId: randomUUID().toLowerCase(),
  };
}

function selectMutationRows(
  statement: Extract<AgentSqlMutationStatement, Readonly<{ type: "update" | "delete" }>>,
  state: MutationBatchState,
) {
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

function applyUpdatedCardToState(
  cards: ReadonlyArray<Card>,
  updatedCard: Card,
): ReadonlyArray<Card> {
  return cards.map((card) => card.cardId === updatedCard.cardId ? updatedCard : card);
}

function applyUpdatedDeckToState(
  decks: ReadonlyArray<Deck>,
  updatedDeck: Deck,
): ReadonlyArray<Deck> {
  return decks.map((deck) => deck.deckId === updatedDeck.deckId ? updatedDeck : deck);
}

function buildCardUpdatePatch(
  assignments: ReadonlyArray<AgentSqlMutationAssignment>,
): UpdateCardInput {
  let frontText: string | undefined;
  let backText: string | undefined;
  let tags: ReadonlyArray<string> | undefined;
  let effortLevel: "fast" | "medium" | "long" | undefined;

  for (const assignment of assignments) {
    if (assignment.columnName === "front_text") {
      if (typeof assignment.value !== "string") {
        throw new HttpError(400, "front_text must be a string", "QUERY_INVALID_SQL");
      }
      frontText = assignment.value;
    }

    if (assignment.columnName === "back_text") {
      if (typeof assignment.value !== "string") {
        throw new HttpError(400, "back_text must be a string", "QUERY_INVALID_SQL");
      }
      backText = assignment.value;
    }

    if (assignment.columnName === "tags") {
      if (Array.isArray(assignment.value) === false) {
        throw new HttpError(400, "tags must be a string array", "QUERY_INVALID_SQL");
      }
      tags = assignment.value.filter((item): item is string => typeof item === "string");
    }

    if (assignment.columnName === "effort_level") {
      if (assignment.value !== "fast" && assignment.value !== "medium" && assignment.value !== "long") {
        throw new HttpError(400, "effort_level must be fast, medium, or long", "QUERY_INVALID_SQL");
      }
      effortLevel = assignment.value;
    }
  }

  return {
    frontText,
    backText,
    tags,
    effortLevel,
  };
}

function buildResolvedDeckUpdateInput(
  existingDeck: Deck,
  assignments: ReadonlyArray<AgentSqlMutationAssignment>,
): UpdateDeckInput {
  let name: string = existingDeck.name;
  let effortLevels: ReadonlyArray<"fast" | "medium" | "long"> = existingDeck.filterDefinition.effortLevels;
  let tags: ReadonlyArray<string> = existingDeck.filterDefinition.tags;

  for (const assignment of assignments) {
    if (assignment.columnName === "name") {
      if (typeof assignment.value !== "string") {
        throw new HttpError(400, "name must be a string", "QUERY_INVALID_SQL");
      }
      name = assignment.value;
    }

    if (assignment.columnName === "effort_levels") {
      if (Array.isArray(assignment.value) === false) {
        throw new HttpError(400, "effort_levels must be a string array", "QUERY_INVALID_SQL");
      }
      effortLevels = assignment.value.filter((item): item is "fast" | "medium" | "long" => item === "fast" || item === "medium" || item === "long");
    }

    if (assignment.columnName === "tags") {
      if (Array.isArray(assignment.value) === false) {
        throw new HttpError(400, "tags must be a string array", "QUERY_INVALID_SQL");
      }
      tags = assignment.value.filter((item): item is string => typeof item === "string");
    }
  }

  return {
    name,
    filterDefinition: {
      version: 2,
      effortLevels,
      tags,
    } satisfies DeckFilterDefinition,
  };
}

export async function executeSqlMutationBatch(
  dependencies: AgentToolOperationDependencies,
  context: AgentSqlContext,
  sql: string,
  statements: ReadonlyArray<AgentSqlMutationStatement>,
  statementSqls: ReadonlyArray<string>,
): Promise<AgentSqlExecutionResult> {
  const replicaId = await dependencies.ensureAgentSyncReplica(
    context.workspaceId,
    context.userId,
    context.connectionId,
  );

  return transactionWithWorkspaceScope({ userId: context.userId, workspaceId: context.workspaceId }, async (executor) => {
    let state: MutationBatchState = {
      cards: await listCardsInExecutor(executor, context.workspaceId),
      decks: await listDecksInExecutor(executor, context.workspaceId),
    };
    const payloads: Array<AgentSqlSinglePayload> = [];
    let affectedCountTotal = 0;

    for (const [index, statement] of statements.entries()) {
      const statementSql = statementSqls[index] ?? statement.normalizedSql;

      try {
        if (statement.type === "insert" && statement.resourceName === "cards") {
          assertSqlMutationRecordLimit("insert", statement.rows.length);
          const createdCards: Array<Card> = [];
          for (const row of statement.rows) {
            const createdCard = await createCardInExecutor(
              executor,
              context.workspaceId,
              buildCreateCardInput(statement.columnNames, row),
              buildMutationMetadata(replicaId),
            );
            createdCards.push(createdCard);
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
            rows: toCreatedCardRows(createdCards),
            affectedCount: createdCards.length,
          });
          continue;
        }

        if (statement.type === "insert" && statement.resourceName === "decks") {
          assertSqlMutationRecordLimit("insert", statement.rows.length);
          const createdDecks: Array<Deck> = [];
          for (const row of statement.rows) {
            const createDeckInput = buildCreateDeckInput(statement.columnNames, row);
            const createdDeck = await createDeckInExecutor(
              executor,
              context.workspaceId,
              {
                name: createDeckInput.name,
                filterDefinition: {
                  version: 2,
                  effortLevels: createDeckInput.effortLevels,
                  tags: createDeckInput.tags,
                } satisfies DeckFilterDefinition,
              },
              buildMutationMetadata(replicaId),
            );
            createdDecks.push(createdDeck);
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
            rows: toCreatedDeckRows(createdDecks),
            affectedCount: createdDecks.length,
          });
          continue;
        }

        if (statement.type !== "update" && statement.type !== "delete") {
          throw new HttpError(400, "Unsupported SQL mutation", "QUERY_UNSUPPORTED_SYNTAX");
        }

        const matchedRows = selectMutationRows(statement, state);
        const targetIds = requireSqlMutationTargetIds(statement.resourceName, matchedRows);
        assertSqlMutationRecordLimit(statement.type, targetIds.length);

        if (statement.type === "update" && statement.resourceName === "cards") {
          const updatedCards: Array<Card> = [];
          for (const cardId of targetIds) {
            const updatedCard = await updateCardInExecutor(
              executor,
              context.workspaceId,
              cardId,
              buildCardUpdatePatch(statement.assignments),
              buildMutationMetadata(replicaId),
            );
            updatedCards.push(updatedCard);
            state = {
              ...state,
              cards: applyUpdatedCardToState(state.cards, updatedCard),
            };
          }

          affectedCountTotal += updatedCards.length;
          payloads.push({
            statementType: "update",
            resource: "cards",
            sql: statementSql,
            normalizedSql: statement.normalizedSql,
            rows: toCreatedCardRows(updatedCards),
            affectedCount: updatedCards.length,
          });
          continue;
        }

        if (statement.type === "update" && statement.resourceName === "decks") {
          const updatedDecks: Array<Deck> = [];
          for (const deckId of targetIds) {
            const existingDeck = state.decks.find((deck) => deck.deckId === deckId);
            if (existingDeck === undefined) {
              throw new HttpError(404, `Deck not found: ${deckId}`, "QUERY_INVALID_SQL");
            }

            const updatedDeck = await updateDeckInExecutor(
              executor,
              context.workspaceId,
              deckId,
              buildResolvedDeckUpdateInput(existingDeck, statement.assignments),
              buildMutationMetadata(replicaId),
            );
            updatedDecks.push(updatedDeck);
            state = {
              ...state,
              decks: applyUpdatedDeckToState(state.decks, updatedDeck),
            };
          }

          affectedCountTotal += updatedDecks.length;
          payloads.push({
            statementType: "update",
            resource: "decks",
            sql: statementSql,
            normalizedSql: statement.normalizedSql,
            rows: toCreatedDeckRows(updatedDecks),
            affectedCount: updatedDecks.length,
          });
          continue;
        }

        if (statement.type === "delete" && statement.resourceName === "cards") {
          for (const cardId of targetIds) {
            await deleteCardInExecutor(
              executor,
              context.workspaceId,
              cardId,
              buildMutationMetadata(replicaId),
            );
          }

          state = {
            ...state,
            cards: state.cards.filter((card) => targetIds.includes(card.cardId) === false),
          };
          affectedCountTotal += targetIds.length;
          payloads.push({
            statementType: "delete",
            resource: "cards",
            sql: statementSql,
            normalizedSql: statement.normalizedSql,
            rows: [],
            affectedCount: targetIds.length,
          });
          continue;
        }

        for (const deckId of targetIds) {
          await deleteDeckInExecutor(
            executor,
            context.workspaceId,
            deckId,
            buildMutationMetadata(replicaId),
          );
        }

        state = {
          ...state,
          decks: state.decks.filter((deck) => targetIds.includes(deck.deckId) === false),
        };
        affectedCountTotal += targetIds.length;
        payloads.push({
          statementType: "delete",
          resource: "decks",
          sql: statementSql,
          normalizedSql: statement.normalizedSql,
          rows: [],
          affectedCount: targetIds.length,
        });
      } catch (error) {
        wrapBatchExecutionError(error, index, statementSql);
      }
    }

    return {
      data: {
        statementType: "batch",
        resource: null,
        sql,
        normalizedSql: makeBatchNormalizedSql(statements),
        statements: payloads,
        statementCount: payloads.length,
        affectedCountTotal,
      },
      instructions: buildBatchMutationInstructions(),
    };
  });
}
