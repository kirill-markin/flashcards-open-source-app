import assert from "node:assert/strict";
import test from "node:test";
import { SQL_TOOL_PROMPT_EXAMPLE_LINES } from "./sqlToolContract";

test("SQL tool prompt examples stay selected-workspace scoped", () => {
  for (const line of SQL_TOOL_PROMPT_EXAMPLE_LINES) {
    assert.equal(line.includes("workspace_id"), false);
  }
});
