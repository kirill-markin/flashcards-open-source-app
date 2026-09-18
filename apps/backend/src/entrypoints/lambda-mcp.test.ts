import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";

function readEntrypointSource(): string {
  return readFileSync(path.resolve(process.cwd(), "src/entrypoints/lambda-mcp.ts"), "utf8");
}

test("MCP Lambda entrypoint does not import the backend Hono app", () => {
  const source = readEntrypointSource();
  const backendAppImportPattern = /from\s+["']\.\.\/server\/app["']|import\s*\(\s*["']\.\.\/server\/app["']\s*\)/;

  assert.equal(backendAppImportPattern.test(source), false);
  assert.match(source, /import \{ parsePublicOrigin \} from "\.\.\/shared\/publicUrls";/);
  assert.match(
    source,
    /return parsePublicOrigin\(configuredValue, "PUBLIC_SITE_BASE_URL"\);/,
  );
  assert.match(
    source,
    /return parsePublicOrigin\(`https:\/\/\$\{baseDomain\}`, "PUBLIC_SITE_BASE_URL"\);/,
  );
});

test("the OAuth identifiers and the token audience come from the request's host", () => {
  const source = readEntrypointSource();

  // The host is resolved once per request against the configured hosts, and the
  // resolver is the pure module the behaviour is tested in (../mcp/hosts.test.ts).
  assert.match(
    source,
    /return resolveMcpHost\(c\.req\.header\("host"\), baseDomain, getAlternateMcpHost\(\)\);/,
  );
  assert.match(source, /const mcpHost = getRequestMcpHost\(c, baseDomain\);/);

  // Metadata, challenge and transport allowlist all follow that host.
  assert.match(
    source,
    /return c\.json\(buildProtectedResourceMetadata\(getRequestMcpHost\(c, baseDomain\), baseDomain\)\);/,
  );
  assert.match(
    source,
    /"WWW-Authenticate": `Bearer resource_metadata="\$\{getMcpProtectedResourceMetadataUrl\(mcpHost\)\}"`/,
  );
  assert.match(source, /allowedHosts: \[\.\.\.getAllowedMcpHosts\(baseDomain, getAlternateMcpHost\(\)\)\]/);

  // Per-host tokens: the expected audience is the host the request arrived on, so
  // a token minted for one host is refused on the other.
  assert.match(
    source,
    /connection = await authenticateMcpBearerToken\(token, getMcpResourceUrl\(mcpHost\)\);/,
  );

  // The authorization server is shared by every MCP host.
  assert.match(source, /return `https:\/\/auth\.\$\{baseDomain\}`;/);
});

test("the alternate host is opt-in, so an unconfigured deployment is unchanged", () => {
  const source = readEntrypointSource();

  assert.match(source, /const alternateHost = process\.env\.MCP_ALTERNATE_HOST;/);
  assert.match(
    source,
    /if \(alternateHost === undefined \|\| alternateHost\.trim\(\) === ""\) \{\s*return null;\s*\}/,
  );
});
