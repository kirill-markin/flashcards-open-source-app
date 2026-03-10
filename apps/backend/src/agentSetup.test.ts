import assert from "node:assert/strict";
import test from "node:test";
import {
  createAgentAccountEnvelope,
  createAgentConnectionManagementErrorEnvelope,
  createAgentSetupErrorEnvelope,
  createAgentWorkspaceReadyEnvelope,
  createAgentWorkspacesEnvelope,
  shouldUseAgentSetupEnvelope,
} from "./agentSetup";

test("shouldUseAgentSetupEnvelope only enables the envelope for api keys", () => {
  assert.equal(shouldUseAgentSetupEnvelope("api_key"), true);
  assert.equal(shouldUseAgentSetupEnvelope("bearer"), false);
  assert.equal(shouldUseAgentSetupEnvelope("session"), false);
});

test("createAgentAccountEnvelope points the agent to load workspaces next", () => {
  process.env.PUBLIC_API_BASE_URL = "https://api.example.com/v1";

  const envelope = createAgentAccountEnvelope("https://api.example.com/v1/agent/me", {
    userId: "user-1",
    transport: "api_key",
    connectionId: "connection-1",
    selectedWorkspaceId: null,
    email: "kirill@example.com",
    locale: "en",
    userSettingsCreatedAt: "2026-03-10T12:00:00.000Z",
  });

  assert.deepEqual(envelope.actions, [{
    name: "list_workspaces",
    method: "GET",
    url: "https://api.example.com/v1/agent/workspaces",
    auth: {
      scheme: "ApiKey",
    },
  }]);
});

test("createAgentWorkspacesEnvelope guides workspace creation when none exist", () => {
  process.env.PUBLIC_API_BASE_URL = "https://api.example.com/v1";

  const envelope = createAgentWorkspacesEnvelope("https://api.example.com/v1/agent/workspaces", []);

  assert.equal(envelope.actions[0]?.name, "create_workspace");
  assert.equal(envelope.actions[0]?.url, "https://api.example.com/v1/agent/workspaces");
});

test("createAgentWorkspacesEnvelope requires selection when several workspaces exist and none is selected", () => {
  process.env.PUBLIC_API_BASE_URL = "https://api.example.com/v1";

  const envelope = createAgentWorkspacesEnvelope("https://api.example.com/v1/agent/workspaces", [
    {
      workspaceId: "ws-1",
      name: "Spanish",
      createdAt: "2026-03-10T12:00:00.000Z",
      isSelected: false,
    },
    {
      workspaceId: "ws-2",
      name: "German",
      createdAt: "2026-03-10T12:01:00.000Z",
      isSelected: false,
    },
  ]);

  assert.equal(envelope.actions[0]?.name, "select_workspace");
  assert.equal(
    envelope.actions[0]?.urlTemplate,
    "https://api.example.com/v1/agent/workspaces/{workspaceId}/select",
  );
});

test("createAgentWorkspaceReadyEnvelope keeps the workspace in data", () => {
  process.env.PUBLIC_API_BASE_URL = "https://api.example.com/v1";

  const envelope = createAgentWorkspaceReadyEnvelope("https://api.example.com/v1/agent/workspaces/ws-1/select", {
    workspaceId: "ws-1",
    name: "Spanish",
    createdAt: "2026-03-10T12:00:00.000Z",
    isSelected: true,
  });

  assert.equal(envelope.data.workspace.workspaceId, "ws-1");
  assert.equal(envelope.actions[0]?.name, "list_tools");
});

test("createAgentSetupErrorEnvelope keeps actionable retry instructions", () => {
  process.env.PUBLIC_API_BASE_URL = "https://api.example.com/v1";

  const envelope = createAgentSetupErrorEnvelope(
    "https://api.example.com/v1/agent/tools/list_cards",
    "WORKSPACE_SELECTION_REQUIRED",
    "Select a workspace before using this endpoint",
    "Call GET /v1/agent/workspaces and then POST /v1/agent/workspaces/{workspaceId}/select.",
    "request-1",
  );

  assert.equal(envelope.ok, false);
  assert.equal(envelope.error.code, "WORKSPACE_SELECTION_REQUIRED");
  assert.equal(envelope.requestId, "request-1");
  assert.equal(envelope.docs.openapiUrl, "https://api.example.com/v1/agent/openapi.json");
});

test("createAgentConnectionManagementErrorEnvelope includes human-session guidance", () => {
  const envelope = createAgentConnectionManagementErrorEnvelope(
    "AGENT_API_KEY_HUMAN_SESSION_REQUIRED",
    "Agent connections must be managed from a human session",
    "Manage long-lived bot connections from a human browser or mobile session.",
    "request-2",
  );

  assert.equal(envelope.ok, false);
  assert.equal(envelope.error.code, "AGENT_API_KEY_HUMAN_SESSION_REQUIRED");
  assert.equal(envelope.requestId, "request-2");
});
