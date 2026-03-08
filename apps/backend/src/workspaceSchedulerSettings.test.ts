import assert from "node:assert/strict";
import test from "node:test";
import { HttpError } from "./errors";
import {
  defaultWorkspaceSchedulerConfig,
  validateWorkspaceSchedulerSettingsInput,
} from "./workspaceSchedulerSettings";

test("validateWorkspaceSchedulerSettingsInput accepts valid scheduler config", () => {
  const result = validateWorkspaceSchedulerSettingsInput({
    desiredRetention: 0.9,
    learningStepsMinutes: [1, 10],
    relearningStepsMinutes: [10],
    maximumIntervalDays: 36_500,
    enableFuzz: true,
  });

  assert.deepEqual(result, defaultWorkspaceSchedulerConfig);
});

test("validateWorkspaceSchedulerSettingsInput rejects invalid retention", () => {
  assert.throws(
    () => validateWorkspaceSchedulerSettingsInput({
      desiredRetention: 1,
      learningStepsMinutes: [1, 10],
      relearningStepsMinutes: [10],
      maximumIntervalDays: 36_500,
      enableFuzz: true,
    }),
    (error: unknown) => error instanceof HttpError && error.statusCode === 400,
  );
});

test("validateWorkspaceSchedulerSettingsInput rejects empty learning steps", () => {
  assert.throws(
    () => validateWorkspaceSchedulerSettingsInput({
      desiredRetention: 0.9,
      learningStepsMinutes: [],
      relearningStepsMinutes: [10],
      maximumIntervalDays: 36_500,
      enableFuzz: true,
    }),
    (error: unknown) => error instanceof HttpError && error.statusCode === 400,
  );
});

test("validateWorkspaceSchedulerSettingsInput rejects non-ascending relearning steps", () => {
  assert.throws(
    () => validateWorkspaceSchedulerSettingsInput({
      desiredRetention: 0.9,
      learningStepsMinutes: [1, 10],
      relearningStepsMinutes: [30, 10],
      maximumIntervalDays: 36_500,
      enableFuzz: true,
    }),
    (error: unknown) => error instanceof HttpError && error.statusCode === 400,
  );
});

test("validateWorkspaceSchedulerSettingsInput rejects invalid maximum interval", () => {
  assert.throws(
    () => validateWorkspaceSchedulerSettingsInput({
      desiredRetention: 0.9,
      learningStepsMinutes: [1, 10],
      relearningStepsMinutes: [10],
      maximumIntervalDays: 0,
      enableFuzz: true,
    }),
    (error: unknown) => error instanceof HttpError && error.statusCode === 400,
  );
});
