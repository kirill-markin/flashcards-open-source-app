import type { FeedbackPromptIdentityKey } from "../feedback/feedback";
import {
  closeDatabaseAfter,
  closeDatabaseAfterWrite,
  getFromStore,
  runReadwrite,
} from "../core/database";

export type MobileAppPromotionState = Readonly<{
  lastPromptShownLocalDate: string | null;
  lastPromptShownAt: string | null;
  knownHasMobileReviewEvent: boolean;
}>;

type MobileAppPromotionStateRecord = Readonly<{
  key: string;
  identityKey: FeedbackPromptIdentityKey;
  state: MobileAppPromotionState;
}>;

type MobileAppPromotionPromptShownInput = Readonly<{
  identityKey: FeedbackPromptIdentityKey;
  localDate: string;
  shownAt: string;
}>;

type MobileReviewEventKnownInput = Readonly<{
  identityKey: FeedbackPromptIdentityKey;
}>;

const mobileAppPromotionStateKeyPrefix = "mobile_app_promotion_state:";

export const emptyMobileAppPromotionState: MobileAppPromotionState = {
  lastPromptShownLocalDate: null,
  lastPromptShownAt: null,
  knownHasMobileReviewEvent: false,
};

function isPlainObject(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === "object" && value !== null && Array.isArray(value) === false;
}

function buildMobileAppPromotionStateKey(identityKey: FeedbackPromptIdentityKey): string {
  return `${mobileAppPromotionStateKeyPrefix}${identityKey}`;
}

function validateIsoTimestamp(timestamp: string, fieldName: keyof MobileAppPromotionState): void {
  const timestampMillis = new Date(timestamp).getTime();
  if (timestamp.includes("T") === false || Number.isNaN(timestampMillis)) {
    throw new Error(`Invalid local mobile app promotion state: ${fieldName} must be an ISO timestamp`);
  }
}

function validateIsoLocalDate(localDate: string, fieldName: keyof MobileAppPromotionState): void {
  const dateMatch = /^(\d{4})-(\d{2})-(\d{2})$/u.exec(localDate);
  if (dateMatch === null) {
    throw new Error(`Invalid local mobile app promotion state: ${fieldName} must be an ISO local date`);
  }

  const year = Number(dateMatch[1]);
  const month = Number(dateMatch[2]);
  const day = Number(dateMatch[3]);
  const dateValue = new Date(Date.UTC(year, month - 1, day));
  if (
    dateValue.getUTCFullYear() !== year
    || dateValue.getUTCMonth() !== month - 1
    || dateValue.getUTCDate() !== day
  ) {
    throw new Error(`Invalid local mobile app promotion state: ${fieldName} must be an ISO local date`);
  }
}

function parseNullableStringField(
  objectValue: Readonly<Record<string, unknown>>,
  fieldName: keyof Pick<MobileAppPromotionState, "lastPromptShownLocalDate" | "lastPromptShownAt">,
): string | null {
  const fieldValue = objectValue[fieldName];
  if (fieldValue === null) {
    return null;
  }

  if (typeof fieldValue !== "string") {
    throw new Error(`Invalid local mobile app promotion state: ${fieldName} must be string or null`);
  }

  if (fieldName === "lastPromptShownLocalDate") {
    validateIsoLocalDate(fieldValue, fieldName);
  } else {
    validateIsoTimestamp(fieldValue, fieldName);
  }

  return fieldValue;
}

function parseBooleanField(
  objectValue: Readonly<Record<string, unknown>>,
  fieldName: keyof Pick<MobileAppPromotionState, "knownHasMobileReviewEvent">,
): boolean {
  const fieldValue = objectValue[fieldName];
  if (typeof fieldValue !== "boolean") {
    throw new Error(`Invalid local mobile app promotion state: ${fieldName} must be boolean`);
  }

  return fieldValue;
}

function parseMobileAppPromotionState(value: unknown): MobileAppPromotionState {
  if (isPlainObject(value) === false) {
    throw new Error("Invalid local mobile app promotion state: state must be an object");
  }

  return {
    lastPromptShownLocalDate: parseNullableStringField(value, "lastPromptShownLocalDate"),
    lastPromptShownAt: parseNullableStringField(value, "lastPromptShownAt"),
    knownHasMobileReviewEvent: parseBooleanField(value, "knownHasMobileReviewEvent"),
  };
}

