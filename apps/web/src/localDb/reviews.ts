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
  recentDuePriorityWindow,
} from "../appData/domain";
import { loadAllowedCardIdsForTags } from "./cardTags";
import {
  iterateCardsByCreatedAtDesc,
  iterateCardsByDueAtAsc,
  iterateCardsByDueAtAscAfter,
  iterateCardsByDueAtAscBefore,
  iterateCardsByDueAtAscBetweenInclusive,
} from "./cards";
import {
  closeDatabaseAfter,
  closeDatabaseAfterWrite,
  getAllFromStore,
  getFromStore,
  runReadonly,
  runReadwrite,
  type ProgressDailyCountRecord,
} from "./core";
import { loadDeckRecord } from "./decks";
import {
  loadLocalProgressDailyReviews,
  loadLocalProgressSummary,
  loadProgressCacheState,
  loadPendingProgressDailyReviews,
  mapReviewedAtClientToLocalDate,
  markProgressCacheDirtyInTransaction,
} from "./progress";
import { decodeCursor, encodeCursor } from "./queryShared";

type ReviewFilterResolution = Readonly<{
  resolvedReviewFilter: ReviewFilter;
  deck: Deck | null;
  allowedTagCardIds: ReadonlySet<string> | null;
}>;

type ReviewCardCursorIterator = (
  database: IDBDatabase,
  workspaceId: string,
  onCard: (card: Card) => boolean | void,
) => Promise<void>;

type DueAtBucketPredicate = (dueAtTimestamp: number, nowTimestamp: number) => boolean;

