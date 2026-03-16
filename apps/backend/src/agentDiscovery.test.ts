import assert from "node:assert/strict";
import test from "node:test";
import { createAgentDiscoveryEnvelope } from "./agentDiscovery";

test("createAgentDiscoveryEnvelope points agents to auth, bootstrap, and SQL discovery", () => {
  process.env.PUBLIC_API_BASE_URL = "https://api.example.com/v1";
  process.env.PUBLIC_AUTH_BASE_URL = "https://auth.example.com";

  const envelope = createAgentDiscoveryEnvelope("https://api.example.com/v1/agent");

  assert.equal(envelope.ok, true);
  assert.equal(envelope.data.authentication.sendCodeUrl, "https://auth.example.com/api/agent/send-code");
  assert.equal(envelope.data.authentication.verifyCodeUrl, "https://auth.example.com/api/agent/verify-code");
  assert.equal(envelope.data.surface.accountUrl, "https://api.example.com/v1/agent/me");
  assert.equal(envelope.data.surface.workspacesUrl, "https://api.example.com/v1/agent/workspaces");
  assert.equal(envelope.data.surface.sqlUrl, "https://api.example.com/v1/agent/sql");
  assert.deepEqual(envelope.docs, {
    openapiUrl: "https://api.example.com/v1/agent/openapi.json",
  });
  assert.match(envelope.instructions, /send-code/);
  assert.match(envelope.instructions, /verify-code/);
  assert.match(envelope.instructions, /\/agent\/sql/);
  assert.match(envelope.instructions, /split the work into multiple batches of at most 100 records/i);
  assert.match(envelope.instructions, /intentionally limited/i);
});

test("createAgentDiscoveryEnvelope derives localhost URLs when public env is missing", () => {
  delete process.env.PUBLIC_API_BASE_URL;
  delete process.env.PUBLIC_AUTH_BASE_URL;

  const envelope = createAgentDiscoveryEnvelope("http://localhost:8080/agent");

  assert.equal(envelope.data.authentication.sendCodeUrl, "http://localhost:8081/api/agent/send-code");
  assert.equal(envelope.data.authentication.verifyCodeUrl, "http://localhost:8081/api/agent/verify-code");
  assert.equal(envelope.docs.openapiUrl, "http://localhost:8080/v1/agent/openapi.json");
});
