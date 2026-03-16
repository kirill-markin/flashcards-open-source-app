import type {
  Card,
  QueryCardsInput,
  QueryCardsPage,
} from "../types";
import {
  matchesCardFilter,
  matchesDeckFilterDefinition,
} from "../appData/domain";
import { loadAllowedCardIdsForTags, putCardTagRecords, writeCardTagRecords } from "./cardTags";
import {
  closeDatabaseAfter,
  closeDatabaseAfterWrite,
  describeIndexedDbError,
  getFromStore,
  runReadwrite,
  type StoredCard,
} from "./core";
import { encodeCursor, decodeCursor } from "./queryShared";

type CardCursorIndexName =
  | "workspaceId_createdAt_cardId"
  | "workspaceId_dueAt_cardId"
  | "workspaceId_effort_createdAt_cardId";

type IndexedCardCursorOptions = Readonly<{
  indexName: CardCursorIndexName;
  direction: IDBCursorDirection;
}>;

function toStoredCard(workspaceId: string, card: Card): StoredCard {
  return {
    workspaceId,
    cardId: card.cardId,
    frontText: card.frontText,
    backText: card.backText,
    tags: card.tags,
    effortLevel: card.effortLevel,
    dueAt: card.dueAt,
    createdAt: card.createdAt,
    reps: card.reps,
    lapses: card.lapses,
    fsrsCardState: card.fsrsCardState,
    fsrsStepIndex: card.fsrsStepIndex,
    fsrsStability: card.fsrsStability,
    fsrsDifficulty: card.fsrsDifficulty,
    fsrsLastReviewedAt: card.fsrsLastReviewedAt,
    fsrsScheduledDays: card.fsrsScheduledDays,
    clientUpdatedAt: card.clientUpdatedAt,
    lastModifiedByDeviceId: card.lastModifiedByDeviceId,
    lastOperationId: card.lastOperationId,
    updatedAt: card.updatedAt,
    deletedAt: card.deletedAt,
  };
}

function toCard(record: StoredCard): Card {
  return {
    cardId: record.cardId,
    frontText: record.frontText,
    backText: record.backText,
    tags: record.tags,
    effortLevel: record.effortLevel,
    dueAt: record.dueAt,
    createdAt: record.createdAt,
    reps: record.reps,
    lapses: record.lapses,
    fsrsCardState: record.fsrsCardState,
    fsrsStepIndex: record.fsrsStepIndex,
    fsrsStability: record.fsrsStability,
    fsrsDifficulty: record.fsrsDifficulty,
    fsrsLastReviewedAt: record.fsrsLastReviewedAt,
    fsrsScheduledDays: record.fsrsScheduledDays,
    clientUpdatedAt: record.clientUpdatedAt,
    lastModifiedByDeviceId: record.lastModifiedByDeviceId,
    lastOperationId: record.lastOperationId,
    updatedAt: record.updatedAt,
    deletedAt: record.deletedAt,
  };
}

function openIndexedCursor(
  store: IDBObjectStore,
  options: IndexedCardCursorOptions,
): IDBRequest<IDBCursorWithValue | null> {
  return store.index(options.indexName).openCursor(null, options.direction);
}

async function iterateCardsByIndex(
  database: IDBDatabase,
  workspaceId: string,
  options: IndexedCardCursorOptions,
  onCard: (card: Card) => boolean | void,
): Promise<void> {
  return new Promise((resolve, reject) => {
    const transaction = database.transaction(["cards"], "readonly");
    const cardsStore = transaction.objectStore("cards");
    const request = openIndexedCursor(cardsStore, options);
    let isResolved = false;

    const finish = (): void => {
      if (isResolved) {
        return;
      }

      isResolved = true;
      resolve();
    };

    request.onerror = () => {
      reject(describeIndexedDbError("IndexedDB cursor iteration failed", request.error));
    };

    transaction.onerror = () => {
      reject(describeIndexedDbError("IndexedDB transaction failed", transaction.error));
    };

    request.onsuccess = (event) => {
      const cursor = (event.target as IDBRequest<IDBCursorWithValue | null>).result;
      if (cursor === null) {
        finish();
        return;
      }

      const record = cursor.value as StoredCard;
      if (record.workspaceId !== workspaceId) {
        cursor.continue();
        return;
      }

      const shouldContinue = onCard(toCard(record));
      if (shouldContinue === false) {
        finish();
        return;
      }

      cursor.continue();
    };
  });
}

