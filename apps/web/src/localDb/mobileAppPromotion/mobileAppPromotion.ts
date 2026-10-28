import type { FeedbackPromptIdentityKey } from "../feedback/feedback";
import {
  closeDatabaseAfter,
  closeDatabaseAfterWrite,
  getFromStore,
  runReadwrite,
} from "../core/database";

export type MobileAppPromotionState = Readonly<{
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
  shownAt: string;
}>;

type MobileReviewEventKnownInput = Readonly<{
  identityKey: FeedbackPromptIdentityKey;
}>;

// v2: the record dropped `lastPromptShownLocalDate`, which tabs still on an older bundle require, so the two shapes never share a key.
const mobileAppPromotionStateKeyPrefix = "mobile_app_promotion_state_v2:";

export const emptyMobileAppPromotionState: MobileAppPromotionState = {
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

function parseNullableTimestampField(
  objectValue: Readonly<Record<string, unknown>>,
  fieldName: keyof Pick<MobileAppPromotionState, "lastPromptShownAt">,
): string | null {
  const fieldValue = objectValue[fieldName];
  if (fieldValue === null) {
    return null;
  }

  if (typeof fieldValue !== "string") {
    throw new Error(`Invalid local mobile app promotion state: ${fieldName} must be string or null`);
  }

  validateIsoTimestamp(fieldValue, fieldName);
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
    lastPromptShownAt: parseNullableTimestampField(value, "lastPromptShownAt"),
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
  validateIsoTimestamp(input.shownAt, "lastPromptShownAt");

  throwIfIndexedDbOpenRecoveryFailed();
  const currentState = await loadMobileAppPromotionState(input.identityKey);
  throwIfIndexedDbOpenRecoveryFailed();
  const nextState: MobileAppPromotionState = {
    ...currentState,
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
  validateIsoTimestamp(input.shownAt, "lastPromptShownAt");

  throwIfIndexedDbOpenRecoveryFailed();
  const currentState = await loadMobileAppPromotionState(input.identityKey);
  throwIfIndexedDbOpenRecoveryFailed();
  if (currentState.lastPromptShownAt !== input.shownAt) {
    return currentState;
  }

  const nextState: MobileAppPromotionState = {
    ...currentState,
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
