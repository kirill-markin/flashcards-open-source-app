import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import test from "node:test";
import { loadOpenApiDocument } from "../../shared/openapi";

const operationMethodNames = ["get", "post", "put", "patch", "delete", "options", "head", "trace"] as const;

type OperationMethodName = (typeof operationMethodNames)[number];
type PathItemForTest = Readonly<Partial<Record<OperationMethodName, object>>>;
type OpenApiDocumentForTest = Readonly<{
  info?: Readonly<{
    title?: string;
    description?: string;
  }>;
  paths?: Readonly<Record<string, PathItemForTest>>;
  components?: Readonly<{
    schemas?: Readonly<Record<string, object>>;
    securitySchemes?: Readonly<Record<string, object>>;
  }>;
}>;

const expectedPublishedExternalAgentMethods = {
  "/": ["get"],
  "/agent": ["get"],
  "/api/agent/send-code": ["post"],
  "/api/agent/verify-code": ["post"],
  "/agent/me": ["get"],
  "/agent/workspaces": ["get", "post"],
  "/agent/workspaces/{workspaceId}/select": ["post"],
  "/agent/sql": ["post"],
} as const satisfies Readonly<Record<string, ReadonlyArray<OperationMethodName>>>;

function loadPublishedOpenApiDocument(): OpenApiDocumentForTest {
  return loadOpenApiDocument() as OpenApiDocumentForTest;
}

function listDocumentedMethods(pathItem: PathItemForTest): ReadonlyArray<OperationMethodName> {
  return operationMethodNames.filter((method) => pathItem[method] !== undefined);
}

test("API Gateway predeclares PATCH /me/preferences", () => {
  const apiGatewayPath = resolve(process.cwd(), "../../infra/aws/lib/gateways/api-gateway.ts");
  const apiGatewaySource = readFileSync(apiGatewayPath, "utf8");

  assert.match(apiGatewaySource, /me\.addResource\("preferences"\)\.addMethod\("PATCH", integration\);/);
});

test("published OpenAPI exposes only the curated external agent contract", () => {
  const openApiDocument = loadPublishedOpenApiDocument();
  const paths = openApiDocument.paths ?? {};
  const securitySchemes = openApiDocument.components?.securitySchemes ?? {};
  const schemas = openApiDocument.components?.schemas ?? {};

  assert.equal(openApiDocument.info?.title, "Flashcards Open Source App External AI-Agent API");
  assert.match(openApiDocument.info?.description ?? "", /curated public api contract/i);
  assert.deepEqual(Object.keys(paths), Object.keys(expectedPublishedExternalAgentMethods));
  for (const [path, methods] of Object.entries(expectedPublishedExternalAgentMethods)) {
    assert.deepEqual(listDocumentedMethods(paths[path] ?? {}), methods, `Unexpected OpenAPI methods for ${path}`);
  }

  assert.deepEqual(Object.keys(securitySchemes), ["ApiKeyHeader"]);
  for (const hiddenSchemaName of [
    "MeResponse",
    "AccountPreferences",
    "CommunityPublicProfileResponse",
    "FriendInvitationCreateRequest",
    "ProgressLeaderboardResponse",
    "StreakLeaderboardResponse",
    "LeaderboardProfileResponse",
  ]) {
    assert.equal(schemas[hiddenSchemaName], undefined, `OpenAPI must not publish ${hiddenSchemaName}`);
  }
});

test("API Gateway predeclares /me/community/profile", () => {
  const apiGatewayPath = resolve(process.cwd(), "../../infra/aws/lib/gateways/api-gateway.ts");
  const apiGatewaySource = readFileSync(apiGatewayPath, "utf8");

  assert.match(
    apiGatewaySource,
    /const meCommunityProfile = meCommunity\.addResource\("profile"\);/,
  );
  assert.match(apiGatewaySource, /meCommunityProfile\.addMethod\("GET", integration\);/);
  assert.match(apiGatewaySource, /meCommunityProfile\.addMethod\("PATCH", integration\);/);
});

test("API Gateway predeclares friend invitation routes", () => {
  const apiGatewayPath = resolve(process.cwd(), "../../infra/aws/lib/gateways/api-gateway.ts");
  const apiGatewaySource = readFileSync(apiGatewayPath, "utf8");

  assert.match(
    apiGatewaySource,
    /const meCommunityFriendInvitations = meCommunity\.addResource\("friend-invitations"\);/,
  );
  assert.match(apiGatewaySource, /meCommunityFriendInvitations\.addMethod\("POST", integration\);/);
  assert.match(
    apiGatewaySource,
    /meCommunityFriendInvitations\s*\.addResource\("\{inviteToken\}"\)\s*\.addResource\("accept"\)\s*\.addMethod\("POST", integration\);/,
  );
  assert.match(
    apiGatewaySource,
    /const communityFriendInvitations = community\.addResource\("friend-invitations"\);/,
  );
  assert.match(
    apiGatewaySource,
    /communityFriendInvitations\.addResource\("\{inviteToken\}"\)\.addMethod\("GET", integration\);/,
  );
});

test("API Gateway predeclares /me/progress/leaderboard", () => {
  const apiGatewayPath = resolve(process.cwd(), "../../infra/aws/lib/gateways/api-gateway.ts");
  const apiGatewaySource = readFileSync(apiGatewayPath, "utf8");

  assert.match(
    apiGatewaySource,
    /meProgress\.addResource\("leaderboard"\)\.addMethod\("GET", integration\);/,
  );
});

test("API Gateway predeclares /me/progress/leaderboards/streak", () => {
  const apiGatewayPath = resolve(process.cwd(), "../../infra/aws/lib/gateways/api-gateway.ts");
  const apiGatewaySource = readFileSync(apiGatewayPath, "utf8");

  assert.match(
    apiGatewaySource,
    /const meProgressLeaderboards = meProgress\.addResource\("leaderboards"\);/,
  );
  assert.match(
    apiGatewaySource,
    /meProgressLeaderboards\.addResource\("streak"\)\.addMethod\("GET", integration\);/,
  );
});

test("API Gateway predeclares /me/progress/leaderboards/profiles/{publicProfileId}", () => {
  const apiGatewayPath = resolve(process.cwd(), "../../infra/aws/lib/gateways/api-gateway.ts");
  const apiGatewaySource = readFileSync(apiGatewayPath, "utf8");

  assert.match(
    apiGatewaySource,
    /const meProgressLeaderboardProfiles = meProgressLeaderboards\.addResource\("profiles"\);/,
  );
  assert.match(
    apiGatewaySource,
    /meProgressLeaderboardProfiles\.addResource\("\{publicProfileId\}"\)\.addMethod\("GET", integration\);/,
  );
});
