import assert from "node:assert/strict";
import test from "node:test";
import { createAgentDiscoveryEnvelope } from "./agentDiscovery";

test("createAgentDiscoveryEnvelope points agents to auth on the API custom domain", () => {
  process.env.PUBLIC_API_BASE_URL = "https://api.example.com/v1";
  process.env.PUBLIC_AUTH_BASE_URL = "https://auth.example.com";

  const envelope = createAgentDiscoveryEnvelope("https://api.example.com/v1/agent");

  assert.equal(envelope.ok, true);
  assert.equal(envelope.data.authBaseUrl, "https://auth.example.com");
  assert.equal(envelope.data.apiBaseUrl, "https://api.example.com/v1");
  assert.deepEqual(envelope.data.docs, {
    openapiUrl: "https://api.example.com/v1/agent/openapi.json",
    swaggerUrl: "https://api.example.com/v1/agent/swagger.json",
  });
  assert.equal(
    envelope.data.authentication.registerAndLogin,
    "Ask which email the user wants to use, then start the same flow for both new and existing users.",
  );
  assert.deepEqual(envelope.actions, [
    {
      name: "send_code",
      method: "POST",
      url: "https://auth.example.com/api/agent/send-code",
      input: {
        required: ["email"],
      },
    },
    {
      name: "openapi",
      method: "GET",
      url: "https://api.example.com/v1/agent/openapi.json",
    },
  ]);
  assert.equal(
    envelope.instructions,
    "Start with send_code. After login, call https://api.example.com/v1/agent/me, then https://api.example.com/v1/agent/workspaces. If no workspaces exist, call POST https://api.example.com/v1/agent/workspaces with {\"name\":\"Personal\"}. If multiple workspaces exist and no workspace is selected for this API key, call POST https://api.example.com/v1/agent/workspaces/{workspaceId}/select before tool calls.",
  );
});

test("createAgentDiscoveryEnvelope derives localhost URLs when public env is missing", () => {
  delete process.env.PUBLIC_API_BASE_URL;
  delete process.env.PUBLIC_AUTH_BASE_URL;

  const envelope = createAgentDiscoveryEnvelope("http://localhost:8080/agent");

  assert.equal(envelope.data.authBaseUrl, "http://localhost:8081");
  assert.equal(envelope.data.apiBaseUrl, "http://localhost:8080/v1");
  assert.equal(envelope.data.docs.openapiUrl, "http://localhost:8080/v1/agent/openapi.json");
});
