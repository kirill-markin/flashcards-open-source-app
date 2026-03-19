import type { Card, EffortLevel, ReviewCounts, ReviewFilter } from "../types";

const SNAPSHOT_VERSION = 1;
const REVIEW_LOADING_SNAPSHOT_KEY_PREFIX = "flashcards-review-loading-snapshot";
const CARDS_LOADING_SNAPSHOT_KEY_PREFIX = "flashcards-cards-loading-snapshot";

type ReviewLoadingCardPreview = Readonly<{
  cardId: string;
  frontText: string;
  tags: ReadonlyArray<string>;
  effortLevel: EffortLevel;
  dueAt: string | null;
}>;

export type ReviewLoadingSnapshot = Readonly<{
  version: 1;
  workspaceId: string;
  selectedReviewFilterKey: string;
  resolvedReviewFilterTitle: string;
  reviewCounts: ReviewCounts;
  currentCard: ReviewLoadingCardPreview | null;
  queuePreview: ReadonlyArray<ReviewLoadingCardPreview>;
  savedAt: string;
}>;

export type CardsLoadingRowPreview = Readonly<{
  cardId: string;
  frontText: string;
  backText: string;
  tags: ReadonlyArray<string>;
  effortLevel: EffortLevel;
  dueAt: string | null;
  reps: number;
  lapses: number;
  createdAt: string;
}>;

export type CardsLoadingSnapshot = Readonly<{
  version: 1;
  workspaceId: string;
  totalCount: number;
  rows: ReadonlyArray<CardsLoadingRowPreview>;
  savedAt: string;
}>;

type LocalStorageLike = Storage & Record<string, string | undefined> & Readonly<{
  getItem?: (key: string) => string | null;
  setItem?: (key: string, value: string) => void;
}>;

const fallbackLocalStorageState = new Map<string, string>();

function buildReviewLoadingSnapshotStorageKey(
  workspaceId: string,
  selectedReviewFilterKey: string,
): string {
  return `${REVIEW_LOADING_SNAPSHOT_KEY_PREFIX}:${workspaceId}:${selectedReviewFilterKey}`;
}

