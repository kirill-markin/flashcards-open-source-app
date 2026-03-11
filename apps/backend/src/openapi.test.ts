import assert from "node:assert/strict";
import test from "node:test";
import { loadOpenApiDocument } from "./openapi";

test("loadOpenApiDocument returns the canonical v1 spec", () => {
  const document = loadOpenApiDocument();
  const paths = document.paths as Record<string, Record<string, {
    requestBody?: {
      content?: Record<string, {
        schema?: Record<string, unknown>;
        example?: Record<string, unknown>;
      }>;
    };
    responses?: Record<string, {
      content?: Record<string, {
        schema?: Record<string, unknown>;
        example?: Record<string, unknown>;
      }>;
    }>;
  }>>;
  const components = document.components as { schemas: Record<string, unknown> };
  const getCardsInput = components.schemas.GetCardsInput as {
    properties: {
      cardIds: {
        items: Record<string, unknown>;
      };
    };
  };
  const createCardBody = components.schemas.CreateCardBody as {
    properties: {
      frontText: {
        description: string;
      };
      backText: {
        description: string;
      };
    };
  };
  const updateCardBody = components.schemas.UpdateCardBody as {
    properties: {
      frontText: {
        description: string;
      };
      backText: {
        description: string;
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
  assert.ok("/agent/tools/list_tags" in paths);
  assert.ok("/agent/tools/list_cards" in paths);
  assert.ok("/agent/workspaces" in paths);
  assert.equal("/workspaces/{workspaceId}/cards/query" in paths, false);
  assert.equal("/workspaces/{workspaceId}/sync/push" in paths, false);
  assert.equal("/chat/local-turn" in paths, false);
  assert.equal("/agent-api-keys" in paths, false);
  assert.deepEqual(getCardsInput.properties.cardIds.items, {
    $ref: "#/components/schemas/UuidString",
  });
  assert.match(createCardBody.properties.frontText.description, /question-only recall prompt/i);
  assert.match(createCardBody.properties.backText.description, /must contain the answer/i);
  assert.match(updateCardBody.properties.frontText.description, /question-only recall prompt/i);
  assert.match(updateCardBody.properties.backText.description, /must contain the answer/i);
  assert.ok("error" in agentErrorEnvelope.properties);

  for (const [path, methods] of Object.entries(paths)) {
    for (const [method, operation] of Object.entries(methods)) {
      const successResponses = operation.responses === undefined
        ? []
        : Object.entries(operation.responses).filter(([statusCode]) => statusCode === "200" || statusCode === "201");

      for (const [statusCode, response] of successResponses) {
        const jsonContent = response.content?.["application/json"];
        assert.ok(jsonContent !== undefined, `${method.toUpperCase()} ${path} ${statusCode} must define application/json content`);
        assert.ok(jsonContent.schema !== undefined, `${method.toUpperCase()} ${path} ${statusCode} must define an application/json schema`);
        assert.ok(jsonContent.example !== undefined, `${method.toUpperCase()} ${path} ${statusCode} must define an application/json example`);
      }
    }
  }

  const discoveryExample = paths["/agent"]?.get?.responses?.["200"]?.content?.["application/json"]?.example;
  assert.ok(discoveryExample !== undefined);
  assert.ok("data" in discoveryExample);
  assert.ok("authBaseUrl" in (discoveryExample.data as Record<string, unknown>));

  const workspacesExample = paths["/agent/workspaces"]?.get?.responses?.["200"]?.content?.["application/json"]?.example;
  assert.ok(workspacesExample !== undefined);
  assert.ok("data" in workspacesExample);
  assert.ok(Array.isArray((workspacesExample.data as Record<string, unknown>).workspaces));
  assert.ok("nextCursor" in (workspacesExample.data as Record<string, unknown>));

  const listCardsExample = paths["/agent/tools/list_cards"]?.post?.responses?.["200"]?.content?.["application/json"]?.example;
  assert.ok(listCardsExample !== undefined);
  assert.ok("data" in listCardsExample);
  assert.ok(Array.isArray((listCardsExample.data as Record<string, unknown>).cards));
  assert.ok("nextCursor" in (listCardsExample.data as Record<string, unknown>));

  const listCardsRequestSchema = paths["/agent/tools/list_cards"]?.post?.requestBody?.content?.["application/json"]?.schema;
  assert.deepEqual(listCardsRequestSchema, { $ref: "#/components/schemas/CardCursorPageInput" });

  const searchCardsRequestSchema = paths["/agent/tools/search_cards"]?.post?.requestBody?.content?.["application/json"]?.schema;
  assert.deepEqual(searchCardsRequestSchema, { $ref: "#/components/schemas/CardCursorSearchInput" });

  const listTagsExample = paths["/agent/tools/list_tags"]?.post?.responses?.["200"]?.content?.["application/json"]?.example;
  assert.ok(listTagsExample !== undefined);
  assert.ok("data" in listTagsExample);
  assert.ok(Array.isArray((listTagsExample.data as Record<string, unknown>).tags));
  assert.ok("totalCards" in (listTagsExample.data as Record<string, unknown>));
});
