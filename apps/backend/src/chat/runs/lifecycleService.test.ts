import assert from "node:assert/strict";
import test from "node:test";
import { ChatRunRowNotFoundError } from "../errors";
import type { ChatSessionRow } from "../store/repository";
import { assertClaimedRunStillActive } from "./lifecycleService";
import type { ChatRunRow } from "./repository";

function createRunRow(
  overrides: Partial<ChatRunRow> = {},
): ChatRunRow {
  return {
    run_id: "run-1",
    session_id: "session-1",
    assistant_item_id: "assistant-1",
    status: "running",
    request_id: "request-1",
    model_id: "gpt-5.4",
    reasoning_effort: "medium",
    timezone: "Europe/Madrid",
    ui_locale: "es",
    turn_input: [],
    worker_claimed_at: null,
    worker_heartbeat_at: null,
    cancel_requested_at: null,
    started_at: null,
    finished_at: null,
    last_error_message: null,
    ...overrides,
  };
}

function createSessionRow(
  overrides: Partial<ChatSessionRow> = {},
): ChatSessionRow {
  return {
    session_id: "session-1",
    status: "running",
    active_run_id: "run-1",
    active_run_heartbeat_at: null,
    composer_suggestions: [],
    active_composer_suggestion_generation_id: null,
    active_generation_suggestions: null,
    main_content_invalidation_version: 0,
    updated_at: "2026-04-16T00:00:00.000Z",
    ...overrides,
  };
}

test("assertClaimedRunStillActive accepts the active running owner", () => {
  assert.doesNotThrow(() => {
    assertClaimedRunStillActive(
      createRunRow(),
      createSessionRow(),
      "complete",
    );
  });
});

test("assertClaimedRunStillActive rejects a session that no longer owns the run", () => {
  assert.throws(() => {
    assertClaimedRunStillActive(
      createRunRow(),
      createSessionRow({
        active_run_id: "run-2",
      }),
      "complete",
    );
  }, ChatRunRowNotFoundError);
});

test("assertClaimedRunStillActive rejects non-running terminal state", () => {
  assert.throws(() => {
    assertClaimedRunStillActive(
      createRunRow({
        status: "completed",
      }),
      createSessionRow({
        status: "idle",
      }),
      "fail",
    );
  }, ChatRunRowNotFoundError);
});