export async function iterateCardsByCreatedAtDesc(
  database: IDBDatabase,
  workspaceId: string,
  onCard: (card: Card) => boolean | void,
): Promise<void> {
  let currentCreatedAt: string | null | undefined;
  let currentGroup: Array<Card> = [];
  let shouldStop = false;

  function flushCurrentGroup(): boolean {
    const sortedGroup = [...currentGroup].sort((leftCard, rightCard) => leftCard.cardId.localeCompare(rightCard.cardId));
    currentGroup = [];

    for (const card of sortedGroup) {
      if (onCard(card) === false) {
        shouldStop = true;
        return false;
      }
    }

    return true;
  }

  await iterateCardsByIndex(
    database,
    workspaceId,
    {
      indexName: "workspaceId_createdAt_cardId",
      direction: "prev",
    },
    (card) => {
      if (shouldStop) {
        return false;
      }

      if (currentCreatedAt === undefined) {
        currentCreatedAt = card.createdAt;
        currentGroup = [card];
        return true;
      }

      if (currentCreatedAt === card.createdAt) {
        currentGroup.push(card);
        return true;
      }

      if (flushCurrentGroup() === false) {
        return false;
      }

      currentCreatedAt = card.createdAt;
      currentGroup = [card];
      return true;
    },
  );

  if (shouldStop === false && currentGroup.length > 0) {
    flushCurrentGroup();
  }
}

export async function iterateCardsByDueAtAsc(
  database: IDBDatabase,
  workspaceId: string,
  onCard: (card: Card) => boolean | void,
): Promise<void> {
  await iterateCardsByIndex(
    database,
    workspaceId,
    {
      indexName: "workspaceId_dueAt_cardId",
      direction: "next",
    },
    onCard,
  );
}

async function iterateCardsByEffortAndCreatedAtDesc(
  database: IDBDatabase,
  workspaceId: string,
  effortLevel: Card["effortLevel"],
  onCard: (card: Card) => boolean | void,
): Promise<void> {
  let currentCreatedAt: string | null | undefined;
  let currentGroup: Array<Card> = [];
  let shouldStop = false;

  function flushCurrentGroup(): boolean {
    const sortedGroup = [...currentGroup].sort((leftCard, rightCard) => leftCard.cardId.localeCompare(rightCard.cardId));
    currentGroup = [];

    for (const card of sortedGroup) {
      if (onCard(card) === false) {
        shouldStop = true;
        return false;
      }
    }

    return true;
  }

  await iterateCardsByIndex(
    database,
    workspaceId,
    {
      indexName: "workspaceId_effort_createdAt_cardId",
      direction: "prev",
    },
    (card) => {
      if (card.effortLevel !== effortLevel) {
        return true;
      }

      if (shouldStop) {
        return false;
      }

      if (currentCreatedAt === undefined) {
        currentCreatedAt = card.createdAt;
        currentGroup = [card];
        return true;
      }

      if (currentCreatedAt === card.createdAt) {
        currentGroup.push(card);
        return true;
      }

      if (flushCurrentGroup() === false) {
        return false;
      }

      currentCreatedAt = card.createdAt;
      currentGroup = [card];
      return true;
    },
  );

  if (shouldStop === false && currentGroup.length > 0) {
    flushCurrentGroup();
  }
}

function isDefaultCreatedAtDescendingSort(
  sorts: QueryCardsInput["sorts"],
): boolean {
  return sorts.length === 0 || (
    sorts.length === 1
    && sorts[0]?.key === "createdAt"
    && sorts[0].direction === "desc"
  );
}

function makeCursorCardIdPredicate(cursor: string | null): Readonly<{
  matches: (cardId: string) => boolean;
  isSet: boolean;
}> {
  if (cursor === null) {
    return {
      matches: () => false,
      isSet: false,
    };
  }

  const parsedCursor = decodeCursor(cursor);
  const cardId = parsedCursor.cardId;
  if (typeof cardId !== "string" || cardId === "") {
    throw new Error("cards cursor.cardId must be a non-empty string");
  }

  return {
    matches: (candidateCardId) => candidateCardId === cardId,
    isSet: true,
  };
}

function normalizeSearchText(searchText: string | null): string | null {
  if (searchText === null) {
    return null;
  }

  const normalizedSearchText = searchText.trim().toLowerCase();
  return normalizedSearchText === "" ? null : normalizedSearchText;
}

function matchesSearchText(card: Card, searchText: string | null): boolean {
  if (searchText === null) {
    return true;
  }

  const cardFields = [card.frontText, card.backText, ...card.tags].map((value) => value.toLowerCase());
  return cardFields.some((value) => value.includes(searchText));
}