type ReviewQueueCursorState = Readonly<{
  cardId: string;
  asOfTimestamp: number;
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

function toIsoTimestamp(timestamp: number): string {
  return new Date(timestamp).toISOString();
}

function toIsoSecondPrefix(timestamp: number): string {
  return toIsoTimestamp(timestamp).slice(0, 19);
}

function toIsoSecondUpperBound(timestamp: number): string {
  // IndexedDB compares dueAt as text, so include non-canonical forms that parse inside the same UTC second.
  return `${toIsoSecondPrefix(timestamp)}\uffff`;
}

function makeDueAtSecondGroupKey(dueAt: string): string {
  return dueAt.slice(0, 19);
}

function isRecentDueTimestamp(dueAtTimestamp: number, nowTimestamp: number): boolean {
  return dueAtTimestamp >= nowTimestamp - recentDuePriorityWindow && dueAtTimestamp <= nowTimestamp;
}

function isOldDueTimestamp(dueAtTimestamp: number, nowTimestamp: number): boolean {
  return dueAtTimestamp < nowTimestamp - recentDuePriorityWindow;
}

function isFutureDueTimestamp(dueAtTimestamp: number, nowTimestamp: number): boolean {
  return dueAtTimestamp > nowTimestamp;
}

async function iterateTimedReviewCardsByDueAt(
  database: IDBDatabase,
  workspaceId: string,
  nowTimestamp: number,
  cursorIterator: ReviewCardCursorIterator,
  matchesBucket: DueAtBucketPredicate,
  onCard: (card: Card) => boolean | void,
): Promise<boolean> {
  let shouldStop = false;
  let currentDueAtSecondGroupKey: string | null | undefined;
  let currentDueGroup: Array<Card> = [];

  function flushCurrentDueGroup(): boolean {
    const sortedGroup = [...currentDueGroup].sort(
      (leftCard, rightCard) => compareCardsForReviewOrder(leftCard, rightCard, nowTimestamp),
    );
    currentDueGroup = [];

    for (const card of sortedGroup) {
      if (onCard(card) === false) {
        shouldStop = true;
        return false;
      }
    }

    return true;
  }

  await cursorIterator(database, workspaceId, (card) => {
    if (shouldStop) {
      return false;
    }

    if (card.deletedAt !== null || card.dueAt === null) {
      return true;
    }

    const dueAtTimestamp = new Date(card.dueAt).getTime();
    if (Number.isNaN(dueAtTimestamp) || matchesBucket(dueAtTimestamp, nowTimestamp) === false) {
      return true;
    }

    const dueAtSecondGroupKey = makeDueAtSecondGroupKey(card.dueAt);
    if (currentDueAtSecondGroupKey === undefined) {
      currentDueAtSecondGroupKey = dueAtSecondGroupKey;
      currentDueGroup = [card];
      return true;
    }

    if (currentDueAtSecondGroupKey === dueAtSecondGroupKey) {
      currentDueGroup = [...currentDueGroup, card];
      return true;
    }

    if (flushCurrentDueGroup() === false) {
      return false;
    }

    currentDueAtSecondGroupKey = dueAtSecondGroupKey;
    currentDueGroup = [card];
    return true;
  });

  if (shouldStop) {
    return false;
  }

  if (currentDueGroup.length > 0) {
    if (flushCurrentDueGroup() === false) {
      return false;
    }
  }

  return true;
}

async function iterateNullDueReviewCards(
  database: IDBDatabase,
  workspaceId: string,
  onCard: (card: Card) => boolean | void,
): Promise<boolean> {
  let shouldStop = false;
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

  return shouldStop === false;
}

async function iterateMalformedDueAtReviewCards(
  database: IDBDatabase,
  workspaceId: string,
  nowTimestamp: number,
  onCard: (card: Card) => boolean | void,
): Promise<boolean> {
  const malformedCards: Array<Card> = [];

  await iterateCardsByDueAtAsc(database, workspaceId, (card) => {
    if (card.deletedAt !== null || card.dueAt === null) {
      return true;
    }

    const dueAtTimestamp = new Date(card.dueAt).getTime();
    if (Number.isNaN(dueAtTimestamp)) {
      malformedCards.push(card);
    }

    return true;
  });

  const sortedMalformedCards = [...malformedCards].sort(
    (leftCard, rightCard) => compareCardsForReviewOrder(leftCard, rightCard, nowTimestamp),
  );
  for (const card of sortedMalformedCards) {
    if (onCard(card) === false) {
      return false;
    }
  }

  return true;
}

async function iterateActiveReviewCardsInCanonicalOrder(
  database: IDBDatabase,
  workspaceId: string,
  nowTimestamp: number,
  onCard: (card: Card) => boolean | void,
): Promise<boolean> {
  const recentDueCutoffTimestamp = nowTimestamp - recentDuePriorityWindow;
  const recentDueCutoffLowerBound = toIsoSecondPrefix(recentDueCutoffTimestamp);
  const recentDueCutoffUpperBound = toIsoSecondUpperBound(recentDueCutoffTimestamp);
  const nowUpperBound = toIsoSecondUpperBound(nowTimestamp);

  const didFinishRecentDueCards = await iterateTimedReviewCardsByDueAt(
    database,
    workspaceId,
    nowTimestamp,
    (cursorDatabase, cursorWorkspaceId, cursorOnCard) => iterateCardsByDueAtAscBetweenInclusive(
      cursorDatabase,
      cursorWorkspaceId,
      recentDueCutoffLowerBound,
      nowUpperBound,
      cursorOnCard,
    ),
    isRecentDueTimestamp,
    onCard,
  );
  if (didFinishRecentDueCards === false) {
    return false;
  }

  const didFinishOldDueCards = await iterateTimedReviewCardsByDueAt(
    database,
    workspaceId,
    nowTimestamp,
    (cursorDatabase, cursorWorkspaceId, cursorOnCard) => iterateCardsByDueAtAscBefore(
      cursorDatabase,
      cursorWorkspaceId,
      recentDueCutoffUpperBound,
      cursorOnCard,
    ),
    isOldDueTimestamp,
    onCard,
  );
  if (didFinishOldDueCards === false) {
    return false;
  }

  return iterateNullDueReviewCards(database, workspaceId, onCard);
}

async function iterateReviewCardsInCanonicalOrder(
  database: IDBDatabase,
  workspaceId: string,
  nowTimestamp: number,
  onCard: (card: Card) => boolean | void,
): Promise<void> {
  const didFinishActiveCards = await iterateActiveReviewCardsInCanonicalOrder(database, workspaceId, nowTimestamp, onCard);
  if (didFinishActiveCards === false) {
    return;
  }

  const nowIso = toIsoTimestamp(nowTimestamp);
  const didFinishFutureCards = await iterateTimedReviewCardsByDueAt(
    database,
    workspaceId,
    nowTimestamp,
    (cursorDatabase, cursorWorkspaceId, cursorOnCard) => iterateCardsByDueAtAscAfter(
      cursorDatabase,
      cursorWorkspaceId,
      nowIso,
      cursorOnCard,
    ),
    isFutureDueTimestamp,
    onCard,
  );
  if (didFinishFutureCards === false) {
    return;
  }

  await iterateMalformedDueAtReviewCards(database, workspaceId, nowTimestamp, onCard);
}

async function makeReviewCountsFromIndexedDb(
  database: IDBDatabase,
  workspaceId: string,
  filterResolution: ReviewFilterResolution,
  nowTimestamp: number,
): Promise<ReviewCounts> {
  let reviewCounts: ReviewCounts = {
    dueCount: 0,
    totalCount: 0,
  };

  await iterateCardsByCreatedAtDesc(database, workspaceId, (card) => {
    if (card.deletedAt !== null || matchesResolvedReviewFilter(card, filterResolution) === false) {
      return true;
    }

    reviewCounts = {
      dueCount: reviewCounts.dueCount + (isCardDue(card, nowTimestamp) ? 1 : 0),
      totalCount: reviewCounts.totalCount + 1,
    };
    return true;
  });

  return reviewCounts;
}

async function loadActiveReviewQueuePage(
  database: IDBDatabase,
  workspaceId: string,
  filterResolution: ReviewFilterResolution,
  nowTimestamp: number,
  cursorState: ReviewQueueCursorState | null,
  limit: number,
  excludedCardIds: ReadonlySet<string>,
): Promise<Readonly<{ cards: ReadonlyArray<Card>; nextCursor: string | null }>> {
  const cursorPredicate = makeReviewCursorCardIdPredicate(cursorState);
  let hasReachedCursor = cursorPredicate.isSet === false;
  let pageCards: Array<Card> = [];
  let hasMoreCards = false;

  await iterateActiveReviewCardsInCanonicalOrder(database, workspaceId, nowTimestamp, (card) => {
    if (matchesResolvedReviewFilter(card, filterResolution) === false) {
      return true;
    }

    if (hasReachedCursor === false) {
      if (cursorPredicate.matches(card.cardId)) {
        hasReachedCursor = true;
      }
      return true;
    }

    if (excludedCardIds.has(card.cardId)) {
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
      ? encodeReviewQueueCursor(pageCards[pageCards.length - 1]?.cardId ?? "", nowTimestamp)
      : null,
  };
}

function encodeReviewQueueCursor(cardId: string, asOfTimestamp: number): string {
  if (cardId === "") {
    throw new Error("Review queue cursor cannot be built without a card id");
  }

  return encodeCursor({ cardId, asOfTimestamp });
}

function decodeReviewQueueCursor(cursor: string): ReviewQueueCursorState {
  const parsedCursor = decodeCursor(cursor);
  const cardId = parsedCursor.cardId;
  if (typeof cardId !== "string" || cardId === "") {
    throw new Error("review cursor.cardId must be a non-empty string");
  }

  const asOfTimestamp = parsedCursor.asOfTimestamp;
  if (typeof asOfTimestamp !== "number" || Number.isFinite(asOfTimestamp) === false) {
    throw new Error("review cursor.asOfTimestamp must be a finite number");
  }

  return {
    cardId,
    asOfTimestamp,
  };
}

function makeReviewCursorCardIdPredicate(cursorState: ReviewQueueCursorState | null): Readonly<{
  matches: (cardId: string) => boolean;
  isSet: boolean;
}> {
  if (cursorState === null) {
    return {
      matches: () => false,
      isSet: false,
    };
  }

  return {
    matches: (candidateCardId) => candidateCardId === cursorState.cardId,
    isSet: true,
  };
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

export { loadLocalProgressDailyReviews, loadLocalProgressSummary, loadPendingProgressDailyReviews };

export async function loadReviewQueueSnapshot(
  workspaceId: string,
  reviewFilter: ReviewFilter,
  limit: number,
): Promise<ReviewQueueSnapshot> {
  return closeDatabaseAfter(async (database) => {
    const nowTimestamp = Date.now();
    const filterResolution = await resolveReviewFilterFromIndexedDb(database, workspaceId, reviewFilter);
    const [queuePage, reviewCounts] = await Promise.all([
      loadActiveReviewQueuePage(
        database,
        workspaceId,
        filterResolution,
        nowTimestamp,
        null,
        limit,
        new Set<string>(),
      ),
      makeReviewCountsFromIndexedDb(database, workspaceId, filterResolution, nowTimestamp),
    ]);

    return {
      resolvedReviewFilter: filterResolution.resolvedReviewFilter,
      cards: queuePage.cards,
      nextCursor: queuePage.nextCursor,
      reviewCounts,
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
    const cursorState = cursor === null ? null : decodeReviewQueueCursor(cursor);
    const nowTimestamp = cursorState === null ? Date.now() : cursorState.asOfTimestamp;
    const filterResolution = await resolveReviewFilterFromIndexedDb(database, workspaceId, reviewFilter);
    return loadActiveReviewQueuePage(
      database,
      workspaceId,
      filterResolution,
      nowTimestamp,
      cursorState,
      limit,
      excludedCardIds,
    );
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
    const progressCacheState = await loadProgressCacheState(database);

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

    if (progressCacheState !== null) {
      await runReadwrite(database, ["meta"], (transaction) => {
        markProgressCacheDirtyInTransaction(transaction, progressCacheState.timeZone);
        return null;
      });
    }
  });
}

export function putReviewEventInTransaction(transaction: IDBTransaction, reviewEvent: ReviewEvent): void {
  transaction.objectStore("reviewEvents").put(reviewEvent);
}

export async function putReviewEvent(reviewEvent: ReviewEvent): Promise<void> {
  await closeDatabaseAfterWrite(async (database) => {
    const progressCacheState = await loadProgressCacheState(database);
    const existingReviewEvent = await getFromStore<ReviewEvent>(
      database,
      "reviewEvents",
      [reviewEvent.workspaceId, reviewEvent.reviewEventId],
    );

    if (progressCacheState === null) {
      await runReadwrite(database, ["reviewEvents"], (transaction) => {
        putReviewEventInTransaction(transaction, reviewEvent);
        return null;
      });
      return;
    }

    if (progressCacheState.needsRebuild || existingReviewEvent !== undefined) {
      await runReadwrite(database, ["reviewEvents", "meta"], (transaction) => {
        putReviewEventInTransaction(transaction, reviewEvent);
        markProgressCacheDirtyInTransaction(transaction, progressCacheState.timeZone);
        return null;
      });
      return;
    }

    const localDate = mapReviewedAtClientToLocalDate(reviewEvent.reviewedAtClient, progressCacheState.timeZone);
    const existingProgressDailyCount = await getFromStore<ProgressDailyCountRecord>(
      database,
      "progressDailyCounts",
      [reviewEvent.workspaceId, localDate],
    );

    await runReadwrite(database, ["reviewEvents", "progressDailyCounts"], (transaction) => {
      putReviewEventInTransaction(transaction, reviewEvent);
      transaction.objectStore("progressDailyCounts").put({
        workspaceId: reviewEvent.workspaceId,
        localDate,
        reviewCount: (existingProgressDailyCount?.reviewCount ?? 0) + 1,
      });
      return null;
    });
  });
}
