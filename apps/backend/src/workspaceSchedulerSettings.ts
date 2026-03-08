/**
 * Workspace-level scheduler settings are the only mutable FSRS configuration
 * surface in v1. They are stored directly on org.workspaces, and the database
 * defaults on those fsrs_* columns must stay aligned with
 * defaultWorkspaceSchedulerConfig used by tests and fixtures.
 *
 * This file mirrors the local iOS scheduler-settings implementation in
 * `apps/ios/Flashcards/Flashcards/LocalDatabase.swift`.
 * If you change scheduler-settings validation or persistence here, make the
 * same change in the iOS mirror and update docs/fsrs-scheduling-logic.md.
 *
 * Source-of-truth docs: docs/fsrs-scheduling-logic.md
 */
import type { DatabaseExecutor } from "./db";
import { query, transaction } from "./db";
import { HttpError } from "./errors";
import {
  incomingLwwMetadataWins,
  normalizeIsoTimestamp,
  type LwwMetadata,
} from "./lww";
import { findLatestSyncChangeId, insertSyncChange } from "./syncChanges";

export type SchedulerAlgorithm = "fsrs-6";

export type WorkspaceSchedulerSettingsMutationMetadata = LwwMetadata;

// Keep in sync with apps/ios/Flashcards/Flashcards/FlashcardsTypes.swift::WorkspaceSchedulerSettings.
export type WorkspaceSchedulerSettings = Readonly<{
  algorithm: SchedulerAlgorithm;
  desiredRetention: number;
  learningStepsMinutes: ReadonlyArray<number>;
  relearningStepsMinutes: ReadonlyArray<number>;
  maximumIntervalDays: number;
  enableFuzz: boolean;
  clientUpdatedAt: string;
  lastModifiedByDeviceId: string;
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

export type WorkspaceSchedulerSettingsMutationResult = Readonly<{
  settings: WorkspaceSchedulerSettings;
  applied: boolean;
  changeId: number | null;
}>;

type WorkspaceSchedulerSettingsRow = Readonly<{
  fsrs_algorithm: string;
  fsrs_desired_retention: number;
  fsrs_learning_steps_minutes: ReadonlyArray<number>;
  fsrs_relearning_steps_minutes: ReadonlyArray<number>;
  fsrs_maximum_interval_days: number;
  fsrs_enable_fuzz: boolean;
  fsrs_client_updated_at: Date | string;
  fsrs_last_modified_by_device_id: string;
  fsrs_last_operation_id: string;
  fsrs_updated_at: Date | string;
}>;

export const defaultWorkspaceSchedulerConfig: WorkspaceSchedulerConfig = Object.freeze({
  algorithm: "fsrs-6",
  desiredRetention: 0.9,
  learningStepsMinutes: Object.freeze([1, 10]),
  relearningStepsMinutes: Object.freeze([10]),
  maximumIntervalDays: 36_500,
  enableFuzz: true,
});

function toIsoString(value: Date | string): string {
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString();
}

// Keep in sync with apps/ios/Flashcards/Flashcards/LocalDatabase.swift::validateSchedulerStepList(values:fieldName:).
function parseSteps(value: unknown, fieldName: string): ReadonlyArray<number> {
  if (!Array.isArray(value)) {
    throw new Error(`${fieldName} must be an array`);
  }

  if (value.length === 0) {
    throw new Error(`${fieldName} must not be empty`);
  }

  const steps = value.map((item) => {
    if (typeof item !== "number" || !Number.isInteger(item) || item <= 0 || item >= 1_440) {
      throw new Error(`${fieldName} must contain positive integer minutes under 1440`);
    }

    return item;
  });

  for (let index = 1; index < steps.length; index += 1) {
    if (steps[index] <= steps[index - 1]) {
      throw new Error(`${fieldName} must be strictly increasing`);
    }
  }

  return steps;
}

// Keep in sync with apps/ios/Flashcards/Flashcards/LocalDatabase.swift::loadWorkspaceSchedulerSettings(workspaceId:).
function mapWorkspaceSchedulerSettings(row: WorkspaceSchedulerSettingsRow): WorkspaceSchedulerSettings {
  if (row.fsrs_algorithm !== "fsrs-6") {
    throw new Error(`Unsupported scheduler algorithm: ${row.fsrs_algorithm}`);
  }

  return {
    algorithm: row.fsrs_algorithm,
    desiredRetention: row.fsrs_desired_retention,
    learningStepsMinutes: parseSteps(row.fsrs_learning_steps_minutes, "fsrs_learning_steps_minutes"),
    relearningStepsMinutes: parseSteps(row.fsrs_relearning_steps_minutes, "fsrs_relearning_steps_minutes"),
    maximumIntervalDays: row.fsrs_maximum_interval_days,
    enableFuzz: row.fsrs_enable_fuzz,
    clientUpdatedAt: toIsoString(row.fsrs_client_updated_at),
    lastModifiedByDeviceId: row.fsrs_last_modified_by_device_id,
    lastOperationId: row.fsrs_last_operation_id,
    updatedAt: toIsoString(row.fsrs_updated_at),
  };
}

// Keep in sync with apps/ios/Flashcards/Flashcards/LocalDatabase.swift::loadWorkspaceSchedulerSettings(workspaceId:).
function toWorkspaceSchedulerConfig(settings: WorkspaceSchedulerSettings): WorkspaceSchedulerConfig {
  return {
    algorithm: settings.algorithm,
    desiredRetention: settings.desiredRetention,
    learningStepsMinutes: settings.learningStepsMinutes,
    relearningStepsMinutes: settings.relearningStepsMinutes,
    maximumIntervalDays: settings.maximumIntervalDays,
    enableFuzz: settings.enableFuzz,
  };
}

function toStorageSteps(steps: ReadonlyArray<number>): string {
  return JSON.stringify([...steps]);
}

function toWorkspaceSchedulerLwwMetadata(
  settings: WorkspaceSchedulerSettings,
): WorkspaceSchedulerSettingsMutationMetadata {
  return {
    clientUpdatedAt: settings.clientUpdatedAt,
    lastModifiedByDeviceId: settings.lastModifiedByDeviceId,
    lastOperationId: settings.lastOperationId,
  };
}

function toWorkspaceSchedulerPayloadJson(settings: WorkspaceSchedulerSettings): string {
  return JSON.stringify(settings);
}

async function recordWorkspaceSchedulerSyncChange(
  executor: DatabaseExecutor,
  workspaceId: string,
  settings: WorkspaceSchedulerSettings,
): Promise<number> {
  return insertSyncChange(
    executor,
    workspaceId,
    "workspace_scheduler_settings",
    workspaceId,
    "upsert",
    settings.lastModifiedByDeviceId,
    settings.lastOperationId,
    toWorkspaceSchedulerPayloadJson(settings),
  );
}

function normalizeWorkspaceSchedulerMutationMetadata(
  metadata: WorkspaceSchedulerSettingsMutationMetadata,
): WorkspaceSchedulerSettingsMutationMetadata {
  return {
    clientUpdatedAt: normalizeIsoTimestamp(metadata.clientUpdatedAt, "clientUpdatedAt"),
    lastModifiedByDeviceId: metadata.lastModifiedByDeviceId,
    lastOperationId: metadata.lastOperationId,
  };
}

export function validateWorkspaceSchedulerSettingsInput(
  input: UpdateWorkspaceSchedulerSettingsInput,
): WorkspaceSchedulerConfig {
  // Keep in sync with apps/ios/Flashcards/Flashcards/LocalDatabase.swift::validateWorkspaceSchedulerSettingsInput(desiredRetention:learningStepsMinutes:relearningStepsMinutes:maximumIntervalDays:enableFuzz:).
  if (input.desiredRetention <= 0 || input.desiredRetention >= 1) {
    throw new HttpError(400, "desiredRetention must be greater than 0 and less than 1");
  }

  if (!Number.isInteger(input.maximumIntervalDays) || input.maximumIntervalDays < 1) {
    throw new HttpError(400, "maximumIntervalDays must be a positive integer");
  }

  if (typeof input.enableFuzz !== "boolean") {
    throw new HttpError(400, "enableFuzz must be a boolean");
  }

  try {
    return {
      algorithm: "fsrs-6",
      desiredRetention: input.desiredRetention,
      learningStepsMinutes: parseSteps(input.learningStepsMinutes, "learningStepsMinutes"),
      relearningStepsMinutes: parseSteps(input.relearningStepsMinutes, "relearningStepsMinutes"),
      maximumIntervalDays: input.maximumIntervalDays,
      enableFuzz: input.enableFuzz,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new HttpError(400, message);
  }
}

export async function getWorkspaceSchedulerSettings(
  workspaceId: string,
): Promise<WorkspaceSchedulerSettings> {
  // Keep in sync with apps/ios/Flashcards/Flashcards/LocalDatabase.swift::loadWorkspaceSchedulerSettings(workspaceId:).
  const result = await query<WorkspaceSchedulerSettingsRow>(
    [
      "SELECT",
      "fsrs_algorithm, fsrs_desired_retention, fsrs_learning_steps_minutes, fsrs_relearning_steps_minutes,",
      "fsrs_maximum_interval_days, fsrs_enable_fuzz, fsrs_client_updated_at,",
      "fsrs_last_modified_by_device_id, fsrs_last_operation_id, fsrs_updated_at",
      "FROM org.workspaces",
      "WHERE workspace_id = $1",
    ].join(" "),
    [workspaceId],
  );

  const row = result.rows[0];
  if (row === undefined) {
    throw new Error("Workspace row is missing");
  }

  return mapWorkspaceSchedulerSettings(row);
}

export async function getWorkspaceSchedulerConfig(
  executor: DatabaseExecutor,
  workspaceId: string,
): Promise<WorkspaceSchedulerConfig> {
  // Keep in sync with apps/ios/Flashcards/Flashcards/LocalDatabase.swift::loadWorkspaceSchedulerSettings(workspaceId:).
  const result = await executor.query<WorkspaceSchedulerSettingsRow>(
    [
      "SELECT",
      "fsrs_algorithm, fsrs_desired_retention, fsrs_learning_steps_minutes, fsrs_relearning_steps_minutes,",
      "fsrs_maximum_interval_days, fsrs_enable_fuzz, fsrs_client_updated_at,",
      "fsrs_last_modified_by_device_id, fsrs_last_operation_id, fsrs_updated_at",
      "FROM org.workspaces",
      "WHERE workspace_id = $1",
      "FOR UPDATE",
    ].join(" "),
    [workspaceId],
  );

  const row = result.rows[0];
  if (row === undefined) {
    throw new Error("Workspace row is missing");
  }

  return toWorkspaceSchedulerConfig(mapWorkspaceSchedulerSettings(row));
}

export async function updateWorkspaceSchedulerSettings(
  workspaceId: string,
  input: UpdateWorkspaceSchedulerSettingsInput,
  metadata: WorkspaceSchedulerSettingsMutationMetadata,
): Promise<WorkspaceSchedulerSettings> {
  // Keep in sync with apps/ios/Flashcards/Flashcards/LocalDatabase.swift::updateWorkspaceSchedulerSettings(workspaceId:desiredRetention:learningStepsMinutes:relearningStepsMinutes:maximumIntervalDays:enableFuzz:).
  const snapshotInput: WorkspaceSchedulerSettingsSnapshotInput = {
    algorithm: "fsrs-6",
    desiredRetention: input.desiredRetention,
    learningStepsMinutes: input.learningStepsMinutes,
    relearningStepsMinutes: input.relearningStepsMinutes,
    maximumIntervalDays: input.maximumIntervalDays,
    enableFuzz: input.enableFuzz,
  };

  const result = await applyWorkspaceSchedulerSettingsSnapshot(workspaceId, snapshotInput, metadata);
  return result.settings;
}

export async function applyWorkspaceSchedulerSettingsSnapshot(
  workspaceId: string,
  input: WorkspaceSchedulerSettingsSnapshotInput,
  metadata: WorkspaceSchedulerSettingsMutationMetadata,
): Promise<WorkspaceSchedulerSettingsMutationResult> {
  return transaction(async (executor) => {
    return applyWorkspaceSchedulerSettingsSnapshotInExecutor(executor, workspaceId, input, metadata);
  });
}

export async function applyWorkspaceSchedulerSettingsSnapshotInExecutor(
  executor: DatabaseExecutor,
  workspaceId: string,
  input: WorkspaceSchedulerSettingsSnapshotInput,
  metadata: WorkspaceSchedulerSettingsMutationMetadata,
): Promise<WorkspaceSchedulerSettingsMutationResult> {
  if (input.algorithm !== "fsrs-6") {
    throw new HttpError(400, "algorithm must be fsrs-6");
  }

  const validatedInput = validateWorkspaceSchedulerSettingsInput({
    desiredRetention: input.desiredRetention,
    learningStepsMinutes: input.learningStepsMinutes,
    relearningStepsMinutes: input.relearningStepsMinutes,
    maximumIntervalDays: input.maximumIntervalDays,
    enableFuzz: input.enableFuzz,
  });
  const normalizedMetadata = normalizeWorkspaceSchedulerMutationMetadata(metadata);

  const existingResult = await executor.query<WorkspaceSchedulerSettingsRow>(
    [
      "SELECT",
      "fsrs_algorithm, fsrs_desired_retention, fsrs_learning_steps_minutes, fsrs_relearning_steps_minutes,",
      "fsrs_maximum_interval_days, fsrs_enable_fuzz, fsrs_client_updated_at,",
      "fsrs_last_modified_by_device_id, fsrs_last_operation_id, fsrs_updated_at",
      "FROM org.workspaces",
      "WHERE workspace_id = $1",
      "FOR UPDATE",
    ].join(" "),
    [workspaceId],
  );

  const existingRow = existingResult.rows[0];
  if (existingRow === undefined) {
    throw new Error("Workspace row is missing");
  }

  const existingSettings = mapWorkspaceSchedulerSettings(existingRow);
  if (incomingLwwMetadataWins(normalizedMetadata, toWorkspaceSchedulerLwwMetadata(existingSettings)) === false) {
    return {
      settings: existingSettings,
      applied: false,
      changeId: await findLatestSyncChangeId(executor, workspaceId, "workspace_scheduler_settings", workspaceId),
    };
  }

  const updateResult = await executor.query<WorkspaceSchedulerSettingsRow>(
    [
      "UPDATE org.workspaces",
      "SET fsrs_desired_retention = $1, fsrs_learning_steps_minutes = $2::jsonb, fsrs_relearning_steps_minutes = $3::jsonb,",
      "fsrs_maximum_interval_days = $4, fsrs_enable_fuzz = $5, fsrs_client_updated_at = $6,",
      "fsrs_last_modified_by_device_id = $7, fsrs_last_operation_id = $8, fsrs_updated_at = now()",
      "WHERE workspace_id = $9",
      "RETURNING",
      "fsrs_algorithm, fsrs_desired_retention, fsrs_learning_steps_minutes, fsrs_relearning_steps_minutes,",
      "fsrs_maximum_interval_days, fsrs_enable_fuzz, fsrs_client_updated_at,",
      "fsrs_last_modified_by_device_id, fsrs_last_operation_id, fsrs_updated_at",
    ].join(" "),
    [
      validatedInput.desiredRetention,
      toStorageSteps(validatedInput.learningStepsMinutes),
      toStorageSteps(validatedInput.relearningStepsMinutes),
      validatedInput.maximumIntervalDays,
      validatedInput.enableFuzz,
      normalizedMetadata.clientUpdatedAt,
      normalizedMetadata.lastModifiedByDeviceId,
      normalizedMetadata.lastOperationId,
      workspaceId,
    ],
  );

  const updatedRow = updateResult.rows[0];
  if (updatedRow === undefined) {
    throw new Error("Workspace scheduler settings update did not return a row");
  }

  const updatedSettings = mapWorkspaceSchedulerSettings(updatedRow);
  const changeId = await recordWorkspaceSchedulerSyncChange(executor, workspaceId, updatedSettings);

  return {
    settings: updatedSettings,
    applied: true,
    changeId,
  };
}
