import { readFileSync } from "node:fs";
import path from "node:path";
import assert from "node:assert/strict";
import { afterEach, test } from "node:test";
import { resetAuthConfigForTests } from "./authConfig";
import { createApp } from "./app";
import { resetGuestAiQuotaConfigForTests } from "./guestAiQuotaConfig";

const originalAuthMode = process.env.AUTH_MODE;
const originalAllowInsecureLocalAuth = process.env.ALLOW_INSECURE_LOCAL_AUTH;
const originalPublicApiBaseUrl = process.env.PUBLIC_API_BASE_URL;
const originalPublicAuthBaseUrl = process.env.PUBLIC_AUTH_BASE_URL;
const originalGuestAiWeightedMonthlyTokenCap = process.env.GUEST_AI_WEIGHTED_MONTHLY_TOKEN_CAP;
function restoreEnvironment(): void {
  if (originalAuthMode === undefined) {
    delete process.env.AUTH_MODE;
  } else {
    process.env.AUTH_MODE = originalAuthMode;
  }

  if (originalAllowInsecureLocalAuth === undefined) {
    delete process.env.ALLOW_INSECURE_LOCAL_AUTH;
  } else {
    process.env.ALLOW_INSECURE_LOCAL_AUTH = originalAllowInsecureLocalAuth;
  }

  if (originalPublicApiBaseUrl === undefined) {
    delete process.env.PUBLIC_API_BASE_URL;
  } else {
    process.env.PUBLIC_API_BASE_URL = originalPublicApiBaseUrl;
  }

  if (originalPublicAuthBaseUrl === undefined) {
    delete process.env.PUBLIC_AUTH_BASE_URL;
  } else {
    process.env.PUBLIC_AUTH_BASE_URL = originalPublicAuthBaseUrl;
  }

  if (originalGuestAiWeightedMonthlyTokenCap === undefined) {
    delete process.env.GUEST_AI_WEIGHTED_MONTHLY_TOKEN_CAP;
  } else {
    process.env.GUEST_AI_WEIGHTED_MONTHLY_TOKEN_CAP = originalGuestAiWeightedMonthlyTokenCap;
  }

  resetAuthConfigForTests();
  resetGuestAiQuotaConfigForTests();
}

function setCognitoAuthMode(): void {
  process.env.AUTH_MODE = "cognito";
  delete process.env.ALLOW_INSECURE_LOCAL_AUTH;
  resetAuthConfigForTests();
}

afterEach(restoreEnvironment);

test("createApp rejects missing AUTH_MODE at startup", () => {
  delete process.env.AUTH_MODE;
  delete process.env.ALLOW_INSECURE_LOCAL_AUTH;
  resetAuthConfigForTests();
  resetGuestAiQuotaConfigForTests();

  assert.throws(
    () => createApp(""),
    (error: unknown) => error instanceof Error
      && error.message === 'AUTH_MODE is required and must be set to "cognito" or "none"',
  );
});

test("createApp rejects invalid guest AI quota env at startup", () => {
  setCognitoAuthMode();
  process.env.GUEST_AI_WEIGHTED_MONTHLY_TOKEN_CAP = "10.5";
  resetGuestAiQuotaConfigForTests();

  assert.throws(
    () => createApp(""),
    (error: unknown) => error instanceof Error
      && error.message === 'GUEST_AI_WEIGHTED_MONTHLY_TOKEN_CAP must be a non-negative integer when set, got "10.5"',
  );
});

test("root discovery matches /agent", async () => {
  setCognitoAuthMode();
  process.env.PUBLIC_API_BASE_URL = "https://api.example.com/v1";
  process.env.PUBLIC_AUTH_BASE_URL = "https://auth.example.com";

  const app = createApp("");
  const rootResponse = await app.request("https://api.example.com/");
  const agentResponse = await app.request("https://api.example.com/agent");

  assert.equal(rootResponse.status, 200);
  assert.equal(agentResponse.status, 200);
  assert.deepEqual(await rootResponse.json(), await agentResponse.json());
});

