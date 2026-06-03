import type { FeedbackState } from "../../types";
import { getStableInstallationId } from "../../clientIdentity";
import {
  closeDatabaseAfter,
  closeDatabaseAfterWrite,
  getFromStore,
  runReadwrite,
} from "../core/database";

export type FeedbackPromptState = Readonly<{
  lastAutomaticFeedbackPromptShownAt: string | null;
  lastFeedbackSubmittedAt: string | null;
  nextAutomaticFeedbackPromptAt: string | null;
  lastFeedbackStateFetchedAt: string | null;
}>;

export type FeedbackPromptIdentityKey = string;

export type FeedbackPromptIdentityInput = Readonly<{
  sessionUserId: string | null;
  linkedUserId: string | null;
}>;

type FeedbackPromptStateRecord = Readonly<{
  key: string;
  identityKey: FeedbackPromptIdentityKey;
  state: FeedbackPromptState;
}>;

type FeedbackStateFetchedInput = Readonly<{
  identityKey: FeedbackPromptIdentityKey;
  feedbackState: FeedbackState;
  fetchedAt: string;
}>;

type FeedbackSubmittedInput = Readonly<{
  identityKey: FeedbackPromptIdentityKey;
  feedbackState: FeedbackState;
  submittedAt: string;
}>;

type AutomaticPromptShownInput = Readonly<{
  identityKey: FeedbackPromptIdentityKey;
  shownAt: string;
  nextAutomaticFeedbackPromptAt: string | null;
}>;

const feedbackPromptStateKeyPrefix = "feedback_prompt_state:";

export const emptyFeedbackPromptState: FeedbackPromptState = {
  lastAutomaticFeedbackPromptShownAt: null,
  lastFeedbackSubmittedAt: null,
  nextAutomaticFeedbackPromptAt: null,
  lastFeedbackStateFetchedAt: null,
};

function isPlainObject(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === "object" && value !== null && Array.isArray(value) === false;
}

function optionalTrimmedString(value: string | null): string | null {
  if (value === null) {
    return null;
  }

  const trimmedValue = value.trim();
  return trimmedValue === "" ? null : trimmedValue;
}

function buildFeedbackPromptStateKey(identityKey: FeedbackPromptIdentityKey): string {
  return `${feedbackPromptStateKeyPrefix}${identityKey}`;
}

function parseTimestampMillis(timestamp: string, fieldName: keyof FeedbackPromptState | keyof FeedbackState): number {
  const timestampMillis = new Date(timestamp).getTime();
  if (Number.isNaN(timestampMillis)) {
    throw new Error(`Invalid local feedback prompt state: ${fieldName} must be an ISO timestamp`);
  }

  return timestampMillis;
}

function getLaterNullableIsoTimestamp(
  currentValue: string | null,
  nextValue: string | null,
  fieldName: keyof FeedbackPromptState | keyof FeedbackState,
): string | null {
  if (currentValue === null) {
    return nextValue;
  }

  if (nextValue === null) {
    return currentValue;
  }

  return parseTimestampMillis(currentValue, fieldName) >= parseTimestampMillis(nextValue, fieldName)
    ? currentValue
    : nextValue;
}

function parseNullableStringField(
  objectValue: Readonly<Record<string, unknown>>,
  fieldName: keyof FeedbackPromptState,
): string | null {
  const fieldValue = objectValue[fieldName];
  if (fieldValue === null) {
    return null;
  }

  if (typeof fieldValue !== "string") {
    throw new Error(`Invalid local feedback prompt state: ${fieldName} must be string or null`);
  }

  return fieldValue;
}

function parseFeedbackPromptState(value: unknown): FeedbackPromptState {
  if (isPlainObject(value) === false) {
    throw new Error("Invalid local feedback prompt state: state must be an object");
  }

  return {
    lastAutomaticFeedbackPromptShownAt: parseNullableStringField(value, "lastAutomaticFeedbackPromptShownAt"),
    lastFeedbackSubmittedAt: parseNullableStringField(value, "lastFeedbackSubmittedAt"),
    nextAutomaticFeedbackPromptAt: parseNullableStringField(value, "nextAutomaticFeedbackPromptAt"),
    lastFeedbackStateFetchedAt: parseNullableStringField(value, "lastFeedbackStateFetchedAt"),
  };
}

function parseFeedbackPromptStateRecord(
  value: unknown,
  identityKey: FeedbackPromptIdentityKey,
): FeedbackPromptStateRecord {
  if (isPlainObject(value) === false) {
    throw new Error("Invalid local feedback prompt state: record must be an object");
  }

  const expectedKey = buildFeedbackPromptStateKey(identityKey);
  if (value.key !== expectedKey) {
    throw new Error("Invalid local feedback prompt state: key must match the feedback identity key");
  }

  if (value.identityKey !== identityKey) {
    throw new Error("Invalid local feedback prompt state: identityKey must match the requested identity");
  }

  return {
    key: expectedKey,
    identityKey,
    state: parseFeedbackPromptState(value.state),
  };
}

