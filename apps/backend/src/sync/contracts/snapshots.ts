import type {
  CardMutationMetadata,
  CardSnapshotInput,
} from "../../cards";
import { appendLegacyEffortTag } from "../../cards/shared";
import type {
  DeckFilterDefinition,
  DeckMutationMetadata,
  DeckSnapshotInput,
} from "../../decks";
import type {
  WorkspaceSchedulerSettingsMutationMetadata,
  WorkspaceSchedulerSettingsSnapshotInput,
} from "../../scheduling/workspaceSettings";
import type { LegacyEffortLevel } from "./legacyEffort";

type MutationMetadataInput = Readonly<{
  clientUpdatedAt: string;
  lastModifiedByReplicaId: string;
  lastOperationId: string;
}>;

type CardSnapshotPayload = Omit<CardSnapshotInput, "effortLevel"> & Readonly<{
  effortLevel?: LegacyEffortLevel;
}>;

type DeckFilterDefinitionPayload = DeckFilterDefinition & Readonly<{
  effortLevels?: ReadonlyArray<LegacyEffortLevel>;
}>;

type DeckSnapshotPayload = Omit<DeckSnapshotInput, "filterDefinition"> & Readonly<{
  filterDefinition: DeckFilterDefinitionPayload;
}>;

export function toCardSnapshotInput(payload: CardSnapshotPayload): CardSnapshotInput {
  return {
    cardId: payload.cardId,
    frontText: payload.frontText,
    backText: payload.backText,
    tags: appendLegacyEffortTag(payload.tags, payload.effortLevel),
    dueAt: payload.dueAt,
    createdAt: payload.createdAt,
    reps: payload.reps,
    lapses: payload.lapses,
    fsrsCardState: payload.fsrsCardState,
    fsrsStepIndex: payload.fsrsStepIndex,
    fsrsStability: payload.fsrsStability,
    fsrsDifficulty: payload.fsrsDifficulty,
    fsrsLastReviewedAt: payload.fsrsLastReviewedAt,
    fsrsScheduledDays: payload.fsrsScheduledDays,
    deletedAt: payload.deletedAt,
  };
}

export function toDeckSnapshotInput(payload: DeckSnapshotPayload): DeckSnapshotInput {
  const legacyEffortTags = (payload.filterDefinition.effortLevels ?? []).reduce<ReadonlyArray<string>>(
    (tags, effortLevel) => appendLegacyEffortTag(tags, effortLevel),
    payload.filterDefinition.tags,
  );

  return {
    deckId: payload.deckId,
    name: payload.name,
    filterDefinition: {
      version: payload.filterDefinition.version,
      // TODO(old-mobile-cutoff): Remove legacy effortLevels input during final wire-drop cleanup.
      tags: legacyEffortTags,
    },
    createdAt: payload.createdAt,
    deletedAt: payload.deletedAt,
  };
}

export function toWorkspaceSchedulerSettingsSnapshotInput(
  payload: WorkspaceSchedulerSettingsSnapshotInput,
): WorkspaceSchedulerSettingsSnapshotInput {
  return {
    algorithm: payload.algorithm,
    desiredRetention: payload.desiredRetention,
    learningStepsMinutes: payload.learningStepsMinutes,
    relearningStepsMinutes: payload.relearningStepsMinutes,
    maximumIntervalDays: payload.maximumIntervalDays,
    enableFuzz: payload.enableFuzz,
  };
}

export function toCardMutationMetadata(input: MutationMetadataInput): CardMutationMetadata {
  return {
    clientUpdatedAt: input.clientUpdatedAt,
    lastModifiedByReplicaId: input.lastModifiedByReplicaId,
    lastOperationId: input.lastOperationId,
  };
}

export function toDeckMutationMetadata(input: MutationMetadataInput): DeckMutationMetadata {
  return {
    clientUpdatedAt: input.clientUpdatedAt,
    lastModifiedByReplicaId: input.lastModifiedByReplicaId,
    lastOperationId: input.lastOperationId,
  };
}

export function toWorkspaceSchedulerSettingsMutationMetadata(
  input: MutationMetadataInput,
): WorkspaceSchedulerSettingsMutationMetadata {
  return {
    clientUpdatedAt: input.clientUpdatedAt,
    lastModifiedByReplicaId: input.lastModifiedByReplicaId,
    lastOperationId: input.lastOperationId,
  };
}
