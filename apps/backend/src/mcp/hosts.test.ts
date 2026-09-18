import assert from "node:assert/strict";
import test from "node:test";
import {
  buildMcpProtectedResourceMetadata,
  getAllowedMcpHosts,
  getMcpProtectedResourceMetadataUrl,
  getMcpResourceUrl,
  normalizeRequestHost,
  resolveMcpHost,
} from "./hosts";

const baseDomain = "flashcards-open-source-app.com";
const primaryHost = `mcp.${baseDomain}`;
const alternateHost = "mcp.nibomo.com";
const authorizationServerUrl = `https://auth.${baseDomain}`;
const supportedScopes = ["flashcards"] as const;

test("without an alternate host every request resolves to the primary host", () => {
  for (const requestHost of [
    undefined,
    null,
    "",
    primaryHost,
    alternateHost,
    "abc123.execute-api.eu-central-1.amazonaws.com",
    "attacker.example",
  ]) {
    assert.equal(resolveMcpHost(requestHost, baseDomain, null), primaryHost);
  }

  assert.deepEqual(getAllowedMcpHosts(baseDomain, null), [primaryHost]);
});

test("a configured alternate host serves only its own requests", () => {
  assert.equal(resolveMcpHost(alternateHost, baseDomain, alternateHost), alternateHost);
  assert.equal(resolveMcpHost(primaryHost, baseDomain, alternateHost), primaryHost);
  assert.deepEqual(getAllowedMcpHosts(baseDomain, alternateHost), [primaryHost, alternateHost]);
});

test("an unrecognized or missing host falls back to the primary host", () => {
  for (const requestHost of [
    undefined,
    null,
    "   ",
    "abc123.execute-api.eu-central-1.amazonaws.com",
    "mcp.nibomo.com.attacker.example",
    "attacker.example",
  ]) {
    assert.equal(resolveMcpHost(requestHost, baseDomain, alternateHost), primaryHost);
  }
});

test("host matching ignores case, port and the trailing root dot", () => {
  assert.equal(resolveMcpHost("MCP.Nibomo.com:443", baseDomain, alternateHost), alternateHost);
  assert.equal(resolveMcpHost("mcp.nibomo.com.", baseDomain, alternateHost), alternateHost);
  assert.equal(resolveMcpHost(` ${primaryHost.toUpperCase()} `, baseDomain, alternateHost), primaryHost);
  assert.equal(normalizeRequestHost("[::1]:8080"), "[::1]");
  assert.equal(normalizeRequestHost(""), null);
});

test("each host gets its own resource identifier and metadata URL", () => {
  assert.equal(getMcpResourceUrl(primaryHost), `https://${primaryHost}/mcp`);
  assert.equal(getMcpResourceUrl(alternateHost), `https://${alternateHost}/mcp`);
  assert.notEqual(getMcpResourceUrl(primaryHost), getMcpResourceUrl(alternateHost));
  assert.equal(
    getMcpProtectedResourceMetadataUrl(alternateHost),
    `https://${alternateHost}/.well-known/oauth-protected-resource/mcp`,
  );
});

test("protected-resource metadata names the requested host and the shared authorization server", () => {
  const primaryMetadata = buildMcpProtectedResourceMetadata(
    primaryHost,
    authorizationServerUrl,
    supportedScopes,
  );
  const alternateMetadata = buildMcpProtectedResourceMetadata(
    alternateHost,
    authorizationServerUrl,
    supportedScopes,
  );

  assert.deepEqual(primaryMetadata, {
    resource: `https://${primaryHost}/mcp`,
    authorization_servers: [authorizationServerUrl],
    bearer_methods_supported: ["header"],
    scopes_supported: ["flashcards"],
  });
  assert.equal(alternateMetadata.resource, `https://${alternateHost}/mcp`);
  // Settled decision: one authorization server for both hosts.
  assert.deepEqual(alternateMetadata.authorization_servers, [authorizationServerUrl]);
});
