import assert from "node:assert/strict";
import test from "node:test";
import { OPENAI_AI_CHAT_TOOLS } from "./chat/openai/aiChatTools";

type ObjectToolParameters = Readonly<{
  type: "object";
  properties: Readonly<Record<string, unknown>>;
  required: ReadonlyArray<string>;
}>;

test("all AI chat tool object schemas declare every property in required", () => {
  for (const tool of OPENAI_AI_CHAT_TOOLS) {
    const rawParameters = tool.parameters as ObjectToolParameters | null;
    if (rawParameters === null) {
      throw new Error(`Tool ${tool.name} is missing parameters`);
    }

    const parameters = rawParameters;
    assert.equal(parameters.type, "object");

    const propertyNames = Object.keys(parameters.properties);
    const requiredNames = [...parameters.required].sort();

    assert.deepEqual(requiredNames, [...propertyNames].sort(), `Tool ${tool.name} has mismatched required fields`);
  }
});

test("only backend-executed SQL remains in the AI chat tool contract", () => {
  const toolNames = OPENAI_AI_CHAT_TOOLS.map((tool) => tool.name);

  assert.equal(toolNames.includes("submit_review"), false);
  assert.equal(toolNames.includes("update_scheduler_settings"), false);
  assert.deepEqual(toolNames.sort(), ["sql"]);
});