test("v1 root discovery accepts a trailing slash", async () => {
  setCognitoAuthMode();
  process.env.PUBLIC_API_BASE_URL = "https://api.example.com/v1";
  process.env.PUBLIC_AUTH_BASE_URL = "https://auth.example.com";

  const app = createApp("");
  const rootResponse = await app.request("https://api.example.com/v1");
  const trailingSlashResponse = await app.request("https://api.example.com/v1/");

  assert.equal(rootResponse.status, 200);
  assert.equal(trailingSlashResponse.status, 200);
  assert.deepEqual(await trailingSlashResponse.json(), await rootResponse.json());
});

test("openapi endpoints return the same JSON document", async () => {
  setCognitoAuthMode();
  const app = createApp("");
  const openapiResponse = await app.request("https://api.example.com/v1/openapi.json");
  const swaggerResponse = await app.request("https://api.example.com/v1/swagger.json");
  const agentOpenapiResponse = await app.request("https://api.example.com/v1/agent/openapi.json");
  const agentSwaggerResponse = await app.request("https://api.example.com/v1/agent/swagger.json");

  assert.equal(openapiResponse.status, 200);
  assert.equal(swaggerResponse.status, 200);
  assert.equal(agentOpenapiResponse.status, 200);
  assert.equal(agentSwaggerResponse.status, 200);

  const openapiBody = await openapiResponse.json() as { openapi: string; paths: Record<string, unknown> };
  const swaggerBody = await swaggerResponse.json();
  const agentOpenapiBody = await agentOpenapiResponse.json();
  const agentSwaggerBody = await agentSwaggerResponse.json();

  assert.equal(openapiBody.openapi, "3.1.0");
  assert.deepEqual(swaggerBody, openapiBody);
  assert.deepEqual(agentOpenapiBody, openapiBody);
  assert.deepEqual(agentSwaggerBody, openapiBody);
  assert.equal("/workspaces/{workspaceId}/sync/push" in openapiBody.paths, false);
  assert.equal("/chat/turn" in openapiBody.paths, false);
  assert.equal("/agent-api-keys" in openapiBody.paths, false);
  assert.equal("/agent/sql" in openapiBody.paths, true);
});

test("createApp mounts legacy and backend-owned chat routes together", async () => {
  process.env.AUTH_MODE = "none";
  process.env.ALLOW_INSECURE_LOCAL_AUTH = "true";
  resetAuthConfigForTests();
  resetGuestAiQuotaConfigForTests();

  const app = createApp("");
  const legacyResponse = await app.request("https://api.example.com/v1/chat/turn", {
    method: "POST",
    body: "{",
    headers: {
      "Content-Type": "application/json",
    },
  });
  const transcriptionsResponse = await app.request("https://api.example.com/v1/chat/transcriptions", {
    method: "POST",
    body: new FormData(),
  });
  const reservedV2Response = await app.request("https://api.example.com/v1/chat", {
    method: "GET",
  });

  assert.notEqual(legacyResponse.status, 404);
  assert.notEqual(transcriptionsResponse.status, 404);
  assert.notEqual(reservedV2Response.status, 404);
});

test("api gateway manual chat resource list includes both reserved and legacy chat paths", () => {
  const apiGatewaySource = readFileSync(
    path.resolve(__dirname, "../../../infra/aws/lib/api-gateway.ts"),
    "utf8",
  );

  assert.match(apiGatewaySource, /const chat = restApi\.root\.addResource\("chat"\);/);
  assert.match(apiGatewaySource, /chat\.addMethod\("GET", integration\);/);
  assert.match(apiGatewaySource, /chat\.addMethod\("POST", integration\);/);
  assert.match(apiGatewaySource, /chat\.addMethod\("DELETE", integration\);/);
  assert.match(apiGatewaySource, /chat\.addResource\("stop"\)\.addMethod\("POST", integration\);/);
  assert.match(apiGatewaySource, /const turn = chat\.addResource\("turn"\);/);
  assert.match(apiGatewaySource, /turn\.addMethod\("POST", streamingIntegration\);/);
  assert.match(apiGatewaySource, /chat\.addResource\("transcriptions"\)\.addMethod\("POST", integration\);/);
  assert.match(apiGatewaySource, /turn\.addResource\("diagnostics"\)\.addMethod\("POST", integration\);/);
});
