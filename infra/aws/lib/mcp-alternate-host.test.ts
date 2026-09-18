import assert from "node:assert/strict";
import test from "node:test";
import {
  McpAlternateDomainConflictError,
  getMcpResourceUrl,
  getPrimaryMcpHost,
  isMcpAlternateHostLive,
  resolveMcpAlternateHost,
} from "./mcp-alternate-host";

const baseDomain = "flashcards-open-source-app.com";
const certificateArn = "arn:aws:acm:eu-central-1:123456789012:certificate/abc";

test("the alternate host stays off unless both values are set", () => {
  assert.equal(resolveMcpAlternateHost(baseDomain, undefined, undefined), undefined);
  assert.equal(resolveMcpAlternateHost(baseDomain, "", certificateArn), undefined);
  assert.equal(resolveMcpAlternateHost(baseDomain, "  ", certificateArn), undefined);
  assert.equal(resolveMcpAlternateHost(baseDomain, "mcp.nibomo.com", undefined), undefined);
  assert.equal(resolveMcpAlternateHost(baseDomain, "mcp.nibomo.com", ""), undefined);
});

test("both values together resolve to the normalized alternate host", () => {
  assert.equal(
    resolveMcpAlternateHost(baseDomain, "mcp.nibomo.com", certificateArn),
    "mcp.nibomo.com",
  );
  assert.equal(
    resolveMcpAlternateHost(baseDomain, " MCP.Nibomo.com. ", certificateArn),
    "mcp.nibomo.com",
  );
});

test("naming the primary MCP host fails at synth with a named error", () => {
  const primaryMcpHost = getPrimaryMcpHost(baseDomain);

  for (const alternateDomainName of [primaryMcpHost, ` ${primaryMcpHost.toUpperCase()}. `]) {
    assert.throws(
      () => resolveMcpAlternateHost(baseDomain, alternateDomainName, certificateArn),
      (error: unknown) => {
        assert.ok(error instanceof McpAlternateDomainConflictError);
        assert.equal(error.name, "McpAlternateDomainConflictError");
        assert.match(error.message, /must differ from the primary MCP host/);
        return true;
      },
    );
  }

  // The conflict is reported even without a certificate, because the name alone
  // is already the mistake.
  assert.throws(
    () => resolveMcpAlternateHost(baseDomain, primaryMcpHost, undefined),
    McpAlternateDomainConflictError,
  );
});

test("the resource identifier of a host is its https origin plus /mcp", () => {
  assert.equal(getMcpResourceUrl(getPrimaryMcpHost(baseDomain)), `https://mcp.${baseDomain}/mcp`);
  assert.equal(getMcpResourceUrl("mcp.nibomo.com"), "https://mcp.nibomo.com/mcp");
});

test("the alternate host is policed only when it is explicitly declared live", () => {
  // Anything but an explicit "true" leaves the heartbeat alone, so the deploy that
  // creates the host -- before its CNAME can exist -- never pages for it.
  for (const value of [undefined, "", " ", "false", "1", "yes", "TRUE!"]) {
    assert.equal(isMcpAlternateHostLive(value), false, value);
  }

  for (const value of ["true", "  TRUE ", "True"]) {
    assert.equal(isMcpAlternateHostLive(value), true, value);
  }
});
