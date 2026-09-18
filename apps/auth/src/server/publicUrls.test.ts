import assert from "node:assert/strict";
import test from "node:test";
import { getMcpResource, getMcpResources, isSupportedMcpResource } from "./publicUrls.js";

const requestUrl = "https://auth.flashcards-open-source-app.com/authorize";
const primaryResource = "https://mcp.flashcards-open-source-app.com/mcp";
const alternateResource = "https://mcp.nibomo.com/mcp";

/**
 * Runs `body` with the MCP environment set to exactly `environment`, then puts
 * the process environment back. The resolvers read `process.env` directly, the
 * way the Lambda does.
 */
function withMcpEnvironment(
  environment: Readonly<{ MCP_RESOURCE?: string; MCP_ALTERNATE_RESOURCE?: string }>,
  body: () => void,
): void {
  const previousResource = process.env.MCP_RESOURCE;
  const previousAlternateResource = process.env.MCP_ALTERNATE_RESOURCE;

  const apply = (name: "MCP_RESOURCE" | "MCP_ALTERNATE_RESOURCE", value: string | undefined): void => {
    if (value === undefined) {
      delete process.env[name];
      return;
    }
    process.env[name] = value;
  };

  apply("MCP_RESOURCE", environment.MCP_RESOURCE);
  apply("MCP_ALTERNATE_RESOURCE", environment.MCP_ALTERNATE_RESOURCE);
  try {
    body();
  } finally {
    apply("MCP_RESOURCE", previousResource);
    apply("MCP_ALTERNATE_RESOURCE", previousAlternateResource);
  }
}

test("without an alternate resource only the canonical MCP resource is accepted", () => {
  withMcpEnvironment({ MCP_RESOURCE: primaryResource }, () => {
    assert.equal(getMcpResource(requestUrl), primaryResource);
    assert.deepEqual(getMcpResources(requestUrl), [primaryResource]);
    assert.equal(isSupportedMcpResource(primaryResource, requestUrl), true);
    assert.equal(isSupportedMcpResource(alternateResource, requestUrl), false);
  });
});

test("a configured alternate resource is accepted alongside the canonical one", () => {
  withMcpEnvironment(
    { MCP_RESOURCE: primaryResource, MCP_ALTERNATE_RESOURCE: alternateResource },
    () => {
      assert.deepEqual(getMcpResources(requestUrl), [primaryResource, alternateResource]);
      assert.equal(isSupportedMcpResource(primaryResource, requestUrl), true);
      assert.equal(isSupportedMcpResource(alternateResource, requestUrl), true);
      // The canonical resource is unchanged, so a grant that names it still binds
      // to the primary host and keeps working there.
      assert.equal(getMcpResource(requestUrl), primaryResource);
    },
  );
});

test("resource matching is exact, so a near miss never mints a token", () => {
  withMcpEnvironment(
    { MCP_RESOURCE: primaryResource, MCP_ALTERNATE_RESOURCE: alternateResource },
    () => {
      for (const resource of [
        "",
        "https://mcp.nibomo.com",
        "https://mcp.nibomo.com/mcp/",
        "https://mcp.nibomo.com.attacker.example/mcp",
        "http://mcp.nibomo.com/mcp",
        "https://MCP.nibomo.com/mcp",
      ]) {
        assert.equal(isSupportedMcpResource(resource, requestUrl), false, resource);
      }
    },
  );
});

test("an alternate resource equal to the canonical one is not listed twice", () => {
  withMcpEnvironment(
    { MCP_RESOURCE: primaryResource, MCP_ALTERNATE_RESOURCE: primaryResource },
    () => {
      assert.deepEqual(getMcpResources(requestUrl), [primaryResource]);
    },
  );
});
