import assert from "node:assert/strict";
import test from "node:test";
import { HttpError } from "./errors";
import { parseAgentApiKey } from "./agentApiKeys";

test("parseAgentApiKey splits the key identifier and secret", () => {
  assert.deepEqual(parseAgentApiKey("fca_live_key123_secret456"), {
    keyId: "key123",
    secret: "secret456",
  });
});

test("parseAgentApiKey rejects malformed keys", () => {
  assert.throws(
    () => parseAgentApiKey("bad-key"),
    (error: unknown) => error instanceof HttpError && error.code === "AGENT_API_KEY_INVALID",
  );
});