function parseMobileAppPromotionStateRecord(
  value: unknown,
  identityKey: FeedbackPromptIdentityKey,
): MobileAppPromotionStateRecord {
  if (isPlainObject(value) === false) {
    throw new Error("Invalid local mobile app promotion state: record must be an object");
  }

  const expectedKey = buildMobileAppPromotionStateKey(identityKey);
  if (value.key !== expectedKey) {
    throw new Error("Invalid local mobile app promotion state: key must match the promotion identity key");
  }

  if (value.identityKey !== identityKey) {
    throw new Error("Invalid local mobile app promotion state: identityKey must match the requested identity");
  }

  return {
    key: expectedKey,
    identityKey,
    state: parseMobileAppPromotionState(value.state),
  };
}

function buildMobileAppPromotionStateRecord(
  identityKey: FeedbackPromptIdentityKey,
  state: MobileAppPromotionState,
): MobileAppPromotionStateRecord {
  return {
    key: buildMobileAppPromotionStateKey(identityKey),
    identityKey,
    state,
  };
}

export async function loadMobileAppPromotionState(
  identityKey: FeedbackPromptIdentityKey,
): Promise<MobileAppPromotionState> {
  const storedRecord = await closeDatabaseAfter((database) => getFromStore<unknown>(
    database,
    "meta",
    buildMobileAppPromotionStateKey(identityKey),
  ));
  if (storedRecord === undefined) {
    return emptyMobileAppPromotionState;
  }

  return parseMobileAppPromotionStateRecord(storedRecord, identityKey).state;
}

export async function putMobileAppPromotionState(
  identityKey: FeedbackPromptIdentityKey,
  state: MobileAppPromotionState,
): Promise<void> {
  await closeDatabaseAfterWrite(async (database) => {
    await runReadwrite(database, ["meta"], (transaction) => transaction.objectStore("meta").put(
      buildMobileAppPromotionStateRecord(identityKey, state),
    ));
  });
}

export async function storeMobileAppPromotionPromptShown(
  input: MobileAppPromotionPromptShownInput,
  throwIfIndexedDbOpenRecoveryFailed: () => void,
): Promise<MobileAppPromotionState> {
  validateIsoLocalDate(input.localDate, "lastPromptShownLocalDate");
  validateIsoTimestamp(input.shownAt, "lastPromptShownAt");

  throwIfIndexedDbOpenRecoveryFailed();
  const currentState = await loadMobileAppPromotionState(input.identityKey);
  throwIfIndexedDbOpenRecoveryFailed();
  const nextState: MobileAppPromotionState = {
    ...currentState,
    lastPromptShownLocalDate: input.localDate,
    lastPromptShownAt: input.shownAt,
  };
  throwIfIndexedDbOpenRecoveryFailed();
  await putMobileAppPromotionState(input.identityKey, nextState);
  throwIfIndexedDbOpenRecoveryFailed();
  return nextState;
}

export async function clearMobileAppPromotionPromptShownIfCurrent(
  input: MobileAppPromotionPromptShownInput,
  throwIfIndexedDbOpenRecoveryFailed: () => void,
): Promise<MobileAppPromotionState> {
  validateIsoLocalDate(input.localDate, "lastPromptShownLocalDate");
  validateIsoTimestamp(input.shownAt, "lastPromptShownAt");

  throwIfIndexedDbOpenRecoveryFailed();
  const currentState = await loadMobileAppPromotionState(input.identityKey);
  throwIfIndexedDbOpenRecoveryFailed();
  if (
    currentState.lastPromptShownLocalDate !== input.localDate
    || currentState.lastPromptShownAt !== input.shownAt
  ) {
    return currentState;
  }

  const nextState: MobileAppPromotionState = {
    ...currentState,
    lastPromptShownLocalDate: null,
    lastPromptShownAt: null,
  };
  throwIfIndexedDbOpenRecoveryFailed();
  await putMobileAppPromotionState(input.identityKey, nextState);
  throwIfIndexedDbOpenRecoveryFailed();
  return nextState;
}

export async function storeKnownMobileReviewEvent(
  input: MobileReviewEventKnownInput,
  throwIfIndexedDbOpenRecoveryFailed: () => void,
): Promise<MobileAppPromotionState> {
  throwIfIndexedDbOpenRecoveryFailed();
  const currentState = await loadMobileAppPromotionState(input.identityKey);
  throwIfIndexedDbOpenRecoveryFailed();
  const nextState: MobileAppPromotionState = {
    ...currentState,
    knownHasMobileReviewEvent: true,
  };
  throwIfIndexedDbOpenRecoveryFailed();
  await putMobileAppPromotionState(input.identityKey, nextState);
  throwIfIndexedDbOpenRecoveryFailed();
  return nextState;
}
