import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";

test("MCP Lambda entrypoint does not import the backend Hono app", () => {
  const sourcePath = path.resolve(process.cwd(), "src/entrypoints/lambda-mcp.ts");
  const source = readFileSync(sourcePath, "utf8");
  const backendAppImportPattern = /from\s+["']\.\.\/server\/app["']|import\s*\(\s*["']\.\.\/server\/app["']\s*\)/;

  assert.equal(backendAppImportPattern.test(source), false);
});
