import assert from "node:assert/strict";
import test from "node:test";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import {
  SQL_EXECUTE_TOOL_NAME,
  SQL_QUERY_TOOL_NAME,
} from "../aiTools/toolContract/sqlToolContract";
import type { AgentSqlContext, AgentSqlExecutionResult } from "../aiTools/agentSql/shared";
import type { AuthenticatedMcpAccessToken } from "../auth/mcpTokens";
import type { WorkspaceRequestContext } from "../server/requestContext";
import type { WorkspaceSummaryWithStats } from "../workspaces";
import {
  createMcpServerWithDependencies,
  type McpServerDependencies,
} from "./server";

const LIST_WORKSPACES_TOOL_NAME = "list_workspaces";
const RESOURCE_URL = "https://mcp.flashcards-open-source-app.com/mcp";
const WEBSITE_URL = "https://flashcards-open-source-app.com";
const ICON_URL = "https://mcp.flashcards-open-source-app.com/icon.svg";
const CALLER_USER_AGENT = "mcp-protocol-smoke/1.0.0";
const LEGACY_POSTGRES_WORKSPACE_ID = "35274129-ef97-d366-954c-955b4bb0fbf0";

type ResolveWorkspaceCall = Readonly<{
  requestContext: WorkspaceRequestContext;
  explicitWorkspaceId: string | undefined;
}>;

type SqlToolCall = Readonly<{
  context: AgentSqlContext;
  sql: string;
}>;

type ListWorkspacesCall = Readonly<{
  userId: string;
  selectedWorkspaceId: string | null;
}>;

type FakeDependencyCalls = {
  resolveAccessibleMcpWorkspaceIds: ResolveWorkspaceCall[];
  sqlQueries: SqlToolCall[];
  sqlExecutes: SqlToolCall[];
  listWorkspaces: ListWorkspacesCall[];
};

type JsonPrimitive = string | number | boolean | null;
type JsonValue = JsonPrimitive | JsonObject | ReadonlyArray<JsonValue>;

type JsonObject = {
  readonly [key: string]: JsonValue;
};

type AgentEnvelopeJson = Readonly<{
  ok: true;
  data: JsonObject;
  instructions: string;
  docs: Readonly<{
    discoveryUrl: string;
    source: Readonly<{
      repositoryUrl: string;
      agentRoutesUrl: string;
      authRoutesUrl: string;
    }>;
  }>;
}>;

type ClientToolList = Awaited<ReturnType<Client["listTools"]>>;
type ListedTool = ClientToolList["tools"][number];
type ClientToolResult = Awaited<ReturnType<Client["callTool"]>>;

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === "object" && value !== null && Array.isArray(value) === false;
}

function isJsonObject(value: unknown): value is JsonObject {
  return isRecord(value);
}

function readJsonObject(record: JsonObject, key: string): JsonObject {
  const value = record[key];
  assert.ok(isJsonObject(value), `Expected ${key} to be a JSON object`);
  return value;
}

function readJsonString(record: JsonObject, key: string): string {
  const value = record[key];
  if (typeof value !== "string") {
    throw new Error(`Expected ${key} to be a string`);
  }

  return value;
}

function parseAgentEnvelope(text: string): AgentEnvelopeJson {
  const value: unknown = JSON.parse(text);
  assert.ok(isJsonObject(value), "Expected tool result text to contain a JSON object");
  assert.equal(value.ok, true);

  const data = readJsonObject(value, "data");
  const instructions = readJsonString(value, "instructions");
  const docs = readJsonObject(value, "docs");
  const source = readJsonObject(docs, "source");

  return {
    ok: true,
    data,
    instructions,
    docs: {
      discoveryUrl: readJsonString(docs, "discoveryUrl"),
      source: {
        repositoryUrl: readJsonString(source, "repositoryUrl"),
        agentRoutesUrl: readJsonString(source, "agentRoutesUrl"),
        authRoutesUrl: readJsonString(source, "authRoutesUrl"),
      },
    },
  };
}

