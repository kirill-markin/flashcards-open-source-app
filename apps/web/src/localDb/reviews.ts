import type {
  Card,
  Deck,
  ReviewCounts,
  ReviewEvent,
  ReviewFilter,
  ReviewQueueSnapshot,
  ReviewTimelinePage,
} from "../types";
import {
  ALL_CARDS_REVIEW_FILTER,
  compareCardsForReviewOrder,
  isCardDue,
  matchesDeckFilterDefinition,
} from "../appData/domain";
import { loadAllowedCardIdsForTags } from "./cardTags";
import { iterateCardsByCreatedAtDesc, iterateCardsByDueAtAsc } from "./cards";
import {
  closeDatabaseAfter,
  closeDatabaseAfterWrite,
  getAllFromStore,
  runReadwrite,
} from "./core";
import { loadDeckRecord } from "./decks";
import { decodeCursor, encodeCursor } from "./queryShared";

type ReviewCandidateAccumulator = Readonly<{
  matchingCards: ReadonlyArray<Card>;
  dueCards: ReadonlyArray<Card>;
}>;

type ReviewFilterResolution = Readonly<{
  resolvedReviewFilter: ReviewFilter;
  deck: Deck | null;
  allowedTagCardIds: ReadonlySet<string> | null;
}>;

async function resolveReviewFilterFromIndexedDb(
  database: IDBDatabase,
  workspaceId: string,
  reviewFilter: ReviewFilter,
): Promise<ReviewFilterResolution> {
  if (reviewFilter.kind === "allCards") {
    return {
      resolvedReviewFilter: ALL_CARDS_REVIEW_FILTER,
      deck: null,
      allowedTagCardIds: null,
    };
  }

  if (reviewFilter.kind === "deck") {
    const deck = await loadDeckRecord(database, workspaceId, reviewFilter.deckId);
    if (deck === null) {
      return {
        resolvedReviewFilter: ALL_CARDS_REVIEW_FILTER,
        deck: null,
        allowedTagCardIds: null,
      };
    }

    return {
      resolvedReviewFilter: reviewFilter,
      deck,
      allowedTagCardIds: null,
    };
  }

  if (reviewFilter.kind === "effort") {
    return {
      resolvedReviewFilter: reviewFilter,
      deck: null,
      allowedTagCardIds: null,
    };
  }

  const allowedTagCardIds = await loadAllowedCardIdsForTags(database, workspaceId, [reviewFilter.tag]);
  if (allowedTagCardIds.size === 0) {
    return {
      resolvedReviewFilter: ALL_CARDS_REVIEW_FILTER,
      deck: null,
      allowedTagCardIds: null,
    };
  }

  return {
    resolvedReviewFilter: reviewFilter,
    deck: null,
    allowedTagCardIds,
  };
}

function matchesResolvedReviewFilter(
  card: Card,
  filterResolution: ReviewFilterResolution,
): boolean {
  if (filterResolution.resolvedReviewFilter.kind === "allCards") {
    return true;
  }

  if (filterResolution.resolvedReviewFilter.kind === "deck") {
    if (filterResolution.deck === null) {
      return true;
    }

    return matchesDeckFilterDefinition(filterResolution.deck.filterDefinition, card);
  }

  if (filterResolution.resolvedReviewFilter.kind === "effort") {
    return card.effortLevel === filterResolution.resolvedReviewFilter.effortLevel;
  }

  return filterResolution.allowedTagCardIds?.has(card.cardId) ?? false;
}

function createEmptyReviewCandidateAccumulator(): ReviewCandidateAccumulator {
  return {
    matchingCards: [],
    dueCards: [],
  };
}

function appendReviewCandidate(
  accumulator: ReviewCandidateAccumulator,
  card: Card,
  nowTimestamp: number,
): ReviewCandidateAccumulator {
  return {
    matchingCards: [...accumulator.matchingCards, card],
    dueCards: isCardDue(card, nowTimestamp)
      ? [...accumulator.dueCards, card]
      : accumulator.dueCards,
  };
}

async function collectReviewCandidates(
  database: IDBDatabase,
  workspaceId: string,
  reviewFilter: ReviewFilter,
  nowTimestamp: number,
): Promise<Readonly<{
  filterResolution: ReviewFilterResolution;
  accumulator: ReviewCandidateAccumulator;
}>> {
  const filterResolution = await resolveReviewFilterFromIndexedDb(database, workspaceId, reviewFilter);
  let accumulator = createEmptyReviewCandidateAccumulator();
  await iterateReviewCardsInCanonicalOrder(database, workspaceId, nowTimestamp, (card) => {
    if (matchesResolvedReviewFilter(card, filterResolution) === false) {
      return true;
    }

    accumulator = appendReviewCandidate(accumulator, card, nowTimestamp);
    return true;
  });

  return {
    filterResolution,
    accumulator,
  };
}

