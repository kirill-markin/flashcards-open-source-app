import assert from "node:assert/strict";
import test from "node:test";
import { OPENAI_LOCAL_FLASHCARDS_TOOLS } from "./chat/openai/localTools";

type ObjectToolParameters = Readonly<{
  type: "object";
  properties: Readonly<Record<string, unknown>>;
  required: ReadonlyArray<string>;
}>;

test("all strict local tool object schemas declare every property in required", () => {
  for (const tool of OPENAI_LOCAL_FLASHCARDS_TOOLS) {
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

test("removed local write tools stay out of the canonical local tool contract", () => {
  const toolNames = OPENAI_LOCAL_FLASHCARDS_TOOLS.map((tool) => tool.name);

  assert.equal(toolNames.includes("submit_review"), false);
  assert.equal(toolNames.includes("update_scheduler_settings"), false);
});
