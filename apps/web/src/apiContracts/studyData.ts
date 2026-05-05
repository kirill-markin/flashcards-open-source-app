import type {
  Card,
  Deck,
  DeckFilterDefinition,
  ReviewEvent,
  WorkspaceSchedulerSettings,
} from "../types";
import {
  joinPath,
  parseArray,
  parseEnum,
  parseLiteral,
  parseNullableNumber,
  parseNullableString,
  parseNumber,
  parseNumberArray,
  parseObject,
  parseRequiredField,
  parseString,
  parseStringArray,
  parseBoolean,
} from "./core";

export function parseEffortLevel(value: unknown, endpoint: string, path: string): "fast" | "medium" | "long" {
  return parseEnum(value, endpoint, path, ["fast", "medium", "long"]);
}

function parseEffortLevels(value: unknown, endpoint: string, path: string): ReadonlyArray<"fast" | "medium" | "long"> {
  return parseArray(value, endpoint, path, parseEffortLevel);
}

function parseFsrsCardState(value: unknown, endpoint: string, path: string): "new" | "learning" | "review" | "relearning" {
  return parseEnum(value, endpoint, path, ["new", "learning", "review", "relearning"]);
}

export function parseReviewRating(value: unknown, endpoint: string, path: string): 0 | 1 | 2 | 3 {
  return parseEnum(value, endpoint, path, [0, 1, 2, 3]);
}

function parseDeckFilterDefinition(value: unknown, endpoint: string, path: string): DeckFilterDefinition {
  const objectValue = parseObject(value, endpoint, path);
  return {
    version: parseLiteral(parseRequiredField(objectValue, "version", endpoint, path, parseNumber), endpoint, joinPath(path, "version"), 2),
    effortLevels: parseRequiredField(objectValue, "effortLevels", endpoint, path, parseEffortLevels),
    tags: parseRequiredField(objectValue, "tags", endpoint, path, parseStringArray),
  };
}

export function parseCard(value: unknown, endpoint: string, path: string): Card {
  const objectValue = parseObject(value, endpoint, path);
  return {
    cardId: parseRequiredField(objectValue, "cardId", endpoint, path, parseString),
    frontText: parseRequiredField(objectValue, "frontText", endpoint, path, parseString),
    backText: parseRequiredField(objectValue, "backText", endpoint, path, parseString),
    tags: parseRequiredField(objectValue, "tags", endpoint, path, parseStringArray),
    effortLevel: parseRequiredField(objectValue, "effortLevel", endpoint, path, parseEffortLevel),
    dueAt: parseRequiredField(objectValue, "dueAt", endpoint, path, parseNullableString),
    createdAt: parseRequiredField(objectValue, "createdAt", endpoint, path, parseString),
    reps: parseRequiredField(objectValue, "reps", endpoint, path, parseNumber),
    lapses: parseRequiredField(objectValue, "lapses", endpoint, path, parseNumber),
    fsrsCardState: parseRequiredField(objectValue, "fsrsCardState", endpoint, path, parseFsrsCardState),
    fsrsStepIndex: parseRequiredField(objectValue, "fsrsStepIndex", endpoint, path, parseNullableNumber),
    fsrsStability: parseRequiredField(objectValue, "fsrsStability", endpoint, path, parseNullableNumber),
    fsrsDifficulty: parseRequiredField(objectValue, "fsrsDifficulty", endpoint, path, parseNullableNumber),
    fsrsLastReviewedAt: parseRequiredField(objectValue, "fsrsLastReviewedAt", endpoint, path, parseNullableString),
    fsrsScheduledDays: parseRequiredField(objectValue, "fsrsScheduledDays", endpoint, path, parseNullableNumber),
    clientUpdatedAt: parseRequiredField(objectValue, "clientUpdatedAt", endpoint, path, parseString),
    lastModifiedByReplicaId: parseRequiredField(objectValue, "lastModifiedByReplicaId", endpoint, path, parseString),
    lastOperationId: parseRequiredField(objectValue, "lastOperationId", endpoint, path, parseString),
    updatedAt: parseRequiredField(objectValue, "updatedAt", endpoint, path, parseString),
    deletedAt: parseRequiredField(objectValue, "deletedAt", endpoint, path, parseNullableString),
  };
}