function readSingleTextContent(result: ClientToolResult): string {
  const resultRecord: Readonly<Record<string, unknown>> = result;
  assert.notEqual(resultRecord.isError, true, "Expected MCP tool call to succeed");
  assert.ok(Array.isArray(resultRecord.content), "Expected MCP tool call to return content");
  assert.equal(resultRecord.content.length, 1);

  const content = resultRecord.content[0];
  assert.notEqual(content, undefined);
  assert.ok(isRecord(content), "Expected MCP content item to be an object");

  if (content.type !== "text") {
    throw new Error(`Expected text content, received ${content.type}`);
  }

  const text = content.text;
  if (typeof text !== "string") {
    throw new Error("Expected text content item to include text.");
  }

  return text;
}

function requireTool(tools: ReadonlyArray<ListedTool>, name: string): ListedTool {
  const tool = tools.find((listedTool) => listedTool.name === name);
  if (tool === undefined) {
    throw new Error(`Expected ${name} tool to be listed`);
  }

  return tool;
}

function readWorkspaceIdInputSchema(tool: ListedTool): JsonObject {
  const inputSchema: unknown = tool.inputSchema;
  assert.ok(isJsonObject(inputSchema), `Expected ${tool.name} input schema to be an object`);
  const properties = readJsonObject(inputSchema, "properties");
  return readJsonObject(properties, "workspaceId");
}

function createFakeDependencyCalls(): FakeDependencyCalls {
  return {
    resolveAccessibleMcpWorkspaceIds: [],
    sqlQueries: [],
    sqlExecutes: [],
    listWorkspaces: [],
  };
}

function createFakeDependencies(
  calls: FakeDependencyCalls,
  workspaces: ReadonlyArray<WorkspaceSummaryWithStats>,
): McpServerDependencies {
  return {
    resolveAccessibleMcpWorkspaceId: async (
      requestContext: WorkspaceRequestContext,
      explicitWorkspaceId: string | undefined,
    ): Promise<string> => {
      calls.resolveAccessibleMcpWorkspaceIds.push({ requestContext, explicitWorkspaceId });

      if (explicitWorkspaceId !== undefined) {
        return explicitWorkspaceId;
      }

      if (requestContext.selectedWorkspaceId === null) {
        throw new Error("Fake MCP dependency requires a selected workspace for implicit resolution.");
      }

      return requestContext.selectedWorkspaceId;
    },
    runSqlQuery: async (
      context: AgentSqlContext,
      sql: string,
    ): Promise<AgentSqlExecutionResult> => {
      calls.sqlQueries.push({ context, sql });

      return {
        data: {
          statementType: "select",
          resource: "cards",
          sql,
          normalizedSql: sql,
          rows: [{
            card_id: "card-1",
            front_text: "Capital of France?",
            back_text: "Paris",
          }],
          rowCount: 1,
          limit: null,
          offset: null,
          hasMore: false,
        },
        instructions: "Use the returned rows to answer the user.",
      };
    },
    runSqlExecute: async (
      context: AgentSqlContext,
      sql: string,
    ): Promise<AgentSqlExecutionResult> => {
      calls.sqlExecutes.push({ context, sql });

      return {
        data: {
          statementType: "update",
          resource: "cards",
          sql,
          normalizedSql: sql,
          rows: [],
          affectedCount: 1,
        },
        instructions: "The mutation completed.",
      };
    },
    listUserWorkspacesWithStatsForSelectedWorkspace: async (
      userId: string,
      selectedWorkspaceId: string | null,
    ): Promise<ReadonlyArray<WorkspaceSummaryWithStats>> => {
      calls.listWorkspaces.push({ userId, selectedWorkspaceId });
      return workspaces;
    },
  };
}

