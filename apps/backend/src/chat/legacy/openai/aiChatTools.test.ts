import assert from "node:assert/strict";
import test from "node:test";
import { OPENAI_AI_CHAT_TOOLS, OPENAI_AI_CHAT_TOOL_ARGUMENT_VALIDATORS } from "./aiChatTools";

test("AI chat OpenAI tools keep strict mode disabled", () => {
  assert.ok(OPENAI_AI_CHAT_TOOLS.every((tool) => tool.strict === false));
});

test("sql validator requires a non-empty sql string", () => {
  const failed = OPENAI_AI_CHAT_TOOL_ARGUMENT_VALIDATORS.sql.safeParse({
    sql: "   ",
  });
  assert.equal(failed.success, false);

  const success = OPENAI_AI_CHAT_TOOL_ARGUMENT_VALIDATORS.sql.safeParse({
    sql: "SHOW TABLES",
  });
  assert.equal(success.success, true);
  assert.deepEqual(success.data, {
    sql: "SHOW TABLES",
  });
});