function buildCardsLoadingSnapshotStorageKey(workspaceId: string): string {
  return `${CARDS_LOADING_SNAPSHOT_KEY_PREFIX}:${workspaceId}`;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function isStringArray(value: unknown): value is Array<string> {
  return Array.isArray(value) && value.every((item) => typeof item === "string");
}

function readLocalStorageValue(key: string): string | null {
  const storage = window.localStorage as LocalStorageLike;
  if (typeof storage.getItem === "function") {
    return storage.getItem(key);
  }

  return fallbackLocalStorageState.get(key) ?? null;
}

function writeLocalStorageValue(key: string, value: string): void {
  const storage = window.localStorage as LocalStorageLike;
  if (typeof storage.setItem === "function") {
    storage.setItem(key, value);
    return;
  }

  fallbackLocalStorageState.set(key, value);
}

export function clearLoadingSnapshotFallbackStorage(): void {
  fallbackLocalStorageState.clear();
}

function parseReviewCounts(value: unknown): ReviewCounts | null {
  if (!isRecord(value) || typeof value.dueCount !== "number" || typeof value.totalCount !== "number") {
    return null;
  }

  return {
    dueCount: value.dueCount,
    totalCount: value.totalCount,
  };
}

function parseReviewLoadingCardPreview(value: unknown): ReviewLoadingCardPreview | null {
  if (
    !isRecord(value)
    || typeof value.cardId !== "string"
    || typeof value.frontText !== "string"
    || !isStringArray(value.tags)
    || (value.effortLevel !== "fast" && value.effortLevel !== "medium" && value.effortLevel !== "long")
    || (value.dueAt !== null && typeof value.dueAt !== "string")
  ) {
    return null;
  }

  return {
    cardId: value.cardId,
    frontText: value.frontText,
    tags: value.tags,
    effortLevel: value.effortLevel,
    dueAt: value.dueAt,
  };
}

function parseCardsLoadingRowPreview(value: unknown): CardsLoadingRowPreview | null {
  if (
    !isRecord(value)
    || typeof value.cardId !== "string"
    || typeof value.frontText !== "string"
    || typeof value.backText !== "string"
    || !isStringArray(value.tags)
    || (value.effortLevel !== "fast" && value.effortLevel !== "medium" && value.effortLevel !== "long")
    || (value.dueAt !== null && typeof value.dueAt !== "string")
    || typeof value.reps !== "number"
    || typeof value.lapses !== "number"
    || typeof value.createdAt !== "string"
  ) {
    return null;
  }

  return {
    cardId: value.cardId,
    frontText: value.frontText,
    backText: value.backText,
    tags: value.tags,
    effortLevel: value.effortLevel,
    dueAt: value.dueAt,
    reps: value.reps,
    lapses: value.lapses,
    createdAt: value.createdAt,
  };
}

function parseReviewLoadingSnapshot(
  rawValue: string | null,
): ReviewLoadingSnapshot | null {
  if (rawValue === null) {
    return null;
  }

  try {
    const parsedValue = JSON.parse(rawValue) as unknown;
    if (
      !isRecord(parsedValue)
      || parsedValue.version !== SNAPSHOT_VERSION
      || typeof parsedValue.workspaceId !== "string"
      || typeof parsedValue.selectedReviewFilterKey !== "string"
      || typeof parsedValue.resolvedReviewFilterTitle !== "string"
      || typeof parsedValue.savedAt !== "string"
      || !Array.isArray(parsedValue.queuePreview)
    ) {
      return null;
    }

    const reviewCounts = parseReviewCounts(parsedValue.reviewCounts);
    if (reviewCounts === null) {
      return null;
    }

    const currentCard = parsedValue.currentCard === null
      ? null
      : parseReviewLoadingCardPreview(parsedValue.currentCard);
    if (parsedValue.currentCard !== null && currentCard === null) {
      return null;
    }

    const queuePreview = parsedValue.queuePreview
      .map((item) => parseReviewLoadingCardPreview(item))
      .filter((item): item is ReviewLoadingCardPreview => item !== null);
    if (queuePreview.length !== parsedValue.queuePreview.length) {
      return null;
    }

    return {
      version: 1,
      workspaceId: parsedValue.workspaceId,
      selectedReviewFilterKey: parsedValue.selectedReviewFilterKey,
      resolvedReviewFilterTitle: parsedValue.resolvedReviewFilterTitle,
      reviewCounts,
      currentCard,
      queuePreview,
      savedAt: parsedValue.savedAt,
    };
  } catch {
    return null;
  }
}

function parseCardsLoadingSnapshot(rawValue: string | null): CardsLoadingSnapshot | null {
  if (rawValue === null) {
    return null;
  }

  try {
    const parsedValue = JSON.parse(rawValue) as unknown;
    if (
      !isRecord(parsedValue)
      || parsedValue.version !== SNAPSHOT_VERSION
      || typeof parsedValue.workspaceId !== "string"
      || typeof parsedValue.totalCount !== "number"
      || typeof parsedValue.savedAt !== "string"
      || !Array.isArray(parsedValue.rows)
    ) {
      return null;
    }

    const rows = parsedValue.rows
      .map((item) => parseCardsLoadingRowPreview(item))
      .filter((item): item is CardsLoadingRowPreview => item !== null);
    if (rows.length !== parsedValue.rows.length) {
      return null;
    }

    return {
      version: 1,
      workspaceId: parsedValue.workspaceId,
      totalCount: parsedValue.totalCount,
      rows,
      savedAt: parsedValue.savedAt,
    };
  } catch {
    return null;
  }
}

export function serializeReviewFilterKey(reviewFilter: ReviewFilter): string {
  if (reviewFilter.kind === "allCards") {
    return "allCards";
  }

  if (reviewFilter.kind === "deck") {
    return `deck:${reviewFilter.deckId}`;
  }

  return `tag:${reviewFilter.tag}`;
}

export function buildReviewLoadingCardPreview(card: Card): ReviewLoadingCardPreview {
  return {
    cardId: card.cardId,
    frontText: card.frontText,
    tags: card.tags,
    effortLevel: card.effortLevel,
    dueAt: card.dueAt,
  };
}

export function buildCardsLoadingRowPreview(card: Card): CardsLoadingRowPreview {
  return {
    cardId: card.cardId,
    frontText: card.frontText,
    backText: card.backText,
    tags: card.tags,
    effortLevel: card.effortLevel,
    dueAt: card.dueAt,
    reps: card.reps,
    lapses: card.lapses,
    createdAt: card.createdAt,
  };
}

export function readReviewLoadingSnapshot(
  workspaceId: string,
  reviewFilter: ReviewFilter,
): ReviewLoadingSnapshot | null {
  const selectedReviewFilterKey = serializeReviewFilterKey(reviewFilter);
  const storageKey = buildReviewLoadingSnapshotStorageKey(workspaceId, selectedReviewFilterKey);
  const snapshot = parseReviewLoadingSnapshot(readLocalStorageValue(storageKey));

  if (
    snapshot === null
    || snapshot.workspaceId !== workspaceId
    || snapshot.selectedReviewFilterKey !== selectedReviewFilterKey
  ) {
    return null;
  }

  return snapshot;
}

export function writeReviewLoadingSnapshot(snapshot: ReviewLoadingSnapshot): void {
  const storageKey = buildReviewLoadingSnapshotStorageKey(snapshot.workspaceId, snapshot.selectedReviewFilterKey);
  writeLocalStorageValue(storageKey, JSON.stringify(snapshot));
}

export function readCardsLoadingSnapshot(workspaceId: string): CardsLoadingSnapshot | null {
  const storageKey = buildCardsLoadingSnapshotStorageKey(workspaceId);
  const snapshot = parseCardsLoadingSnapshot(readLocalStorageValue(storageKey));

  if (snapshot === null || snapshot.workspaceId !== workspaceId) {
    return null;
  }

  return snapshot;
}

export function writeCardsLoadingSnapshot(snapshot: CardsLoadingSnapshot): void {
  const storageKey = buildCardsLoadingSnapshotStorageKey(snapshot.workspaceId);
  writeLocalStorageValue(storageKey, JSON.stringify(snapshot));
}
