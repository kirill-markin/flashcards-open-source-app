import type { Card } from "../types";
import { describeIndexedDbError } from "./core";

export type CardTagRecord = Readonly<{
  cardId: string;
  tag: string;
}>;

function putCardTags(cardTagsStore: IDBObjectStore, card: Card): void {
  if (card.deletedAt !== null) {
    return;
  }

  for (const tag of card.tags) {
    if (tag === "") {
      continue;
    }

    cardTagsStore.put({
      cardId: card.cardId,
      tag,
    } satisfies CardTagRecord);
  }
}

export function writeCardTagRecords(transaction: IDBTransaction, card: Card): void {
  const cardTagsStore = transaction.objectStore("cardTags");
  const existingIndex = cardTagsStore.index("cardId_tag");
  const range = IDBKeyRange.bound(
    [card.cardId, ""],
    [card.cardId, "\uffff"],
  );
  existingIndex.openKeyCursor(range).onsuccess = (event) => {
    const cursor = (event.target as IDBRequest<IDBCursor | null>).result;
    if (cursor === null) {
      putCardTags(cardTagsStore, card);
      return;
    }

    cardTagsStore.delete(cursor.primaryKey);
    cursor.continue();
  };
}

export function putCardTagRecords(cardTagsStore: IDBObjectStore, card: Card): void {
  putCardTags(cardTagsStore, card);
}

export async function iterateCardTagsByTag(
  database: IDBDatabase,
  tag: string,
  onRecord: (record: CardTagRecord) => boolean | void,
): Promise<void> {
  return new Promise((resolve, reject) => {
    const transaction = database.transaction(["cardTags"], "readonly");
    const cardTagsStore = transaction.objectStore("cardTags");
    const request = cardTagsStore.index("tag_cardId").openCursor(
      IDBKeyRange.bound(
        [tag, ""],
        [tag, "\uffff"],
      ),
      "next",
    );
    let isResolved = false;

    const finish = (): void => {
      if (isResolved) {
        return;
      }

      isResolved = true;
      resolve();
    };

    request.onerror = () => {
      reject(describeIndexedDbError("IndexedDB card tag iteration failed", request.error));
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

      const shouldContinue = onRecord(cursor.value as CardTagRecord);
      if (shouldContinue === false) {
        finish();
        return;
      }

      cursor.continue();
    };
  });
}

export async function iterateAllCardTags(
  database: IDBDatabase,
  onRecord: (record: CardTagRecord) => boolean | void,
): Promise<void> {
  return new Promise((resolve, reject) => {
    const transaction = database.transaction(["cardTags"], "readonly");
    const cardTagsStore = transaction.objectStore("cardTags");
    const request = cardTagsStore.index("tag_cardId").openCursor(null, "next");
    let isResolved = false;

    const finish = (): void => {
      if (isResolved) {
        return;
      }

      isResolved = true;
      resolve();
    };

    request.onerror = () => {
      reject(describeIndexedDbError("IndexedDB card tag iteration failed", request.error));
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

      const shouldContinue = onRecord(cursor.value as CardTagRecord);
      if (shouldContinue === false) {
        finish();
        return;
      }

      cursor.continue();
    };
  });
}

export async function loadAllowedCardIdsForTags(
  database: IDBDatabase,
  tags: ReadonlyArray<string>,
): Promise<ReadonlySet<string>> {
  const allowedCardIds = new Set<string>();

  for (const tag of tags) {
    await iterateCardTagsByTag(database, tag, (record) => {
      allowedCardIds.add(record.cardId);
      return true;
    });
  }

  return allowedCardIds;
}
