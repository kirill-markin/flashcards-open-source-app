import assert from "node:assert/strict";
import test from "node:test";
import { OPENAI_LOCAL_FLASHCARDS_TOOLS, OPENAI_LOCAL_TOOL_ARGUMENT_VALIDATORS } from "./localTools";

test("local OpenAI tools keep strict mode disabled", () => {
  assert.ok(OPENAI_LOCAL_FLASHCARDS_TOOLS.every((tool) => tool.strict === false));
});

test("sql validator requires a non-empty sql string", () => {
  const failed = OPENAI_LOCAL_TOOL_ARGUMENT_VALIDATORS.sql.safeParse({
    sql: "   ",
  });
  assert.equal(failed.success, false);

  const success = OPENAI_LOCAL_TOOL_ARGUMENT_VALIDATORS.sql.safeParse({
    sql: "SHOW TABLES",
  });
  assert.equal(success.success, true);
  assert.deepEqual(success.data, {
    sql: "SHOW TABLES",
  });
});

test("list_outbox validator accepts cursor pagination input", () => {
  const result = OPENAI_LOCAL_TOOL_ARGUMENT_VALIDATORS.list_outbox.safeParse({
    cursor: null,
    limit: 20,
  });

  assert.equal(result.success, true);
  assert.deepEqual(result.data, {
    cursor: null,
    limit: 20,
  });
});

test("get_cloud_settings validator accepts an empty object only", () => {
  const result = OPENAI_LOCAL_TOOL_ARGUMENT_VALIDATORS.get_cloud_settings.safeParse({});
  assert.equal(result.success, true);

  const failed = OPENAI_LOCAL_TOOL_ARGUMENT_VALIDATORS.get_cloud_settings.safeParse({
    unexpected: true,
  });
  assert.equal(failed.success, false);
});
