import assert from "node:assert/strict";
import test from "node:test";
import { HttpError } from "../../errors";
import { executeChatToolCallWithDependencies } from "./tools";

test("executeChatToolCallWithDependencies returns success and mutating metadata for successful mutations", async () => {
  const result = await executeChatToolCallWithDependencies(
    "sql",
    "{\"sql\":\"INSERT INTO cards (front_text, back_text, tags, effort_level) VALUES ('Q', 'A', ('tag'), 'fast')\"}",
    {
      userId: "user-1",
      workspaceId: "workspace-1",
    },
    {
      executeAgentSql: async () => ({
        data: {
          statementType: "insert",
          resource: "cards",
          sql: "INSERT INTO cards ...",
          normalizedSql: "INSERT INTO cards ...",
          rows: [],
          affectedCount: 1,
        },
        instructions: "done",
      }),
      createToolDependencies: () => {
        throw new Error("dependencies should not be used directly in this test");
      },
    },
  );

  assert.equal(result.succeeded, true);
  assert.equal(result.isMutating, true);
  assert.match(result.output, /"ok":true/);
});

test("executeChatToolCallWithDependencies returns error payloads and preserves read-only classification on failures", async () => {
  const result = await executeChatToolCallWithDependencies(
    "sql",
    "{\"sql\":\"SELECT * FROM cards\"}",
    {
      userId: "user-1",
      workspaceId: "workspace-1",
    },
    {
      executeAgentSql: async () => {
        throw new HttpError(400, "Bad SQL", "QUERY_INVALID_SQL");
      },
      createToolDependencies: () => {
        throw new Error("dependencies should not be used directly in this test");
      },
    },
  );

  assert.equal(result.succeeded, false);
  assert.equal(result.isMutating, false);
  assert.match(result.output, /"ok":false/);
  assert.match(result.output, /QUERY_INVALID_SQL/);
});