async function iterateReviewCardsInCanonicalOrder(
  database: IDBDatabase,
  workspaceId: string,
  nowTimestamp: number,
  onCard: (card: Card) => boolean | void,
): Promise<void> {
  let shouldStop = false;
  const futureCards: Array<Card> = [];
  const invalidCards: Array<Card> = [];

  let currentDueAt: string | null | undefined;
  let currentDueGroup: Array<Card> = [];
  let currentDueGroupKind: "timedDue" | "future" | "invalid" | null = null;

  function flushCurrentDueGroup(): boolean {
    const sortedGroup = [...currentDueGroup].sort(
      (leftCard, rightCard) => compareCardsForReviewOrder(leftCard, rightCard, nowTimestamp),
    );
    currentDueGroup = [];

    if (currentDueGroupKind === "timedDue") {
      for (const card of sortedGroup) {
        if (onCard(card) === false) {
          shouldStop = true;
          return false;
        }
      }
    } else if (currentDueGroupKind === "future") {
      futureCards.push(...sortedGroup);
    } else if (currentDueGroupKind === "invalid") {
      invalidCards.push(...sortedGroup);
    }

    currentDueGroupKind = null;
    return true;
  }

  await iterateCardsByDueAtAsc(database, workspaceId, (card) => {
    if (shouldStop) {
      return false;
    }

    if (card.deletedAt !== null || card.dueAt === null) {
      return true;
    }

    const dueAtTimestamp = new Date(card.dueAt).getTime();
    const isInvalidDueAt = Number.isNaN(dueAtTimestamp);
    const isTimedDue = isInvalidDueAt === false && dueAtTimestamp <= nowTimestamp;
    const nextGroupKind: "timedDue" | "future" | "invalid" = isTimedDue
      ? "timedDue"
      : isInvalidDueAt
        ? "invalid"
        : "future";

    if (currentDueAt === undefined) {
      currentDueAt = card.dueAt;
      currentDueGroup = [card];
      currentDueGroupKind = nextGroupKind;
      return true;
    }

    if (currentDueAt === card.dueAt) {
      currentDueGroup = [...currentDueGroup, card];
      return true;
    }

    if (flushCurrentDueGroup() === false) {
      return false;
    }

    currentDueAt = card.dueAt;
    currentDueGroup = [card];
    currentDueGroupKind = nextGroupKind;
    return true;
  });

  if (shouldStop) {
    return;
  }

  if (currentDueGroup.length > 0) {
    if (flushCurrentDueGroup() === false) {
      return;
    }
  }

  if (shouldStop) {
    return;
  }

  let currentCreatedAt: string | null | undefined;
  let currentNullGroup: Array<Card> = [];

  function flushCurrentNullGroup(): boolean {
    const sortedGroup = [...currentNullGroup].sort((leftCard, rightCard) => leftCard.cardId.localeCompare(rightCard.cardId));
    currentNullGroup = [];

    for (const card of sortedGroup) {
      if (onCard(card) === false) {
        shouldStop = true;
        return false;
      }
    }

    return true;
  }

  await iterateCardsByCreatedAtDesc(database, workspaceId, (card) => {
    if (shouldStop) {
      return false;
    }
    if (card.deletedAt !== null || card.dueAt !== null) {
      return true;
    }

    if (currentCreatedAt === undefined) {
      currentCreatedAt = card.createdAt;
      currentNullGroup = [card];
      return true;
    }

    if (currentCreatedAt === card.createdAt) {
      currentNullGroup = [...currentNullGroup, card];
      return true;
    }

    if (flushCurrentNullGroup() === false) {
      return false;
    }

    currentCreatedAt = card.createdAt;
    currentNullGroup = [card];
    return true;
  });

  if (shouldStop === false && currentNullGroup.length > 0) {
    flushCurrentNullGroup();
  }

  if (shouldStop) {
    return;
  }

  for (const card of futureCards) {
    if (onCard(card) === false) {
      return;
    }
  }

  for (const card of invalidCards) {
    if (onCard(card) === false) {
      return;
    }
  }
}

function makeReviewCursorCardIdPredicate(cursor: string | null): Readonly<{
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
    throw new Error("review cursor.cardId must be a non-empty string");
  }

  return {
    matches: (candidateCardId) => candidateCardId === cardId,
    isSet: true,
  };
}

function makeReviewCountsFromCards(cards: ReadonlyArray<Card>, nowTimestamp: number): ReviewCounts {
  return cards.reduce<ReviewCounts>((result, card) => ({
    dueCount: result.dueCount + (isCardDue(card, nowTimestamp) ? 1 : 0),
    totalCount: result.totalCount + 1,
  }), {
    dueCount: 0,
    totalCount: 0,
  });
}

function buildReviewQueueCursor(cards: ReadonlyArray<Card>, pageCards: ReadonlyArray<Card>): string | null {
  if (pageCards.length === 0) {
    return null;
  }

  const lastCard = pageCards[pageCards.length - 1];
  const lastCardIndex = cards.findIndex((card) => card.cardId === lastCard.cardId);
  if (lastCardIndex === -1 || lastCardIndex >= cards.length - 1) {
    return null;
  }

  return encodeCursor({ cardId: lastCard.cardId });
}

