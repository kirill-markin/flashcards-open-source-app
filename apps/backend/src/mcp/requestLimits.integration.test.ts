import assert from "node:assert/strict";
import test from "node:test";
import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import { CallToolResultSchema, JSONRPCResultResponseSchema } from "@modelcontextprotocol/sdk/types.js";
import { createMcpServer } from "./server";
import { MAX_MCP_REQUEST_BODY_BYTES, MAX_MCP_TOOL_INPUT_ELEMENTS } from "./requestLimits";
import { readCallToolNameFromRequestBody } from "./requestTelemetry";

function createRequest(body: string): Request {
  return new Request("https://mcp.example.com/mcp", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Accept: "application/json, text/event-stream",
      "MCP-Protocol-Version": "2025-11-25",
    },
    body,
  });
}

async function serveRequest(request: Request): Promise<Response> {
  const server = createMcpServer(
    { userId: "limit-smoke", connectionId: "limit-smoke", selectedWorkspaceId: null },
    "https://example.com",
    "https://example.com/icon.svg",
    { caller: null, recordInvokedTool: () => {}, recordToolOutcome: () => {} },
  );
  const transport = new WebStandardStreamableHTTPServerTransport({
    sessionIdGenerator: undefined,
    enableJsonResponse: true,
    maxRequestBodySize: MAX_MCP_REQUEST_BODY_BYTES,
  });
  try {
    await server.connect(transport);
    return await transport.handleRequest(request);
  } finally {
    await transport.close();
    await server.close();
  }
}

test("bounded telemetry preserves the request for a real MCP guide call", async () => {
  const request = createRequest(JSON.stringify({
    jsonrpc: "2.0", id: 1, method: "tools/call",
    params: { name: "get_guide", arguments: { topic: "study" } },
  }));
  assert.equal(await readCallToolNameFromRequestBody(request), "get_guide");
  const response = await serveRequest(request);
  assert.equal(response.status, 200);
  const message = JSONRPCResultResponseSchema.parse(await response.json());
  const result = CallToolResultSchema.parse(message.result);
  assert.notEqual(result.isError, true);
});

test("the real MCP server rejects excessive elements before tool schema validation", async () => {
  const request = createRequest(JSON.stringify({
    jsonrpc: "2.0", id: 2, method: "tools/call",
    params: {
      name: "get_guide",
      arguments: { topic: Array.from({ length: MAX_MCP_TOOL_INPUT_ELEMENTS }, () => "study") },
    },
  }));
  const response = await serveRequest(request);
  assert.equal(response.status, 200);
  const message = JSONRPCResultResponseSchema.parse(await response.json());
  const result = CallToolResultSchema.parse(message.result);
  assert.equal(result.isError, true);
  assert.match(JSON.stringify(result.content), /arguments contain more than the maximum/);
});

test("telemetry and transport bound actual UTF-8 bytes even with an understated content length", async () => {
  const request = createRequest(JSON.stringify({
    jsonrpc: "2.0", id: 3, method: "tools/call",
    params: {
      name: "get_guide",
      arguments: { topic: "study" },
      padding: "я".repeat(MAX_MCP_REQUEST_BODY_BYTES / 2),
    },
  }));
  request.headers.set("Content-Length", "1");
  assert.equal(await readCallToolNameFromRequestBody(request), null);
  const response = await serveRequest(request);
  assert.equal(response.status, 413);
});