function compareNullableText(left: string | null, right: string | null, direction: "asc" | "desc"): number {
  if (left === right) {
    return 0;
  }
  if (left === null) {
    return direction === "asc" ? -1 : 1;
  }
  if (right === null) {
    return direction === "asc" ? 1 : -1;
  }

  return direction === "asc"
    ? left.localeCompare(right)
    : right.localeCompare(left);
}

function compareText(left: string, right: string, direction: "asc" | "desc"): number {
  return direction === "asc"
    ? left.localeCompare(right, undefined, { sensitivity: "base" })
    : right.localeCompare(left, undefined, { sensitivity: "base" });
}

function compareNumber(left: number, right: number, direction: "asc" | "desc"): number {
  return direction === "asc" ? left - right : right - left;
}

function compareCardsForCardsQuery(
  leftCard: Card,
  rightCard: Card,
  sorts: QueryCardsInput["sorts"],
): number {
  for (const sort of sorts) {
    let difference = 0;

    if (sort.key === "frontText") {
      difference = compareText(leftCard.frontText, rightCard.frontText, sort.direction);
    } else if (sort.key === "backText") {
      difference = compareText(leftCard.backText, rightCard.backText, sort.direction);
    } else if (sort.key === "tags") {
      difference = compareText(leftCard.tags.join(","), rightCard.tags.join(","), sort.direction);
    } else if (sort.key === "effortLevel") {
      difference = compareText(leftCard.effortLevel, rightCard.effortLevel, sort.direction);
    } else if (sort.key === "dueAt") {
      difference = compareNullableText(leftCard.dueAt, rightCard.dueAt, sort.direction);
    } else if (sort.key === "reps") {
      difference = compareNumber(leftCard.reps, rightCard.reps, sort.direction);
    } else if (sort.key === "lapses") {
      difference = compareNumber(leftCard.lapses, rightCard.lapses, sort.direction);
    } else if (sort.key === "createdAt") {
      difference = compareText(leftCard.createdAt, rightCard.createdAt, sort.direction);
    }

    if (difference !== 0) {
      return difference;
    }
  }

  const createdAtDifference = rightCard.createdAt.localeCompare(leftCard.createdAt);
  if (createdAtDifference !== 0) {
    return createdAtDifference;
  }

  return leftCard.cardId.localeCompare(rightCard.cardId);
}

function decodeCardsCursorCardId(cursor: string): string {
  const parsedCursor = decodeCursor(cursor);
  const cardId = parsedCursor.cardId;
  if (typeof cardId !== "string" || cardId === "") {
    throw new Error("cards cursor.cardId must be a non-empty string");
  }

  return cardId;
}

async function loadCardsCursorCard(
  database: IDBDatabase,
  workspaceId: string,
  cursor: string | null,
): Promise<Card | null> {
  if (cursor === null) {
    return null;
  }

  const cardId = decodeCardsCursorCardId(cursor);
  const cursorCard = await getFromStore<StoredCard>(database, "cards", [workspaceId, cardId]);
  return cursorCard === undefined ? null : toCard(cursorCard);
}

function buildCardsPageCursorFromPage(
  pageCards: ReadonlyArray<Card>,
  hasMoreCards: boolean,
): string | null {
  if (hasMoreCards === false || pageCards.length === 0) {
    return null;
  }

  const lastCard = pageCards[pageCards.length - 1];
  if (lastCard === undefined) {
    throw new Error("Cards page cursor cannot be built without a last card");
  }

  return encodeCursor({ cardId: lastCard.cardId });
}

function insertCardIntoSortedWindow(
  currentWindow: ReadonlyArray<Card>,
  candidateCard: Card,
  sorts: QueryCardsInput["sorts"],
  limit: number,
): ReadonlyArray<Card> {
  if (limit < 1) {
    throw new Error("Cards sorted window limit must be positive");
  }

  const nextWindow = [...currentWindow];
  const insertIndex = nextWindow.findIndex((existingCard) => compareCardsForCardsQuery(candidateCard, existingCard, sorts) < 0);
  const resolvedInsertIndex = insertIndex === -1 ? nextWindow.length : insertIndex;

  if (nextWindow.length >= limit && resolvedInsertIndex >= limit) {
    return nextWindow;
  }

  nextWindow.splice(resolvedInsertIndex, 0, candidateCard);
  if (nextWindow.length > limit) {
    nextWindow.pop();
  }

  return nextWindow;
}