function deleteWorkspaceReviewEvents(
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

export async function loadReviewEventsForSql(workspaceId: string): Promise<ReadonlyArray<ReviewEvent>> {
  return closeDatabaseAfter(async (database) => {
    const reviewEvents = await getAllFromStore<ReviewEvent>(database, "reviewEvents");
    return reviewEvents
      .filter((reviewEvent) => reviewEvent.workspaceId === workspaceId)
      .sort((leftEvent, rightEvent) => rightEvent.reviewedAtServer.localeCompare(leftEvent.reviewedAtServer));
  });
}

export async function loadReviewQueueSnapshot(
  workspaceId: string,
  reviewFilter: ReviewFilter,
  limit: number,
): Promise<ReviewQueueSnapshot> {
  return closeDatabaseAfter(async (database) => {
    const nowTimestamp = Date.now();
    const { filterResolution, accumulator } = await collectReviewCandidates(database, workspaceId, reviewFilter, nowTimestamp);
    const pageCards = accumulator.dueCards.slice(0, limit);

    return {
      resolvedReviewFilter: filterResolution.resolvedReviewFilter,
      cards: pageCards,
      nextCursor: buildReviewQueueCursor(accumulator.dueCards, pageCards),
      reviewCounts: makeReviewCountsFromCards(accumulator.matchingCards, nowTimestamp),
    };
  });
}

export async function loadReviewQueueChunk(
  workspaceId: string,
  reviewFilter: ReviewFilter,
  cursor: string | null,
  limit: number,
  excludedCardIds: ReadonlySet<string>,
): Promise<Readonly<{ cards: ReadonlyArray<Card>; nextCursor: string | null }>> {
  return closeDatabaseAfter(async (database) => {
    const nowTimestamp = Date.now();
    const filterResolution = await resolveReviewFilterFromIndexedDb(database, workspaceId, reviewFilter);
    const cursorPredicate = makeReviewCursorCardIdPredicate(cursor);
    let hasReachedCursor = cursorPredicate.isSet === false;
    let pageCards: Array<Card> = [];
    let hasMoreCards = false;

    await iterateReviewCardsInCanonicalOrder(database, workspaceId, nowTimestamp, (card) => {
      if (excludedCardIds.has(card.cardId)) {
        return true;
      }
      if (matchesResolvedReviewFilter(card, filterResolution) === false) {
        return true;
      }
      if (isCardDue(card, nowTimestamp) === false) {
        return true;
      }

      if (hasReachedCursor === false) {
        if (cursorPredicate.matches(card.cardId)) {
          hasReachedCursor = true;
        }
        return true;
      }

      if (pageCards.length < limit) {
        pageCards = [...pageCards, card];
        return true;
      }

      hasMoreCards = true;
      return false;
    });

    return {
      cards: pageCards,
      nextCursor: hasMoreCards && pageCards.length > 0
        ? encodeCursor({ cardId: pageCards[pageCards.length - 1]?.cardId ?? "" })
        : null,
    };
  });
}

export async function loadReviewTimelinePage(
  workspaceId: string,
  reviewFilter: ReviewFilter,
  limit: number,
  offset: number,
): Promise<ReviewTimelinePage> {
  return closeDatabaseAfter(async (database) => {
    const nowTimestamp = Date.now();
    const filterResolution = await resolveReviewFilterFromIndexedDb(database, workspaceId, reviewFilter);
    let matchingIndex = 0;
    let pageCards: Array<Card> = [];
    let hasMoreCards = false;

    await iterateReviewCardsInCanonicalOrder(database, workspaceId, nowTimestamp, (card) => {
      if (matchesResolvedReviewFilter(card, filterResolution) === false) {
        return true;
      }

      if (matchingIndex >= offset && pageCards.length < limit) {
        pageCards = [...pageCards, card];
      } else if (matchingIndex >= offset + limit) {
        hasMoreCards = true;
        return false;
      }

      matchingIndex += 1;
      return true;
    });

    return {
      cards: pageCards,
      hasMoreCards,
    };
  });
}

export async function replaceReviewEvents(workspaceId: string, reviewEvents: ReadonlyArray<ReviewEvent>): Promise<void> {
  await closeDatabaseAfterWrite(async (database) => {
    await runReadwrite(database, ["reviewEvents"], (transaction) => (
      deleteWorkspaceReviewEvents(transaction.objectStore("reviewEvents"), workspaceId)
    ));

    await runReadwrite(database, ["reviewEvents"], (transaction) => {
      const store = transaction.objectStore("reviewEvents");
      for (const reviewEvent of reviewEvents) {
        store.put(reviewEvent);
      }
      return null;
    });
  });
}

export function putReviewEventInTransaction(transaction: IDBTransaction, reviewEvent: ReviewEvent): void {
  transaction.objectStore("reviewEvents").put(reviewEvent);
}

export async function putReviewEvent(reviewEvent: ReviewEvent): Promise<void> {
  await closeDatabaseAfterWrite(async (database) => {
    await runReadwrite(database, ["reviewEvents"], (transaction) => {
      putReviewEventInTransaction(transaction, reviewEvent);
      return null;
    });
  });
}