test("MCP server exposes workspace and SQL tools through the protocol path", async () => {
  const selectedWorkspaceId = "11111111-1111-4111-8111-111111111111";
  const requestedWorkspaceId = LEGACY_POSTGRES_WORKSPACE_ID;
  const connection: AuthenticatedMcpAccessToken = {
    userId: "user-mcp-smoke",
    connectionId: "connection-mcp-smoke",
    selectedWorkspaceId,
  };
  const workspaces: ReadonlyArray<WorkspaceSummaryWithStats> = [{
    workspaceId: selectedWorkspaceId,
    name: "Personal",
    createdAt: "2026-01-01T00:00:00.000Z",
    isSelected: true,
    cardCount: 7,
    lastActivityAt: "2026-01-02T00:00:00.000Z",
  }, {
    workspaceId: requestedWorkspaceId,
    name: "Travel",
    createdAt: "2026-01-03T00:00:00.000Z",
    isSelected: false,
    cardCount: 3,
    lastActivityAt: null,
  }];
  const calls = createFakeDependencyCalls();
  const server = createMcpServerWithDependencies(
    connection,
    RESOURCE_URL,
    WEBSITE_URL,
    ICON_URL,
    CALLER_USER_AGENT,
    createFakeDependencies(calls, workspaces),
  );
  const client = new Client({ name: "mcp-protocol-smoke", version: "1.0.0" });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();

  await server.connect(serverTransport);
  await client.connect(clientTransport);

  try {
    const capabilities = client.getServerCapabilities();
    assert.equal(capabilities?.resources, undefined);

    const toolList = await client.listTools();
    const toolNames = toolList.tools.map((tool) => tool.name).sort();
    assert.deepEqual(toolNames, [
      LIST_WORKSPACES_TOOL_NAME,
      SQL_EXECUTE_TOOL_NAME,
      SQL_QUERY_TOOL_NAME,
    ]);
    assert.equal(toolNames.some((toolName) => toolName.includes("media_assets")), false);

    const sqlQueryTool = requireTool(toolList.tools, SQL_QUERY_TOOL_NAME);
    const sqlExecuteTool = requireTool(toolList.tools, SQL_EXECUTE_TOOL_NAME);
    assert.deepEqual(sqlQueryTool.annotations, {
      readOnlyHint: true,
      openWorldHint: false,
      idempotentHint: true,
    });
    assert.deepEqual(sqlExecuteTool.annotations, {
      readOnlyHint: false,
      destructiveHint: true,
      openWorldHint: false,
    });
    for (const tool of [sqlQueryTool, sqlExecuteTool]) {
      const workspaceIdSchema = readWorkspaceIdInputSchema(tool);
      assert.equal(readJsonString(workspaceIdSchema, "format"), "uuid", tool.name);
      const workspaceIdPattern = new RegExp(readJsonString(workspaceIdSchema, "pattern"));
      assert.equal(workspaceIdPattern.test(LEGACY_POSTGRES_WORKSPACE_ID), true, tool.name);
      assert.equal(workspaceIdPattern.test("not-a-uuid"), false, tool.name);
    }

    const listWorkspacesResult = await client.callTool({
      name: LIST_WORKSPACES_TOOL_NAME,
      arguments: {},
    });
    const listWorkspacesEnvelope = parseAgentEnvelope(readSingleTextContent(listWorkspacesResult));
    assert.deepEqual(listWorkspacesEnvelope.data, { workspaces });
    assert.notEqual(listWorkspacesEnvelope.instructions, "");
    assert.notEqual(listWorkspacesEnvelope.docs.discoveryUrl, "");
    assert.notEqual(listWorkspacesEnvelope.docs.source.repositoryUrl, "");

    const sql = "SELECT card_id, front_text, back_text FROM cards LIMIT 1";
    const sqlQueryResult = await client.callTool({
      name: SQL_QUERY_TOOL_NAME,
      arguments: { sql, workspaceId: requestedWorkspaceId },
    });
    const sqlQueryEnvelope = parseAgentEnvelope(readSingleTextContent(sqlQueryResult));
    assert.equal(sqlQueryEnvelope.data.sql, sql);
    assert.notEqual(sqlQueryEnvelope.instructions, "");
    assert.notEqual(sqlQueryEnvelope.docs.discoveryUrl, "");
    assert.notEqual(sqlQueryEnvelope.docs.source.agentRoutesUrl, "");

    const executeSql = "UPDATE cards SET back_text = 'Paris' WHERE card_id = 'card-1'";
    const sqlExecuteResult = await client.callTool({
      name: SQL_EXECUTE_TOOL_NAME,
      arguments: { sql: executeSql, workspaceId: requestedWorkspaceId },
    });
    const sqlExecuteEnvelope = parseAgentEnvelope(readSingleTextContent(sqlExecuteResult));
    assert.equal(sqlExecuteEnvelope.data.sql, executeSql);
    assert.notEqual(sqlExecuteEnvelope.instructions, "");
    assert.notEqual(sqlExecuteEnvelope.docs.discoveryUrl, "");
    assert.notEqual(sqlExecuteEnvelope.docs.source.authRoutesUrl, "");

    assert.deepEqual(calls.listWorkspaces, [{
      userId: connection.userId,
      selectedWorkspaceId: connection.selectedWorkspaceId,
    }]);
    assert.deepEqual(calls.resolveAccessibleMcpWorkspaceIds, [
      {
        requestContext: {
          userId: connection.userId,
          selectedWorkspaceId: connection.selectedWorkspaceId,
        },
        explicitWorkspaceId: requestedWorkspaceId,
      },
      {
        requestContext: {
          userId: connection.userId,
          selectedWorkspaceId: connection.selectedWorkspaceId,
        },
        explicitWorkspaceId: requestedWorkspaceId,
      },
    ]);
    assert.deepEqual(calls.sqlQueries, [{
      context: {
        userId: connection.userId,
        workspaceId: requestedWorkspaceId,
        selectedWorkspaceId: connection.selectedWorkspaceId,
        connectionId: connection.connectionId,
        surface: "mcp",
        caller: CALLER_USER_AGENT,
      },
      sql,
    }]);
    assert.deepEqual(calls.sqlExecutes, [{
      context: {
        userId: connection.userId,
        workspaceId: requestedWorkspaceId,
        selectedWorkspaceId: connection.selectedWorkspaceId,
        connectionId: connection.connectionId,
        surface: "mcp",
        caller: CALLER_USER_AGENT,
      },
      sql: executeSql,
    }]);
  } finally {
    await client.close();
    await server.close();
  }
});