function deleteWorkspaceScopedRecords(
  store: IDBObjectStore,
  workspaceId: string,
): IDBRequest<IDBValidKey[]> {
  const request = store.getAllKeys();
  request.onsuccess = () => {
    for (const key of request.result) {
      if (!Array.isArray(key) || key[0] !== workspaceId) {
        continue;
      }

      store.delete(key);
    }
  };
  return request;
}

export async function loadActiveCardCountWithDatabase(database: IDBDatabase, workspaceId: string): Promise<number> {
  let count = 0;
  await iterateCardsByCreatedAtDesc(database, workspaceId, (card) => {
    if (card.deletedAt === null) {
      count += 1;
    }
    return true;
  });
  return count;
}

export async function loadActiveCardsForSqlWithDatabase(database: IDBDatabase, workspaceId: string): Promise<ReadonlyArray<Card>> {
  const cards: Array<Card> = [];
  await iterateCardsByCreatedAtDesc(database, workspaceId, (card) => {
    if (card.deletedAt === null) {
      cards.push(card);
    }
    return true;
  });
  return cards;
}

export async function loadActiveCardCount(workspaceId: string): Promise<number> {
  return closeDatabaseAfter((database) => loadActiveCardCountWithDatabase(database, workspaceId));
}

export async function loadAllActiveCardsForSql(workspaceId: string): Promise<ReadonlyArray<Card>> {
  return closeDatabaseAfter((database) => loadActiveCardsForSqlWithDatabase(database, workspaceId));
}

export async function queryLocalCardsPage(workspaceId: string, input: QueryCardsInput): Promise<QueryCardsPage> {
  return closeDatabaseAfter(async (database) => {
    const normalizedSearchText = normalizeSearchText(input.searchText);
    const allowedTagCardIds = input.filter === null || input.filter.tags.length === 0
      ? null
      : await loadAllowedCardIdsForTags(database, workspaceId, input.filter.tags);
    const canUseStreamingPage = isDefaultCreatedAtDescendingSort(input.sorts);

    if (canUseStreamingPage) {
      const cursorPredicate = makeCursorCardIdPredicate(input.cursor);
      let hasReachedCursor = cursorPredicate.isSet === false;
      let matchingCount = 0;
      let pageCards: Array<Card> = [];
      let hasMoreCards = false;

      const iterateCards = input.filter !== null && input.filter.effort.length === 1
        ? iterateCardsByEffortAndCreatedAtDesc(database, workspaceId, input.filter.effort[0], (card) => {
          if (card.deletedAt !== null) {
            return true;
          }
          if (allowedTagCardIds !== null && allowedTagCardIds.has(card.cardId) === false) {
            return true;
          }
          if (input.filter !== null && matchesCardFilter(input.filter, card) === false) {
            return true;
          }
          if (matchesSearchText(card, normalizedSearchText) === false) {
            return true;
          }

          matchingCount += 1;

          if (hasReachedCursor === false) {
            if (cursorPredicate.matches(card.cardId)) {
              hasReachedCursor = true;
            }
            return true;
          }

          if (pageCards.length < input.limit) {
            pageCards = [...pageCards, card];
            return true;
          }

          hasMoreCards = true;
          return true;
        })
        : iterateCardsByCreatedAtDesc(database, workspaceId, (card) => {
          if (card.deletedAt !== null) {
            return true;
          }
          if (allowedTagCardIds !== null && allowedTagCardIds.has(card.cardId) === false) {
            return true;
          }
          if (input.filter !== null && matchesCardFilter(input.filter, card) === false) {
            return true;
          }
          if (matchesSearchText(card, normalizedSearchText) === false) {
            return true;
          }

          matchingCount += 1;

          if (hasReachedCursor === false) {
            if (cursorPredicate.matches(card.cardId)) {
              hasReachedCursor = true;
            }
            return true;
          }

          if (pageCards.length < input.limit) {
            pageCards = [...pageCards, card];
            return true;
          }

          hasMoreCards = true;
          return true;
        });

      await iterateCards;

      return {
        cards: pageCards,
        nextCursor: hasMoreCards && pageCards.length > 0
          ? encodeCursor({ cardId: pageCards[pageCards.length - 1]?.cardId ?? "" })
          : null,
        totalCount: matchingCount,
      };
    }

    const cursorCard = await loadCardsCursorCard(database, workspaceId, input.cursor);
    const shouldUseCursorCard = cursorCard !== null
      && cursorCard.deletedAt === null
      && (allowedTagCardIds === null || allowedTagCardIds.has(cursorCard.cardId))
      && (input.filter === null || matchesCardFilter(input.filter, cursorCard))
      && matchesSearchText(cursorCard, normalizedSearchText);
    let matchingCount = 0;
    let pageWindow: Array<Card> = [];
    const pageWindowLimit = input.limit + 1;
    const baseIterator = input.sorts[0]?.key === "dueAt"
      ? iterateCardsByDueAtAsc(database, workspaceId, (card) => {
        if (card.deletedAt !== null) {
          return true;
        }
        if (allowedTagCardIds !== null && allowedTagCardIds.has(card.cardId) === false) {
          return true;
        }
        if (input.filter !== null && matchesCardFilter(input.filter, card) === false) {
          return true;
        }
        if (matchesSearchText(card, normalizedSearchText) === false) {
          return true;
        }

        matchingCount += 1;
        if (shouldUseCursorCard && compareCardsForCardsQuery(card, cursorCard, input.sorts) <= 0) {
          return true;
        }

        pageWindow = insertCardIntoSortedWindow(pageWindow, card, input.sorts, pageWindowLimit) as Array<Card>;
        return true;
      })
      : iterateCardsByCreatedAtDesc(database, workspaceId, (card) => {
        if (card.deletedAt !== null) {
          return true;
        }
        if (allowedTagCardIds !== null && allowedTagCardIds.has(card.cardId) === false) {
          return true;
        }
        if (input.filter !== null && matchesCardFilter(input.filter, card) === false) {
          return true;
        }
        if (matchesSearchText(card, normalizedSearchText) === false) {
          return true;
        }

        matchingCount += 1;
        if (shouldUseCursorCard && compareCardsForCardsQuery(card, cursorCard, input.sorts) <= 0) {
          return true;
        }

        pageWindow = insertCardIntoSortedWindow(pageWindow, card, input.sorts, pageWindowLimit) as Array<Card>;
        return true;
      });

    await baseIterator;
    const hasMoreCards = pageWindow.length > input.limit;
    const pageCards = hasMoreCards
      ? pageWindow.slice(0, input.limit)
      : pageWindow;

    return {
      cards: pageCards,
      nextCursor: buildCardsPageCursorFromPage(pageCards, hasMoreCards),
      totalCount: matchingCount,
    };
  });
}

