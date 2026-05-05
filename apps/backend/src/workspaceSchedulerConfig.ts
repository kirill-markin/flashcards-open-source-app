export type SchedulerAlgorithm = "fsrs-6";

// Keep in sync with apps/ios/Flashcards/Flashcards/Review/FsrsTypes.swift::WorkspaceSchedulerSettings.
export type WorkspaceSchedulerSettings = Readonly<{
  algorithm: SchedulerAlgorithm;
  desiredRetention: number;
  learningStepsMinutes: ReadonlyArray<number>;
  relearningStepsMinutes: ReadonlyArray<number>;
  maximumIntervalDays: number;
  enableFuzz: boolean;
  clientUpdatedAt: string;
  lastModifiedByReplicaId: string;
  lastOperationId: string;
  updatedAt: string;
}>;

// Keep in sync with apps/ios/Flashcards/Flashcards/LocalDatabase.swift::ValidatedWorkspaceSchedulerSettingsInput and validation flow.
export type WorkspaceSchedulerConfig = Readonly<{
  algorithm: SchedulerAlgorithm;
  desiredRetention: number;
  learningStepsMinutes: ReadonlyArray<number>;
  relearningStepsMinutes: ReadonlyArray<number>;
  maximumIntervalDays: number;
  enableFuzz: boolean;
}>;

export type UpdateWorkspaceSchedulerSettingsInput = Readonly<{
  desiredRetention: number;
  learningStepsMinutes: ReadonlyArray<number>;
  relearningStepsMinutes: ReadonlyArray<number>;
  maximumIntervalDays: number;
  enableFuzz: boolean;
}>;

export type WorkspaceSchedulerSettingsSnapshotInput = Readonly<{
  algorithm: SchedulerAlgorithm;
  desiredRetention: number;
  learningStepsMinutes: ReadonlyArray<number>;
  relearningStepsMinutes: ReadonlyArray<number>;
  maximumIntervalDays: number;
  enableFuzz: boolean;
}>;

export const defaultWorkspaceSchedulerConfig: WorkspaceSchedulerConfig = Object.freeze({
  algorithm: "fsrs-6",
  desiredRetention: 0.9,
  learningStepsMinutes: Object.freeze([1, 10]),
  relearningStepsMinutes: Object.freeze([10]),
  maximumIntervalDays: 36_500,
  enableFuzz: true,
});