test("MCP SQL tools reject malformed workspace IDs before access resolution", async () => {
  const selectedWorkspaceId = "11111111-1111-4111-8111-111111111111";
  const connection: AuthenticatedMcpAccessToken = {
    userId: "user-mcp-smoke",
    connectionId: "connection-mcp-smoke",
    selectedWorkspaceId,
  };
  const calls = createFakeDependencyCalls();
  const server = createMcpServerWithDependencies(
    connection,
    RESOURCE_URL,
    WEBSITE_URL,
    ICON_URL,
    CALLER_USER_AGENT,
    createFakeDependencies(calls, []),
  );
  const client = new Client({ name: "mcp-protocol-smoke", version: "1.0.0" });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();

  await server.connect(serverTransport);
  await client.connect(clientTransport);

  try {
    for (const toolCall of [
      {
        name: SQL_QUERY_TOOL_NAME,
        sql: "SELECT * FROM cards LIMIT 1",
      },
      {
        name: SQL_EXECUTE_TOOL_NAME,
        sql: "DELETE FROM cards WHERE card_id = 'card-1'",
      },
    ]) {
      const result = await client.callTool({
        name: toolCall.name,
        arguments: { sql: toolCall.sql, workspaceId: "not-a-uuid" },
      });
      assert.equal(result.isError, true, toolCall.name);
    }

    assert.deepEqual(calls.resolveAccessibleMcpWorkspaceIds, []);
    assert.deepEqual(calls.sqlQueries, []);
    assert.deepEqual(calls.sqlExecutes, []);
  } finally {
    await client.close();
    await server.close();
  }
});
