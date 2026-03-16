import type {
  Card,
  Deck,
  DeckCardStats,
  DecksListSnapshot,
} from "../types";
import {
  isCardDue,
  isCardNew,
  isCardReviewed,
  matchesDeckFilterDefinition,
} from "../appData/domain";
import { iterateCardsByCreatedAtDesc } from "./cards";
import {
  closeDatabaseAfter,
  closeDatabaseAfterWrite,
  describeIndexedDbError,
  getFromStore,
  runReadwrite,
} from "./core";

type DeckStatsAccumulator = Readonly<{
  totalCards: number;
  dueCards: number;
  newCards: number;
  reviewedCards: number;
}>;

async function iterateDecksByCreatedAtDesc(
  database: IDBDatabase,
  workspaceId: string,
  onDeck: (deck: Deck) => boolean | void,
): Promise<void> {
  return new Promise((resolve, reject) => {
    const transaction = database.transaction(["decks"], "readonly");
    const decksStore = transaction.objectStore("decks");
    const request = decksStore.index("workspaceId_createdAt_deckId").openCursor(null, "prev");
    let isResolved = false;

    const finish = (): void => {
      if (isResolved) {
        return;
      }

      isResolved = true;
      resolve();
    };

    request.onerror = () => {
      reject(describeIndexedDbError("IndexedDB deck iteration failed", request.error));
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

      const deck = cursor.value as Deck;
      if (deck.workspaceId !== workspaceId) {
        cursor.continue();
        return;
      }

      const shouldContinue = onDeck(deck);
      if (shouldContinue === false) {
        finish();
        return;
      }

      cursor.continue();
    };
  });
}

export async function loadDeckRecord(database: IDBDatabase, workspaceId: string, deckId: string): Promise<Deck | null> {
  const deck = await getFromStore<Deck>(database, "decks", [workspaceId, deckId]);
  if (deck === undefined || deck.deletedAt !== null) {
    return null;
  }

  return deck;
}

function emptyDeckStatsAccumulator(): DeckStatsAccumulator {
  return {
    totalCards: 0,
    dueCards: 0,
    newCards: 0,
    reviewedCards: 0,
  };
}

function appendCardToDeckStats(
  stats: DeckStatsAccumulator,
  card: Card,
  nowTimestamp: number,
): DeckStatsAccumulator {
  return {
    totalCards: stats.totalCards + 1,
    dueCards: stats.dueCards + (isCardDue(card, nowTimestamp) ? 1 : 0),
    newCards: stats.newCards + (isCardNew(card) ? 1 : 0),
    reviewedCards: stats.reviewedCards + (isCardReviewed(card) ? 1 : 0),
  };
}

function toDeckCardStats(stats: DeckStatsAccumulator): DeckCardStats {
  return {
    totalCards: stats.totalCards,
    dueCards: stats.dueCards,
    newCards: stats.newCards,
    reviewedCards: stats.reviewedCards,
  };
}

function deleteWorkspaceDecks(
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

export async function loadActiveDecksWithDatabase(database: IDBDatabase, workspaceId: string): Promise<ReadonlyArray<Deck>> {
  const decks: Array<Deck> = [];
  await iterateDecksByCreatedAtDesc(database, workspaceId, (deck) => {
    if (deck.deletedAt === null) {
      decks.push(deck);
    }
    return true;
  });
  return decks;
}

export async function loadAllActiveDecksForSql(workspaceId: string): Promise<ReadonlyArray<Deck>> {
  return closeDatabaseAfter((database) => loadActiveDecksWithDatabase(database, workspaceId));
}

export async function loadDecksListSnapshot(workspaceId: string): Promise<DecksListSnapshot> {
  return closeDatabaseAfter(async (database) => {
    const nowTimestamp = Date.now();
    const decks = await loadActiveDecksWithDatabase(database, workspaceId);
    let allCardsStats = emptyDeckStatsAccumulator();
    const deckStatsById = new Map<string, DeckStatsAccumulator>(
      decks.map((deck) => [deck.deckId, emptyDeckStatsAccumulator()] as const),
    );

    await iterateCardsByCreatedAtDesc(database, workspaceId, (card) => {
      if (card.deletedAt !== null) {
        return true;
      }

      allCardsStats = appendCardToDeckStats(allCardsStats, card, nowTimestamp);
      for (const deck of decks) {
        if (matchesDeckFilterDefinition(deck.filterDefinition, card) === false) {
          continue;
        }

        const currentStats = deckStatsById.get(deck.deckId);
        if (currentStats === undefined) {
          throw new Error(`Deck stats accumulator is missing: ${deck.deckId}`);
        }
        deckStatsById.set(deck.deckId, appendCardToDeckStats(currentStats, card, nowTimestamp));
      }
      return true;
    });

    return {
      allCardsStats: toDeckCardStats(allCardsStats),
      deckSummaries: decks.map((deck) => {
        const stats = deckStatsById.get(deck.deckId);
        if (stats === undefined) {
          throw new Error(`Deck stats accumulator is missing: ${deck.deckId}`);
        }

        return {
          deckId: deck.deckId,
          name: deck.name,
          filterDefinition: deck.filterDefinition,
          createdAt: deck.createdAt,
          totalCards: stats.totalCards,
          dueCards: stats.dueCards,
          newCards: stats.newCards,
          reviewedCards: stats.reviewedCards,
        };
      }),
    };
  });
}

export async function loadDeckById(workspaceId: string, deckId: string): Promise<Deck | null> {
  return closeDatabaseAfter((database) => loadDeckRecord(database, workspaceId, deckId));
}

export async function replaceDecks(workspaceId: string, decks: ReadonlyArray<Deck>): Promise<void> {
  await closeDatabaseAfterWrite(async (database) => {
    await runReadwrite(database, ["decks"], (transaction) => deleteWorkspaceDecks(transaction.objectStore("decks"), workspaceId));

    await runReadwrite(database, ["decks"], (transaction) => {
      const store = transaction.objectStore("decks");
      for (const deck of decks) {
        store.put(deck);
      }
      return null;
    });
  });
}

export async function putDeck(deck: Deck): Promise<void> {
  await closeDatabaseAfterWrite(async (database) => {
    await runReadwrite(database, ["decks"], (transaction) => transaction.objectStore("decks").put(deck));
  });
}
