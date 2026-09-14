import assert from "node:assert/strict";
import test from "node:test";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { getEncoding } from "js-tiktoken";
import {
  MAX_ALL_TOOLS_METADATA_TOKENS,
  MAX_PREFIXED_TOOL_NAME_CHARS,
  MAX_SERVER_INSTRUCTIONS_CHARS,
  MAX_TOOL_DESCRIPTION_CHARS,
  MAX_TOOL_FIELD_DESCRIPTION_CHARS,
} from "../aiTools/toolContract/sqlToolLimits";
import type { AuthenticatedMcpAccessToken } from "../auth/mcpTokens";
import { buildOpenAIChatTools } from "../chat/openai/tools/tools";
import {
  createMcpServerWithDependencies,
  type McpRequestTelemetryChannel,
  type McpServerDependencies,
} from "./server";

const RESOURCE_URL = "https://mcp.flashcards-open-source-app.com/mcp";
const WEBSITE_URL = "https://flashcards-open-source-app.com";
const ICON_URL = "https://mcp.flashcards-open-source-app.com/icon.svg";
const CALLER_USER_AGENT = "mcp-tool-budget-guard/1.0.0";

/**
 * How a client namespaces an MCP tool before the model ever sees the name:
 * `mcp__<server name>__<tool name>`.
 */
const CLIENT_TOOL_NAME_PREFIX = "mcp__";
const CLIENT_TOOL_NAME_SEPARATOR = "__";

/**
 * OpenAI's tokenizer for the current model generation. The budget this test
 * guards is a ChatGPT-side one, and Anthropic publishes no tokenizer that runs
 * offline, so the token count is deliberately an OpenAI-only measurement.
 */
const TOKEN_ENCODING = "o200k_base";

/**
 * These stubs exist for metadata listing only: every assertion below reads
 * `tools/list` metadata and the `initialize` instructions, so no tool handler
 * runs and none of these is ever reached. If a future assertion does invoke a
 * tool, the stub's failure comes back as a resolved `CallToolResult` carrying
 * `isError: true`, so that assertion must check
 * `isError` rather than expect a rejection.
 */
const UNREACHED_DEPENDENCIES: McpServerDependencies = {
  nextReviewCard: async () => {
    throw new Error("Unexpected dependency call during a metadata-only listing");
  },
  revealAnswer: async () => {
    throw new Error("Unexpected dependency call during a metadata-only listing");
  },
  submitAgentReview: async () => {
    throw new Error("Unexpected dependency call during a metadata-only listing");
  },
  resolveAccessibleMcpWorkspaceId: async () => {
    throw new Error("Unexpected dependency call during a metadata-only listing");
  },
  runSqlQuery: async () => {
    throw new Error("Unexpected dependency call during a metadata-only listing");
  },
  runSqlExecute: async () => {
    throw new Error("Unexpected dependency call during a metadata-only listing");
  },
  listUserWorkspacesWithStatsForSelectedWorkspace: async () => {
    throw new Error("Unexpected dependency call during a metadata-only listing");
  },
};

const UNREACHED_TELEMETRY: McpRequestTelemetryChannel = {
  caller: CALLER_USER_AGENT,
  recordInvokedTool: () => {
    throw new Error("Unexpected tool invocation during a metadata-only listing");
  },
};

/** JSON-schema keywords whose value is a map of name to sub-schema. */
const SCHEMA_MAP_KEYWORDS = ["properties", "patternProperties", "$defs", "definitions"] as const;

/** JSON-schema keywords whose value is a sub-schema, or an array of sub-schemas. */
const SCHEMA_KEYWORDS = [
  "items",
  "prefixItems",
  "additionalItems",
  "additionalProperties",
  "contains",
  "propertyNames",
  "not",
  "anyOf",
  "oneOf",
  "allOf",
] as const;

type SchemaDescription = Readonly<{
  pointer: string;
  description: string;
}>;

function assertWithinBudget(
  subject: string,
  measured: number,
  budget: number,
  unit: string,
): void {
  assert.ok(
    measured <= budget,
    `${subject} is ${measured} ${unit}, over its ${budget} ${unit} budget by ${measured - budget}.`,
  );
}

