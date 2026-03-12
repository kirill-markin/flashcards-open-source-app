import assert from "node:assert/strict";
import test from "node:test";
import { loadOpenApiDocument } from "./openapi";

test("loadOpenApiDocument returns the canonical v1 spec with the SQL surface", () => {
  const document = loadOpenApiDocument();
  const paths = document.paths as Record<string, Record<string, {
    requestBody?: {
      content?: Record<string, {
        schema?: Record<string, unknown>;
      }>;
    };
    responses?: Record<string, {
      content?: Record<string, {
        schema?: Record<string, unknown>;
        example?: Record<string, unknown>;
        examples?: Record<string, unknown>;
      }>;
    }>;
  }>>;
  const components = document.components as { schemas: Record<string, unknown> };
  const agentDocs = components.schemas.AgentDocs as {
    required: ReadonlyArray<string>;
    properties: Record<string, unknown>;
  };
  const agentSqlRequest = components.schemas.AgentSqlRequest as {
    required: ReadonlyArray<string>;
    properties: Record<string, unknown>;
  };
  const agentSqlEnvelope = components.schemas.AgentSqlEnvelope as {
    properties: Record<string, unknown>;
  };
  const agentErrorEnvelope = components.schemas.AgentErrorEnvelope as {
    properties: {
      error: Record<string, unknown>;
    };
  };

  assert.equal(document.openapi, "3.1.0");
  assert.ok("/" in paths);
  assert.ok("/agent/sql" in paths);
  assert.ok("/agent/workspaces" in paths);
  assert.equal("/agent/tools/list_cards" in paths, false);
  assert.equal("/agent/tools/list_tags" in paths, false);
  assert.equal("/workspaces/{workspaceId}/sync/push" in paths, false);
  assert.equal("/chat/local-turn" in paths, false);
  assert.equal("/agent-api-keys" in paths, false);
  assert.deepEqual(agentDocs.required, ["openapiUrl"]);
  assert.deepEqual(agentSqlRequest.required, ["sql"]);
  assert.ok("data" in agentSqlEnvelope.properties);
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
        assert.ok(
          jsonContent.example !== undefined || jsonContent.examples !== undefined,
          `${method.toUpperCase()} ${path} ${statusCode} must define an application/json example`,
        );
      }
    }
  }

  const discoveryExample = paths["/agent"]?.get?.responses?.["200"]?.content?.["application/json"]?.example;
  assert.ok(discoveryExample !== undefined);
  assert.ok("data" in discoveryExample);
  assert.ok("surface" in (discoveryExample.data as Record<string, unknown>));

  const workspacesExample = paths["/agent/workspaces"]?.get?.responses?.["200"]?.content?.["application/json"]?.example;
  assert.ok(workspacesExample !== undefined);
  assert.ok("data" in workspacesExample);
  assert.ok(Array.isArray((workspacesExample.data as Record<string, unknown>).workspaces));
  assert.ok("nextCursor" in (workspacesExample.data as Record<string, unknown>));

  const sqlRequestSchema = paths["/agent/sql"]?.post?.requestBody?.content?.["application/json"]?.schema;
  assert.deepEqual(sqlRequestSchema, { $ref: "#/components/schemas/AgentSqlRequest" });
  const sqlExamples = paths["/agent/sql"]?.post?.responses?.["200"]?.content?.["application/json"]?.examples;
  assert.ok(sqlExamples !== undefined);
});
