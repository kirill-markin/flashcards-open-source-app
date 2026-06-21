import type {
  CardMutationMetadata,
  CardSnapshotInput,
  EffortLevel,
} from "../../cards";
import { appendLegacyEffortTag } from "../../cards/shared";
import type {
  DeckMutationMetadata,
  DeckSnapshotInput,
} from "../../decks";
import type {
  WorkspaceSchedulerSettingsMutationMetadata,
  WorkspaceSchedulerSettingsSnapshotInput,
} from "../../scheduling/workspaceSettings";

type MutationMetadataInput = Readonly<{
  clientUpdatedAt: string;
  lastModifiedByReplicaId: string;
  lastOperationId: string;
}>;

type CardSnapshotPayload = Omit<CardSnapshotInput, "effortLevel"> & Readonly<{
  effortLevel?: EffortLevel;
}>;

export function toCardSnapshotInput(payload: CardSnapshotPayload): CardSnapshotInput {
  return {
    cardId: payload.cardId,
    frontText: payload.frontText,
    backText: payload.backText,
    tags: appendLegacyEffortTag(payload.tags, payload.effortLevel),
    // TODO(old-mobile-cutoff): Remove legacy effort defaulting during final sync wire-drop cleanup.
    effortLevel: "fast",
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
