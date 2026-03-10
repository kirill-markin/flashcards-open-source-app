import assert from "node:assert/strict";
import test from "node:test";
import { HttpError } from "./errors";
import { parseAgentApiKey } from "./agentApiKeys";

test("parseAgentApiKey splits the key identifier and secret", () => {
  assert.deepEqual(parseAgentApiKey("fca_abcd-ef12_0123 456789ABCDEFGHJKMNPQRS"), {
    keyId: "ABCDEF12",
    secret: "0123456789ABCDEFGHJKMNPQRS",
  });
});

test("parseAgentApiKey rejects malformed keys", () => {
  assert.throws(
    () => parseAgentApiKey("bad-key"),
    (error: unknown) => error instanceof HttpError && error.code === "AGENT_API_KEY_INVALID",
  );
});
