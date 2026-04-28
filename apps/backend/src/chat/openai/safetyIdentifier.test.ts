import assert from "node:assert/strict";
import test from "node:test";
import { buildOpenAISafetyIdentifier } from "./safetyIdentifier";

test("buildOpenAISafetyIdentifier hashes a normal app user id deterministically", () => {
  const identifier = buildOpenAISafetyIdentifier("user-1");

  assert.equal(identifier, "v1_xsKJ5J6cBbIUWGA4e3O8sY30P7CaHkpKlxPHbIi7VBs");
  assert.equal(identifier.length <= 64, true);
});

test("buildOpenAISafetyIdentifier hashes a guest-style uuid deterministically", () => {
  const identifier = buildOpenAISafetyIdentifier("f47ac10b-58cc-4372-a567-0e02b2c3d479");

  assert.equal(identifier, "v1_j0AMJXYR7V0wwOZgesYQdDB9-iTPcKjpLD6BR9Z9LHA");
  assert.equal(identifier.length <= 64, true);
});

test("buildOpenAISafetyIdentifier rejects empty user ids", () => {
  assert.throws(
    () => buildOpenAISafetyIdentifier("   "),
    /OpenAI safety identifier source userId must not be empty/,
  );
});
