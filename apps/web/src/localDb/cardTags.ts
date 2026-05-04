import type { Card } from "../types";
import { normalizeTagKey } from "../appData/domain";
import { describeIndexedDbError } from "./core";

export type CardTagRecord = Readonly<{
  workspaceId: string;
  cardId: string;
  tag: string;
}>;

export type TagCardIdsLookup = Readonly<{
  cardIds: ReadonlySet<string>;
  canonicalTag: string | null;
}>;

function putCardTags(cardTagsStore: IDBObjectStore, workspaceId: string, card: Card): void {
  if (card.deletedAt !== null) {
    return;
  }

  for (const tag of card.tags) {
    if (tag === "") {
      continue;
    }

    cardTagsStore.put({
      workspaceId,
      cardId: card.cardId,
      tag,
    } satisfies CardTagRecord);
  }
}

export function writeCardTagRecords(transaction: IDBTransaction, workspaceId: string, card: Card): void {
  const cardTagsStore = transaction.objectStore("cardTags");
  const existingIndex = cardTagsStore.index("workspaceId_cardId_tag");
  const range = IDBKeyRange.bound(
    [workspaceId, card.cardId, ""],
    [workspaceId, card.cardId, "\uffff"],
  );
  existingIndex.openKeyCursor(range).onsuccess = (event) => {
    const cursor = (event.target as IDBRequest<IDBCursor | null>).result;
    if (cursor === null) {
      putCardTags(cardTagsStore, workspaceId, card);
      return;
    }

    cardTagsStore.delete(cursor.primaryKey);
    cursor.continue();
  };
}

export function putCardTagRecords(cardTagsStore: IDBObjectStore, workspaceId: string, card: Card): void {
  putCardTags(cardTagsStore, workspaceId, card);
}

export async function iterateCardTagsByTag(
  database: IDBDatabase,
  workspaceId: string,
  tag: string,
  onRecord: (record: CardTagRecord) => boolean | void,
): Promise<void> {
  const requestedTagKey = normalizeTagKey(tag);
  return new Promise((resolve, reject) => {
    const transaction = database.transaction(["cardTags"], "readonly");
    const cardTagsStore = transaction.objectStore("cardTags");
    const request = cardTagsStore.index("workspaceId_tag_cardId").openCursor(null, "next");
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

      const record = cursor.value as CardTagRecord;
      if (record.workspaceId !== workspaceId || normalizeTagKey(record.tag) !== requestedTagKey) {
        cursor.continue();
        return;
      }

      const shouldContinue = onRecord(record);
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
  workspaceId: string,
  onRecord: (record: CardTagRecord) => boolean | void,
): Promise<void> {
  return new Promise((resolve, reject) => {
    const transaction = database.transaction(["cardTags"], "readonly");
    const cardTagsStore = transaction.objectStore("cardTags");
    const request = cardTagsStore.index("workspaceId_tag_cardId").openCursor(null, "next");
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

      const record = cursor.value as CardTagRecord;
      if (record.workspaceId !== workspaceId) {
        cursor.continue();
        return;
      }

      const shouldContinue = onRecord(record);
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
  workspaceId: string,
  tags: ReadonlyArray<string>,
): Promise<ReadonlySet<string>> {
  const allowedCardIds = new Set<string>();
  const requestedTagKeys = new Set(tags.map((tag) => normalizeTagKey(tag)).filter((tagKey) => tagKey !== ""));
  if (requestedTagKeys.size === 0) {
    return allowedCardIds;
  }

  await iterateAllCardTags(database, workspaceId, (record) => {
    if (requestedTagKeys.has(normalizeTagKey(record.tag))) {
      allowedCardIds.add(record.cardId);
    }

    return true;
  });

  return allowedCardIds;
}

export async function loadAllowedCardIdsForTag(
  database: IDBDatabase,
  workspaceId: string,
  tag: string,
): Promise<TagCardIdsLookup> {
  const allowedCardIds = new Set<string>();
  const requestedTagKey = normalizeTagKey(tag);
  if (requestedTagKey === "") {
    return {
      cardIds: allowedCardIds,
      canonicalTag: null,
    };
  }

  let canonicalTag: string | null = null;
  await iterateAllCardTags(database, workspaceId, (record) => {
    if (normalizeTagKey(record.tag) !== requestedTagKey) {
      return true;
    }

    allowedCardIds.add(record.cardId);
    canonicalTag = canonicalTag ?? record.tag.trim();
    return true;
  });

  return {
    cardIds: allowedCardIds,
    canonicalTag,
  };
}
