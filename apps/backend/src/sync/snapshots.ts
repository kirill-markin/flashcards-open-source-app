import type {
  CardMutationMetadata,
  CardSnapshotInput,
} from "../cards";
import type {
  DeckMutationMetadata,
  DeckSnapshotInput,
} from "../decks";
import type {
  WorkspaceSchedulerSettingsMutationMetadata,
  WorkspaceSchedulerSettingsSnapshotInput,
} from "../workspaceSchedulerSettings";

type MutationMetadataInput = Readonly<{
  clientUpdatedAt: string;
  lastModifiedByReplicaId: string;
  lastOperationId: string;
}>;

export function toCardSnapshotInput(payload: CardSnapshotInput): CardSnapshotInput {
  return {
    cardId: payload.cardId,
    frontText: payload.frontText,
    backText: payload.backText,
    tags: payload.tags,
    effortLevel: payload.effortLevel,
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

export function toDeckSnapshotInput(payload: DeckSnapshotInput): DeckSnapshotInput {
  return {
    deckId: payload.deckId,
    name: payload.name,
    filterDefinition: payload.filterDefinition,
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