export async function loadCardById(workspaceId: string, cardId: string): Promise<Card | null> {
  const card = await closeDatabaseAfter((database) => getFromStore<StoredCard>(database, "cards", [workspaceId, cardId]));

  if (card === undefined || card.deletedAt !== null) {
    return null;
  }

  return toCard(card);
}

export async function loadCardsMatchingDeck(
  workspaceId: string,
  filterDefinition: Readonly<{
    version: 2;
    effortLevels: ReadonlyArray<Card["effortLevel"]>;
    tags: ReadonlyArray<string>;
  }>,
): Promise<ReadonlyArray<Card>> {
  return closeDatabaseAfter(async (database) => {
    const cards: Array<Card> = [];
    await iterateCardsByCreatedAtDesc(database, workspaceId, (card) => {
      if (card.deletedAt !== null) {
        return true;
      }
      if (matchesDeckFilterDefinition(filterDefinition, card)) {
        cards.push(card);
      }
      return true;
    });
    return cards;
  });
}

export async function replaceCards(workspaceId: string, cards: ReadonlyArray<Card>): Promise<void> {
  await closeDatabaseAfterWrite(async (database) => {
    await runReadwrite(database, ["cards", "cardTags"], (transaction) => {
      const cardsStore = transaction.objectStore("cards");
      const cardTagsStore = transaction.objectStore("cardTags");
      const deleteCardsRequest = cardsStore.getAllKeys();
      deleteCardsRequest.onsuccess = () => {
        for (const key of deleteCardsRequest.result) {
          if (!Array.isArray(key) || key[0] !== workspaceId) {
            continue;
          }

          cardsStore.delete(key);
        }

        deleteWorkspaceScopedRecords(cardTagsStore, workspaceId);
      };
      return deleteCardsRequest;
    });

    await runReadwrite(database, ["cards", "cardTags"], (transaction) => {
      const store = transaction.objectStore("cards");
      const cardTagsStore = transaction.objectStore("cardTags");
      for (const card of cards) {
        store.put(toStoredCard(workspaceId, card));
        putCardTagRecords(cardTagsStore, workspaceId, card);
      }
      return null;
    });
  });
}

export async function putCard(workspaceId: string, card: Card): Promise<void> {
  await closeDatabaseAfterWrite(async (database) => {
    await runReadwrite(database, ["cards", "cardTags"], (transaction) => {
      transaction.objectStore("cards").put(toStoredCard(workspaceId, card));
      writeCardTagRecords(transaction, workspaceId, card);
      return null;
    });
  });
}
