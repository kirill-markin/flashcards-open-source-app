import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";

const agentApiKeysPath = path.resolve(process.cwd(), "src/server/agentApiKeys.ts");
const agentApiKeysSource = readFileSync(agentApiKeysPath, "utf8");

test("auth agent API key listing uses user-scoped queries", () => {
  assert.match(
    agentApiKeysSource,
    /export async function listAgentApiKeyConnectionsForUser[\s\S]*queryWithUserScope<AgentApiKeyRow>\(\s*\{ userId \}/,
  );
});
