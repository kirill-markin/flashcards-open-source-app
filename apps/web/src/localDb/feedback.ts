import type { FeedbackState } from "../types";
import {
  closeDatabaseAfter,
  closeDatabaseAfterWrite,
  getFromStore,
  runReadwrite,
} from "./core";

export type FeedbackPromptState = Readonly<{
  lastAutomaticFeedbackPromptShownAt: string | null;
  lastFeedbackSubmittedAt: string | null;
  nextAutomaticFeedbackPromptAt: string | null;
  lastFeedbackStateFetchedAt: string | null;
}>;

type FeedbackPromptStateRecord = Readonly<{
  key: "feedback_prompt_state";
  state: FeedbackPromptState;
}>;

type FeedbackStateFetchedInput = Readonly<{
  feedbackState: FeedbackState;
  fetchedAt: string;
}>;

type FeedbackSubmittedInput = Readonly<{
  feedbackState: FeedbackState;
  submittedAt: string;
}>;

type AutomaticPromptShownInput = Readonly<{
  shownAt: string;
  nextAutomaticFeedbackPromptAt: string | null;
}>;

const feedbackPromptStateKey = "feedback_prompt_state";

export const emptyFeedbackPromptState: FeedbackPromptState = {
  lastAutomaticFeedbackPromptShownAt: null,
  lastFeedbackSubmittedAt: null,
  nextAutomaticFeedbackPromptAt: null,
  lastFeedbackStateFetchedAt: null,
};

function isPlainObject(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === "object" && value !== null && Array.isArray(value) === false;
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

function parseFeedbackPromptStateRecord(value: unknown): FeedbackPromptStateRecord {
  if (isPlainObject(value) === false) {
    throw new Error("Invalid local feedback prompt state: record must be an object");
  }

  if (value.key !== feedbackPromptStateKey) {
    throw new Error("Invalid local feedback prompt state: key must be feedback_prompt_state");
  }

  return {
    key: feedbackPromptStateKey,
    state: parseFeedbackPromptState(value.state),
  };
}

function buildFeedbackPromptStateRecord(state: FeedbackPromptState): FeedbackPromptStateRecord {
  return {
    key: feedbackPromptStateKey,
    state,
  };
}

export async function loadFeedbackPromptState(): Promise<FeedbackPromptState> {
  const storedRecord = await closeDatabaseAfter((database) => getFromStore<unknown>(database, "meta", feedbackPromptStateKey));
  if (storedRecord === undefined) {
    return emptyFeedbackPromptState;
  }

  return parseFeedbackPromptStateRecord(storedRecord).state;
}

export async function putFeedbackPromptState(state: FeedbackPromptState): Promise<void> {
  await closeDatabaseAfterWrite(async (database) => {
    await runReadwrite(database, ["meta"], (transaction) => transaction.objectStore("meta").put(
      buildFeedbackPromptStateRecord(state),
    ));
  });
}

export async function storeFetchedFeedbackState(input: FeedbackStateFetchedInput): Promise<FeedbackPromptState> {
  const currentState = await loadFeedbackPromptState();
  const nextState: FeedbackPromptState = {
    ...currentState,
    nextAutomaticFeedbackPromptAt: input.feedbackState.nextAutomaticPromptAt,
    lastFeedbackStateFetchedAt: input.fetchedAt,
  };
  await putFeedbackPromptState(nextState);
  return nextState;
}

export async function storeFeedbackSubmittedAt(input: FeedbackSubmittedInput): Promise<FeedbackPromptState> {
  const currentState = await loadFeedbackPromptState();
  const nextState: FeedbackPromptState = {
    ...currentState,
    lastFeedbackSubmittedAt: input.submittedAt,
    nextAutomaticFeedbackPromptAt: input.feedbackState.nextAutomaticPromptAt,
    lastFeedbackStateFetchedAt: input.submittedAt,
  };
  await putFeedbackPromptState(nextState);
  return nextState;
}

export async function storeAutomaticFeedbackPromptShownAt(input: AutomaticPromptShownInput): Promise<FeedbackPromptState> {
  const currentState = await loadFeedbackPromptState();
  const nextState: FeedbackPromptState = {
    ...currentState,
    lastAutomaticFeedbackPromptShownAt: input.shownAt,
    nextAutomaticFeedbackPromptAt: input.nextAutomaticFeedbackPromptAt,
  };
  await putFeedbackPromptState(nextState);
  return nextState;
}