/** RFC 6901 escaping, so a field named `a/b` cannot forge a pointer segment. */
function escapeJsonPointerSegment(segment: string): string {
  return segment.replace(/~/gu, "~0").replace(/\//gu, "~1");
}

/** The schema root's JSON pointer is the empty string; name it readably. */
function describeJsonPointer(pointer: string): string {
  return pointer === "" ? "(root)" : pointer;
}

function readSchemaDescription(fieldSchema: unknown): string | undefined {
  if (typeof fieldSchema !== "object" || fieldSchema === null || Array.isArray(fieldSchema)) {
    return undefined;
  }

  const description: unknown = Reflect.get(fieldSchema, "description");
  return typeof description === "string" ? description : undefined;
}

/**
 * Collects every `description` reachable from a schema root, together with its
 * JSON pointer.
 *
 * Callers seed it at the root rather than per property: zod hoists an extracted
 * sub-schema's whole body — every nested `description` with it — into root
 * `definitions` and leaves a bare `$ref` behind, and `$ref` is not followed, so
 * a per-property walk would never see that text. A description on the root
 * schema itself is measured the same way, against the field sub-budget.
 *
 * The walk is recursive because a description on a nested object, on an array's
 * `items`, or on a union branch is spent out of the same `tools/list` budget as
 * a top-level one. A schema node may legally be a boolean, a string or an array
 * rather than an object, so anything that is not a plain object is skipped
 * instead of read. `visited` makes each node contribute exactly once: the same
 * object can be reachable under several pointers once reused schemas or `$defs`
 * appear, and one over-budget description must produce exactly one failure.
 */
function collectSchemaDescriptions(
  node: unknown,
  pointer: string,
  visited: WeakSet<object>,
  collected: SchemaDescription[],
): void {
  if (typeof node !== "object" || node === null || Array.isArray(node)) {
    return;
  }
  if (visited.has(node)) {
    return;
  }
  visited.add(node);

  const description = readSchemaDescription(node);
  if (description !== undefined) {
    collected.push({ pointer, description });
  }

  for (const keyword of SCHEMA_MAP_KEYWORDS) {
    const subSchemaMap: unknown = Reflect.get(node, keyword);
    if (typeof subSchemaMap !== "object" || subSchemaMap === null || Array.isArray(subSchemaMap)) {
      continue;
    }

    for (const [name, subSchema] of Object.entries(subSchemaMap)) {
      collectSchemaDescriptions(
        subSchema,
        `${pointer}/${keyword}/${escapeJsonPointerSegment(name)}`,
        visited,
        collected,
      );
    }
  }

  for (const keyword of SCHEMA_KEYWORDS) {
    const subSchema: unknown = Reflect.get(node, keyword);
    if (Array.isArray(subSchema)) {
      subSchema.forEach((entry: unknown, index: number) => {
        collectSchemaDescriptions(entry, `${pointer}/${keyword}/${index}`, visited, collected);
      });
      continue;
    }

    collectSchemaDescriptions(subSchema, `${pointer}/${keyword}`, visited, collected);
  }
}

/**
 * Guards the published client budgets against a tool surface that silently
 * grows back over them.
 *
 * It measures the real `tools/list` response rather than the exported
 * description constants: today every tool is registered with its bare constant
 * and nothing is appended, so the two coincide, but reading the wire response
 * keeps the guard honest if an append site is ever reintroduced. That is how
 * the surface got oversized in the first place.
 *
 * `sql_execute` is the one to watch. It renders both `MAX_SQL_RECORD_LIMIT` and
 * `MAX_SQL_BATCH_STATEMENT_COUNT` inline, so widening either constant by one
 * digit costs a character and widening both lands exactly on the cap.
 */
test("MCP tool metadata stays inside the published client budgets", async () => {
  const connection: AuthenticatedMcpAccessToken = {
    userId: "user-tool-budget-guard",
    connectionId: "connection-tool-budget-guard",
    selectedWorkspaceId: "11111111-1111-4111-8111-111111111111",
  };
  const server = createMcpServerWithDependencies(
    connection,
    RESOURCE_URL,
    WEBSITE_URL,
    ICON_URL,
    UNREACHED_TELEMETRY,
    UNREACHED_DEPENDENCIES,
  );
  const client = new Client({ name: "mcp-tool-budget-guard", version: "1.0.0" });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();

  await server.connect(serverTransport);
  await client.connect(clientTransport);

  try {
    const toolList = await client.listTools();
    assert.ok(toolList.tools.length > 0, "Expected the server to list at least one tool");

    // Count the whole serialized response, not name plus description plus input
    // schema: a host adds its own per-tool envelope, so the conservative count
    // is the useful one.
    const metadataTokenCount = getEncoding(TOKEN_ENCODING)
      .encode(JSON.stringify(toolList))
      .length;
    assertWithinBudget(
      "Combined tools/list metadata",
      metadataTokenCount,
      MAX_ALL_TOOLS_METADATA_TOKENS,
      "tokens",
    );

    const serverName = client.getServerVersion()?.name;
    assert.ok(serverName !== undefined, "Expected the server to advertise its name");

    for (const tool of toolList.tools) {
      const description = tool.description ?? "";
      assert.notEqual(description, "", `Tool ${tool.name} must carry a description`);
      assertWithinBudget(
        `Description of tool ${tool.name}`,
        description.length,
        MAX_TOOL_DESCRIPTION_CHARS,
        "characters",
      );

      const fieldDescriptions: SchemaDescription[] = [];
      collectSchemaDescriptions(tool.inputSchema, "", new WeakSet<object>(), fieldDescriptions);

      for (const fieldDescription of fieldDescriptions) {
        const pointer = describeJsonPointer(fieldDescription.pointer);
        assertWithinBudget(
          `Description of input field ${tool.name} at ${pointer}`,
          fieldDescription.description.length,
          MAX_TOOL_FIELD_DESCRIPTION_CHARS,
          "characters",
        );
      }

      const prefixedToolNameLength = CLIENT_TOOL_NAME_PREFIX.length
        + serverName.length
        + CLIENT_TOOL_NAME_SEPARATOR.length
        + tool.name.length;
      assertWithinBudget(
        `Client-prefixed name of tool ${tool.name}`,
        prefixedToolNameLength,
        MAX_PREFIXED_TOOL_NAME_CHARS,
        "characters",
      );
    }

    const instructions = client.getInstructions();
    assert.ok(instructions !== undefined, "Expected the client to receive server instructions");
    assertWithinBudget(
      "Server instructions",
      instructions.length,
      MAX_SERVER_INSTRUCTIONS_CHARS,
      "characters",
    );
  } finally {
    await client.close();
    await server.close();
  }
});

/**
 * The in-app chat tools are never part of `tools/list`, so they are asserted
 * from the list the chat runtime hands to OpenAI instead. It is read through
 * `buildOpenAIChatTools` rather than through the individual tool constants so
 * that a third chat tool is covered the day it is added, and both eligibility
 * branches are read because a tool could be sent only when image generation is
 * off.
 *
 * Each tool's `parameters` schema is walked exactly as an MCP input schema is:
 * no chat tool carries a field description today, so the walk finds nothing,
 * and that is precisely what stops the first one from arriving unmeasured.
 */
test("In-app chat tool descriptions stay inside the OpenAI function budget", () => {
  const chatTools = [...buildOpenAIChatTools(false), ...buildOpenAIChatTools(true)];
  assert.ok(chatTools.length > 0, "Expected the chat runtime to send at least one tool");

  const measuredToolNames = new Set<string>();
  for (const tool of chatTools) {
    if (measuredToolNames.has(tool.name)) {
      continue;
    }
    measuredToolNames.add(tool.name);

    const description = tool.description ?? "";
    assert.notEqual(description, "", `Chat tool ${tool.name} must carry a description`);
    assertWithinBudget(
      `Description of chat tool ${tool.name}`,
      description.length,
      MAX_TOOL_DESCRIPTION_CHARS,
      "characters",
    );

    const parameterDescriptions: SchemaDescription[] = [];
    collectSchemaDescriptions(tool.parameters, "", new WeakSet<object>(), parameterDescriptions);

    for (const parameterDescription of parameterDescriptions) {
      const pointer = describeJsonPointer(parameterDescription.pointer);
      assertWithinBudget(
        `Description of chat tool ${tool.name} parameter at ${pointer}`,
        parameterDescription.description.length,
        MAX_TOOL_FIELD_DESCRIPTION_CHARS,
        "characters",
      );
    }
  }
});
