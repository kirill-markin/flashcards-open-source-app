import assert from "node:assert/strict";
import test from "node:test";
import { loadOpenApiDocument } from "./openapi";

test("loadOpenApiDocument returns the canonical v1 spec", () => {
  const document = loadOpenApiDocument();
  const paths = document.paths as Record<string, unknown>;
  const components = document.components as { schemas: Record<string, unknown> };
  const getCardsInput = components.schemas.GetCardsInput as {
    properties: {
      cardIds: {
        items: Record<string, unknown>;
      };
    };
  };
  const agentErrorEnvelope = components.schemas.AgentErrorEnvelope as {
    properties: {
      error: Record<string, unknown>;
    };
  };

  assert.equal(document.openapi, "3.1.0");
  assert.ok(document.paths);
  assert.ok(document.components);
  assert.ok("/" in paths);
  assert.ok("/agent/tools/list_cards" in paths);
  assert.ok("/agent/workspaces" in paths);
  assert.equal("/workspaces/{workspaceId}/cards/query" in paths, false);
  assert.equal("/workspaces/{workspaceId}/sync/push" in paths, false);
  assert.equal("/chat/local-turn" in paths, false);
  assert.equal("/agent-api-keys" in paths, false);
  assert.deepEqual(getCardsInput.properties.cardIds.items, {
    $ref: "#/components/schemas/UuidString",
  });
  assert.ok("error" in agentErrorEnvelope.properties);
});