export function parseWorkspaceSchedulerSettings(
  value: unknown,
  endpoint: string,
  path: string,
): WorkspaceSchedulerSettings {
  const objectValue = parseObject(value, endpoint, path);
  return {
    algorithm: parseLiteral(
      parseRequiredField(objectValue, "algorithm", endpoint, path, parseString),
      endpoint,
      joinPath(path, "algorithm"),
      "fsrs-6",
    ),
    desiredRetention: parseRequiredField(objectValue, "desiredRetention", endpoint, path, parseNumber),
    learningStepsMinutes: parseRequiredField(objectValue, "learningStepsMinutes", endpoint, path, parseNumberArray),
    relearningStepsMinutes: parseRequiredField(objectValue, "relearningStepsMinutes", endpoint, path, parseNumberArray),
    maximumIntervalDays: parseRequiredField(objectValue, "maximumIntervalDays", endpoint, path, parseNumber),
    enableFuzz: parseRequiredField(objectValue, "enableFuzz", endpoint, path, parseBoolean),
    clientUpdatedAt: parseRequiredField(objectValue, "clientUpdatedAt", endpoint, path, parseString),
    lastModifiedByReplicaId: parseRequiredField(objectValue, "lastModifiedByReplicaId", endpoint, path, parseString),
    lastOperationId: parseRequiredField(objectValue, "lastOperationId", endpoint, path, parseString),
    updatedAt: parseRequiredField(objectValue, "updatedAt", endpoint, path, parseString),
  };
}

export function parseDeck(value: unknown, endpoint: string, path: string): Deck {
  const objectValue = parseObject(value, endpoint, path);
  return {
    deckId: parseRequiredField(objectValue, "deckId", endpoint, path, parseString),
    workspaceId: parseRequiredField(objectValue, "workspaceId", endpoint, path, parseString),
    name: parseRequiredField(objectValue, "name", endpoint, path, parseString),
    filterDefinition: parseRequiredField(objectValue, "filterDefinition", endpoint, path, parseDeckFilterDefinition),
    createdAt: parseRequiredField(objectValue, "createdAt", endpoint, path, parseString),
    clientUpdatedAt: parseRequiredField(objectValue, "clientUpdatedAt", endpoint, path, parseString),
    lastModifiedByReplicaId: parseRequiredField(objectValue, "lastModifiedByReplicaId", endpoint, path, parseString),
    lastOperationId: parseRequiredField(objectValue, "lastOperationId", endpoint, path, parseString),
    updatedAt: parseRequiredField(objectValue, "updatedAt", endpoint, path, parseString),
    deletedAt: parseRequiredField(objectValue, "deletedAt", endpoint, path, parseNullableString),
  };
}

export function parseReviewEvent(value: unknown, endpoint: string, path: string): ReviewEvent {
  const objectValue = parseObject(value, endpoint, path);
  return {
    reviewEventId: parseRequiredField(objectValue, "reviewEventId", endpoint, path, parseString),
    workspaceId: parseRequiredField(objectValue, "workspaceId", endpoint, path, parseString),
    cardId: parseRequiredField(objectValue, "cardId", endpoint, path, parseString),
    replicaId: parseRequiredField(objectValue, "replicaId", endpoint, path, parseString),
    clientEventId: parseRequiredField(objectValue, "clientEventId", endpoint, path, parseString),
    rating: parseRequiredField(objectValue, "rating", endpoint, path, parseReviewRating),
    reviewedAtClient: parseRequiredField(objectValue, "reviewedAtClient", endpoint, path, parseString),
    reviewedAtServer: parseRequiredField(objectValue, "reviewedAtServer", endpoint, path, parseString),
  };
}
