import type { Card } from "../../../types";
import { normalizeTag, normalizeTagKey } from "../../../appData/domain";
import { describeIndexedDbError } from "../../core/database";

export type CardTagRecord = Readonly<{
  workspaceId: string;
  cardId: string;
  tag: string;
}>;

export type TagCardIdsLookup = Readonly<{
  cardIds: ReadonlySet<string>;
  canonicalTag: string | null;
}>;

export type ReviewTagFilterLookup = Readonly<{
  cardIds: ReadonlySet<string>;
  canonicalTags: ReadonlyArray<string>;
  availableTagKeys: ReadonlySet<string>;
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
  return (await loadReviewTagFilterLookupForTags(database, workspaceId, tags)).cardIds;
}

export async function loadReviewTagFilterLookupForTags(
  database: IDBDatabase,
  workspaceId: string,
  tags: ReadonlyArray<string>,
): Promise<ReviewTagFilterLookup> {
  const allowedCardIds = new Set<string>();
  const requestedTagKeys = new Set(tags.map((tag) => normalizeTagKey(tag)).filter((tagKey) => tagKey !== ""));
  const canonicalTagsByKey = new Map<string, string>();
  const availableTagKeys = new Set<string>();
  await iterateAllCardTags(database, workspaceId, (record) => {
    const tagKey = normalizeTagKey(record.tag);
    if (tagKey !== "") {
      availableTagKeys.add(tagKey);
    }

    if (requestedTagKeys.has(tagKey) === false) {
      return true;
    }

    allowedCardIds.add(record.cardId);
    if (canonicalTagsByKey.has(tagKey) === false) {
      canonicalTagsByKey.set(tagKey, normalizeTag(record.tag));
    }

    return true;
  });

  return {
    cardIds: allowedCardIds,
    canonicalTags: [...canonicalTagsByKey.entries()]
      .sort(([leftKey], [rightKey]) => leftKey.localeCompare(rightKey))
      .map(([, tag]) => tag),
    availableTagKeys,
  };
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
    canonicalTag = canonicalTag ?? normalizeTag(record.tag);
    return true;
  });

  return {
    cardIds: allowedCardIds,
    canonicalTag,
  };
}