function buildFeedbackPromptStateRecord(
  identityKey: FeedbackPromptIdentityKey,
  state: FeedbackPromptState,
): FeedbackPromptStateRecord {
  return {
    key: buildFeedbackPromptStateKey(identityKey),
    identityKey,
    state,
  };
}

export function buildFeedbackPromptIdentityKey(input: FeedbackPromptIdentityInput): FeedbackPromptIdentityKey {
  const userId = optionalTrimmedString(input.sessionUserId) ?? optionalTrimmedString(input.linkedUserId);
  if (userId !== null) {
    return `user:${userId}`;
  }

  return `installation:${getStableInstallationId()}`;
}

export async function loadFeedbackPromptState(identityKey: FeedbackPromptIdentityKey): Promise<FeedbackPromptState> {
  const storedRecord = await closeDatabaseAfter((database) => getFromStore<unknown>(
    database,
    "meta",
    buildFeedbackPromptStateKey(identityKey),
  ));
  if (storedRecord === undefined) {
    return emptyFeedbackPromptState;
  }

  return parseFeedbackPromptStateRecord(storedRecord, identityKey).state;
}

export async function putFeedbackPromptState(
  identityKey: FeedbackPromptIdentityKey,
  state: FeedbackPromptState,
): Promise<void> {
  await closeDatabaseAfterWrite(async (database) => {
    await runReadwrite(database, ["meta"], (transaction) => transaction.objectStore("meta").put(
      buildFeedbackPromptStateRecord(identityKey, state),
    ));
  });
}

export async function storeFetchedFeedbackState(input: FeedbackStateFetchedInput): Promise<FeedbackPromptState> {
  const currentState = await loadFeedbackPromptState(input.identityKey);
  const nextState: FeedbackPromptState = {
    ...currentState,
    lastAutomaticFeedbackPromptShownAt: getLaterNullableIsoTimestamp(
      currentState.lastAutomaticFeedbackPromptShownAt,
      input.feedbackState.lastAutomaticPromptShownAt,
      "lastAutomaticPromptShownAt",
    ),
    lastFeedbackSubmittedAt: getLaterNullableIsoTimestamp(
      currentState.lastFeedbackSubmittedAt,
      input.feedbackState.lastFeedbackSubmittedAt,
      "lastFeedbackSubmittedAt",
    ),
    nextAutomaticFeedbackPromptAt: input.feedbackState.nextAutomaticPromptAt,
    lastFeedbackStateFetchedAt: input.fetchedAt,
  };
  await putFeedbackPromptState(input.identityKey, nextState);
  return nextState;
}

export async function storeFeedbackSubmittedAt(input: FeedbackSubmittedInput): Promise<FeedbackPromptState> {
  const currentState = await loadFeedbackPromptState(input.identityKey);
  const localSubmittedAt = getLaterNullableIsoTimestamp(
    currentState.lastFeedbackSubmittedAt,
    input.submittedAt,
    "lastFeedbackSubmittedAt",
  );
  const nextState: FeedbackPromptState = {
    ...currentState,
    lastAutomaticFeedbackPromptShownAt: getLaterNullableIsoTimestamp(
      currentState.lastAutomaticFeedbackPromptShownAt,
      input.feedbackState.lastAutomaticPromptShownAt,
      "lastAutomaticPromptShownAt",
    ),
    lastFeedbackSubmittedAt: getLaterNullableIsoTimestamp(
      localSubmittedAt,
      input.feedbackState.lastFeedbackSubmittedAt,
      "lastFeedbackSubmittedAt",
    ),
    nextAutomaticFeedbackPromptAt: input.feedbackState.nextAutomaticPromptAt,
    lastFeedbackStateFetchedAt: input.submittedAt,
  };
  await putFeedbackPromptState(input.identityKey, nextState);
  return nextState;
}

export async function storeAutomaticFeedbackPromptShownAt(input: AutomaticPromptShownInput): Promise<FeedbackPromptState> {
  const currentState = await loadFeedbackPromptState(input.identityKey);
  const nextState: FeedbackPromptState = {
    ...currentState,
    lastAutomaticFeedbackPromptShownAt: getLaterNullableIsoTimestamp(
      currentState.lastAutomaticFeedbackPromptShownAt,
      input.shownAt,
      "lastAutomaticFeedbackPromptShownAt",
    ),
    nextAutomaticFeedbackPromptAt: getLaterNullableIsoTimestamp(
      currentState.nextAutomaticFeedbackPromptAt,
      input.nextAutomaticFeedbackPromptAt,
      "nextAutomaticFeedbackPromptAt",
    ),
  };
  await putFeedbackPromptState(input.identityKey, nextState);
  return nextState;
}
