import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import test from "node:test";
import { createAgentDiscoveryEnvelope } from "../../agent/discovery";
import {
  createAgentAccountEnvelope,
  createAgentWorkspaceReadyEnvelope,
  createAgentWorkspacesEnvelope,
} from "../../agent/setup";
import { loadOpenApiDocument } from "../../shared/openapi";
import { maximumImageIngestionOriginalBytes } from "../../mediaAssets/validators";
import {
  workspacePackageImportConfirmRouteMaxZipBytes,
  workspacePackageImportPreviewRouteMaxZipBytes,
} from "../workspacePackages";
import type { RequestContext } from "../../server/requestContext";
import type { WorkspaceSummary } from "../../workspaces";

const operationMethodNames = ["get", "post", "put", "patch", "delete", "options", "head", "trace"] as const;

type OperationMethodName = (typeof operationMethodNames)[number];
type PathItemForTest = Readonly<Partial<Record<OperationMethodName, object>>>;
type OpenApiBinarySchemaForTest = Readonly<{
  type?: string;
  format?: string;
  maxLength?: number;
  properties?: Readonly<Record<string, OpenApiBinarySchemaForTest>>;
}>;
type OpenApiMediaTypeForTest = Readonly<{
  schema?: OpenApiBinarySchemaForTest;
}>;
type OpenApiRequestBodyForTest = Readonly<{
  content?: Readonly<Record<string, OpenApiMediaTypeForTest>>;
}>;
type OpenApiOperationForTest = Readonly<{
  description?: string;
  requestBody?: OpenApiRequestBodyForTest;
}>;
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

type AgentDiscoveryDataSchemaForTest = Readonly<{
  properties?: Readonly<{
    surface?: Readonly<{
      required?: ReadonlyArray<string>;
      properties?: Readonly<Record<string, object>>;
    }>;
  }>;
}>;

const expectedPublishedApiMethods = {
  "/": ["get"],
  "/agent": ["get"],
  "/api/agent/send-code": ["post"],
  "/api/agent/verify-code": ["post"],
  "/agent/me": ["get"],
  "/agent/workspaces": ["get", "post"],
  "/agent/workspaces/{workspaceId}/select": ["post"],
  "/agent/sql/query": ["post"],
  "/agent/sql/execute": ["post"],
  "/workspaces/{workspaceId}/media-assets/images": ["post"],
  "/workspaces/{workspaceId}/media-assets/upload-sessions": ["post"],
  "/workspaces/{workspaceId}/media-assets/upload-sessions/{sessionId}/parts": ["post"],
  "/workspaces/{workspaceId}/media-assets/upload-sessions/{sessionId}/complete": ["post"],
  "/workspaces/{workspaceId}/media-assets/upload-sessions/{sessionId}/abort": ["post"],
  "/workspaces/{workspaceId}/media-assets/{mediaAssetId}": ["get"],
  "/workspaces/{workspaceId}/media-assets/{mediaAssetId}/download-url": ["get"],
  "/workspaces/{workspaceId}/packages/export/preview": ["post"],
  "/workspaces/{workspaceId}/packages/export": ["post"],
  "/workspaces/{workspaceId}/packages/import/preview": ["post"],
  "/workspaces/{workspaceId}/packages/import": ["post"],
  "/catalog/packages": ["get"],
  "/catalog/packages/{packageSlug}": ["get"],
  "/catalog/package-versions/{packageVersionId}/cards": ["get"],
  "/catalog/package-versions/{packageVersionId}/media-assets/{packageMediaKey}/download-url": ["get"],
  "/catalog/package-versions/{packageVersionId}/media-assets/{packageMediaKey}/download": ["get"],
  "/admin/catalog/authors": ["post"],
  "/admin/catalog/authors/{authorId}": ["put"],
  "/admin/catalog/packages": ["post"],
  "/admin/catalog/packages/{packageId}": ["get"],
  "/admin/catalog/packages/{packageId}/draft": ["put"],
  "/admin/catalog/packages/{packageId}/media-assets": ["post"],
  "/admin/catalog/packages/{packageId}/versions": ["post"],
  "/admin/catalog/packages/{packageId}/versions/from-workspace": ["post"],
  "/admin/catalog/package-versions/{packageVersionId}/review-status": ["post"],
  "/admin/catalog/package-versions/{packageVersionId}/publish": ["post"],
  "/admin/catalog/package-versions/{packageVersionId}/delist": ["post"],
} as const satisfies Readonly<Record<string, ReadonlyArray<OperationMethodName>>>;

const expectedMediaDiscoverySurfaceTemplates = {
  mediaAssetImageIngestionUrlTemplate: "/workspaces/{workspaceId}/media-assets/images",
  mediaAssetUploadSessionCreateUrlTemplate: "/workspaces/{workspaceId}/media-assets/upload-sessions",
  mediaAssetUploadSessionPartsUrlTemplate: "/workspaces/{workspaceId}/media-assets/upload-sessions/{sessionId}/parts",
  mediaAssetUploadSessionCompleteUrlTemplate: "/workspaces/{workspaceId}/media-assets/upload-sessions/{sessionId}/complete",
  mediaAssetUploadSessionAbortUrlTemplate: "/workspaces/{workspaceId}/media-assets/upload-sessions/{sessionId}/abort",
  mediaAssetMetadataUrlTemplate: "/workspaces/{workspaceId}/media-assets/{mediaAssetId}",
  mediaAssetDownloadUrlTemplate: "/workspaces/{workspaceId}/media-assets/{mediaAssetId}/download-url",
  workspacePackageExportPreviewUrlTemplate: "/workspaces/{workspaceId}/packages/export/preview",
  workspacePackageExportUrlTemplate: "/workspaces/{workspaceId}/packages/export",
  workspacePackageImportPreviewUrlTemplate: "/workspaces/{workspaceId}/packages/import/preview",
  workspacePackageImportUrlTemplate: "/workspaces/{workspaceId}/packages/import",
} as const;
const supportedImageIngestionOpenApiContentTypes = [
  "application/octet-stream",
  "image/jpeg",
  "image/png",
  "image/webp",
] as const;
const maximumLambdaProxySafeImageIngestionOriginalBytes = 4_000_000;

const testAgentRequestUrl = "https://api.flashcards-open-source-app.com/v1/agent";
const testAgentWorkspaceReplicaId = "b4a0ec15-f875-5f9c-a8f8-9d6a9f42af39";
const testWorkspaceSummary: WorkspaceSummary = {
  workspaceId: "50b5b928-7f04-4cc8-878d-6cd0e8b98474",
  name: "Personal",
  createdAt: "2026-03-11T08:50:55.898Z",
  isSelected: true,
};
const testUnselectedWorkspaceSummary: WorkspaceSummary = {
  ...testWorkspaceSummary,
  isSelected: false,
};
const testApiKeyRequestContext: RequestContext = {
  userId: "user-1",
  subjectUserId: "subject-user-1",
  selectedWorkspaceId: testWorkspaceSummary.workspaceId,
  email: "user@example.com",
  locale: "en",
  userSettingsCreatedAt: "2026-03-11T08:50:55.898Z",
  preferences: {
    reviewReactionAnimationsEnabled: true,
  },
  transport: "api_key",
  connectionId: "connection-1",
  guestSessionId: null,
  guestPlatform: null,
};

function loadPublishedOpenApiDocument(): OpenApiDocumentForTest {
  return loadOpenApiDocument() as OpenApiDocumentForTest;
}

function listDocumentedMethods(pathItem: PathItemForTest): ReadonlyArray<OperationMethodName> {
  return operationMethodNames.filter((method) => pathItem[method] !== undefined);
}

function assertDoesNotAdvertiseUploadIntentFlow(value: string, label: string): void {
  assert.doesNotMatch(value, /upload[-\s]?intents?/i, `${label} must not advertise the legacy upload intent flow`);
}

function loadMediaAssetImageIngestionOperation(openApiDocument: OpenApiDocumentForTest): OpenApiOperationForTest {
  const operation = openApiDocument.paths?.["/workspaces/{workspaceId}/media-assets/images"]?.post;
  assert.ok(operation !== undefined);
  return operation as OpenApiOperationForTest;
}

function loadWorkspacePackageImportPreviewOperation(openApiDocument: OpenApiDocumentForTest): OpenApiOperationForTest {
  const operation = openApiDocument.paths?.["/workspaces/{workspaceId}/packages/import/preview"]?.post;
  assert.ok(operation !== undefined);
  return operation as OpenApiOperationForTest;
}

function loadWorkspacePackageImportOperation(openApiDocument: OpenApiDocumentForTest): OpenApiOperationForTest {
  const operation = openApiDocument.paths?.["/workspaces/{workspaceId}/packages/import"]?.post;
  assert.ok(operation !== undefined);
  return operation as OpenApiOperationForTest;
}

test("API Gateway predeclares PATCH /me/preferences", () => {
  const apiGatewayPath = resolve(process.cwd(), "../../infra/aws/lib/gateways/api-gateway.ts");
  const apiGatewaySource = readFileSync(apiGatewayPath, "utf8");

  assert.match(apiGatewaySource, /me\.addResource\("preferences"\)\.addMethod\("PATCH", integration\);/);
});

test("API Gateway predeclares POST /workspaces/{workspaceId}/media-assets/images", () => {
  const apiGatewayPath = resolve(process.cwd(), "../../infra/aws/lib/gateways/api-gateway.ts");
  const apiGatewaySource = readFileSync(apiGatewayPath, "utf8");

  assert.match(apiGatewaySource, /workspaceMediaAssets\.addResource\("images"\)\.addMethod\("POST", integration\);/);
});

test("API Gateway predeclares package export and import preview routes and ZIP binary media", () => {
  const apiGatewayPath = resolve(process.cwd(), "../../infra/aws/lib/gateways/api-gateway.ts");
  const apiGatewaySource = readFileSync(apiGatewayPath, "utf8");

  assert.match(apiGatewaySource, /binaryMediaTypes: \[[^\]]*"application\/zip"/);
  assert.match(apiGatewaySource, /workspacePackageExport\.addMethod\("POST", integration\);/);
  assert.match(apiGatewaySource, /workspacePackageExport\.addResource\("preview"\)\.addMethod\("POST", integration\);/);
  assert.match(apiGatewaySource, /workspacePackageImport\.addMethod\("POST", integration\);/);
  assert.match(apiGatewaySource, /workspacePackageImport\.addResource\("preview"\)\.addMethod\("POST", integration\);/);
});

test("API Gateway predeclares public catalog routes", () => {
  const apiGatewayPath = resolve(process.cwd(), "../../infra/aws/lib/gateways/api-gateway.ts");
  const apiGatewaySource = readFileSync(apiGatewayPath, "utf8");

  assert.match(apiGatewaySource, /const catalog = restApi\.root\.addResource\("catalog"\);/);
  assert.match(apiGatewaySource, /catalogPackages\.addMethod\("GET", integration\);/);
  assert.match(apiGatewaySource, /catalogPackages\.addResource\("\{packageSlug\}"\)\.addMethod\("GET", integration\);/);
  assert.match(apiGatewaySource, /catalogPackageVersionById\.addResource\("cards"\)\.addMethod\("GET", integration\);/);
  assert.match(
    apiGatewaySource,
    /const catalogPackageVersionMediaByKey = catalogPackageVersionById\s*\.addResource\("media-assets"\)\s*\.addResource\("\{packageMediaKey\}"\);/,
  );
  assert.match(apiGatewaySource, /catalogPackageVersionMediaByKey\.addResource\("download-url"\)\.addMethod\("GET", integration\);/);
  assert.match(apiGatewaySource, /catalogPackageVersionMediaByKey\.addResource\("download"\)\.addMethod\("GET", integration\);/);
});

test("published OpenAPI exposes the curated agent, media transfer, and admin catalog contract", () => {
  const openApiDocument = loadPublishedOpenApiDocument();
  const paths = openApiDocument.paths ?? {};
  const securitySchemes = openApiDocument.components?.securitySchemes ?? {};
  const schemas = openApiDocument.components?.schemas ?? {};

  assert.equal(openApiDocument.info?.title, "Flashcards Open Source App External AI-Agent API");
  assert.match(openApiDocument.info?.description ?? "", /curated public api contract/i);
  assert.deepEqual(Object.keys(paths), Object.keys(expectedPublishedApiMethods));
  assertDoesNotAdvertiseUploadIntentFlow(JSON.stringify(openApiDocument), "Published OpenAPI");
  for (const [path, methods] of Object.entries(expectedPublishedApiMethods)) {
    assert.deepEqual(listDocumentedMethods(paths[path] ?? {}), methods, `Unexpected OpenAPI methods for ${path}`);
  }

  // ApiKeyHeader secures the REST agent surface; OAuth2 documents the
  // implemented remote-MCP authorization-code flow (mcp.<domain>/mcp) in the
  // published spec. AdminSessionCookie and CsrfTokenHeader secure the
  // browser-only admin catalog routes.
  assert.deepEqual(Object.keys(securitySchemes), [
    "ApiKeyHeader",
    "AdminSessionCookie",
    "CsrfTokenHeader",
    "OAuth2",
  ]);
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

test("agent discovery advertises the published media transfer surface", () => {
  const apiBaseUrl = "https://api.flashcards-open-source-app.com/v1";
  const discoveryEnvelope = createAgentDiscoveryEnvelope(`${apiBaseUrl}/agent`);
  const openApiDocument = loadPublishedOpenApiDocument();
  const schemas = openApiDocument.components?.schemas ?? {};
  const discoveryDataSchema = schemas.AgentDiscoveryData as AgentDiscoveryDataSchemaForTest | undefined;
  const discoverySurfaceSchema = discoveryDataSchema?.properties?.surface;

  assert.ok(discoverySurfaceSchema !== undefined);
  for (const [surfaceKey, pathTemplate] of Object.entries(expectedMediaDiscoverySurfaceTemplates)) {
    assert.equal(
      discoveryEnvelope.data.surface[surfaceKey as keyof typeof expectedMediaDiscoverySurfaceTemplates],
      `${apiBaseUrl}${pathTemplate}`,
    );
    assert.ok(
      expectedPublishedApiMethods[pathTemplate] !== undefined,
      `Discovery media template ${surfaceKey} must be published in OpenAPI paths`,
    );
    assert.ok(
      discoverySurfaceSchema.required?.includes(surfaceKey),
      `AgentDiscoveryData.surface must require ${surfaceKey}`,
    );
    assert.ok(
      discoverySurfaceSchema.properties?.[surfaceKey] !== undefined,
      `AgentDiscoveryData.surface must document ${surfaceKey}`,
    );
  }

  assert.match(discoveryEnvelope.instructions, /media-assets\/images/);
  assert.match(discoveryEnvelope.instructions, /media-assets\/upload-sessions/);
  assert.match(discoveryEnvelope.instructions, /media-assets\/upload-sessions\/\{sessionId\}\/parts/);
  assert.match(discoveryEnvelope.instructions, /media-assets\/upload-sessions\/\{sessionId\}\/complete/);
  assert.match(discoveryEnvelope.instructions, /media-assets\/upload-sessions\/\{sessionId\}\/abort/);
  assertDoesNotAdvertiseUploadIntentFlow(discoveryEnvelope.instructions, "Agent discovery instructions");
  assert.match(discoveryEnvelope.instructions, /media-assets\/\{mediaAssetId\}\/download-url/);
  assert.match(discoveryEnvelope.instructions, /packages\/export\/preview/);
  assert.match(discoveryEnvelope.instructions, /packages\/export/);
  assert.match(discoveryEnvelope.instructions, /packages\/import\/preview/);
  assert.match(discoveryEnvelope.instructions, /packages\/import/);
  assert.match(discoveryEnvelope.instructions, /data\.agentWorkspaceReplicaId/);
  assert.match(discoveryEnvelope.instructions, /lastModifiedByReplicaId/);
});

test("media asset image ingestion publishes the transport-safe original body limit", () => {
  assert.ok(maximumImageIngestionOriginalBytes <= maximumLambdaProxySafeImageIngestionOriginalBytes);

  const apiBaseUrl = "https://api.flashcards-open-source-app.com/v1";
  const discoveryEnvelope = createAgentDiscoveryEnvelope(`${apiBaseUrl}/agent`);
  const openApiDocument = loadPublishedOpenApiDocument();
  const operation = loadMediaAssetImageIngestionOperation(openApiDocument);
  const requestBodyContent = operation.requestBody?.content ?? {};

  assert.match(operation.description ?? "", new RegExp(`${maximumImageIngestionOriginalBytes} bytes`));
  assert.match(discoveryEnvelope.instructions, new RegExp(`up to ${maximumImageIngestionOriginalBytes} bytes`));
  for (const contentType of supportedImageIngestionOpenApiContentTypes) {
    assert.equal(requestBodyContent[contentType]?.schema?.maxLength, maximumImageIngestionOriginalBytes);
  }
  assert.match(
    JSON.stringify(openApiDocument.paths?.["/"] ?? {}),
    new RegExp(`up to ${maximumImageIngestionOriginalBytes} bytes`),
  );
  assert.match(
    JSON.stringify(openApiDocument.paths?.["/agent"] ?? {}),
    new RegExp(`up to ${maximumImageIngestionOriginalBytes} bytes`),
  );
});

test("workspace package import preview publishes the direct route body limit", () => {
  assert.ok(workspacePackageImportPreviewRouteMaxZipBytes <= maximumLambdaProxySafeImageIngestionOriginalBytes);

  const apiBaseUrl = "https://api.flashcards-open-source-app.com/v1";
  const discoveryEnvelope = createAgentDiscoveryEnvelope(`${apiBaseUrl}/agent`);
  const openApiDocument = loadPublishedOpenApiDocument();
  const operation = loadWorkspacePackageImportPreviewOperation(openApiDocument);
  const requestBodyContent = operation.requestBody?.content ?? {};

  assert.match(operation.description ?? "", new RegExp(`${workspacePackageImportPreviewRouteMaxZipBytes} bytes`));
  assert.match(discoveryEnvelope.instructions, new RegExp(`up to ${workspacePackageImportPreviewRouteMaxZipBytes} bytes`));
  assert.equal(
    requestBodyContent["application/zip"]?.schema?.maxLength,
    workspacePackageImportPreviewRouteMaxZipBytes,
  );
  assert.match(
    JSON.stringify(openApiDocument.paths?.["/"] ?? {}),
    new RegExp(`up to ${workspacePackageImportPreviewRouteMaxZipBytes} bytes`),
  );
  assert.match(
    JSON.stringify(openApiDocument.paths?.["/agent"] ?? {}),
    new RegExp(`up to ${workspacePackageImportPreviewRouteMaxZipBytes} bytes`),
  );
});

test("workspace package import confirm publishes the direct route file limit", () => {
  assert.ok(workspacePackageImportConfirmRouteMaxZipBytes <= maximumLambdaProxySafeImageIngestionOriginalBytes);

  const apiBaseUrl = "https://api.flashcards-open-source-app.com/v1";
  const discoveryEnvelope = createAgentDiscoveryEnvelope(`${apiBaseUrl}/agent`);
  const openApiDocument = loadPublishedOpenApiDocument();
  const operation = loadWorkspacePackageImportOperation(openApiDocument);
  const requestBodyContent = operation.requestBody?.content ?? {};

  assert.match(operation.description ?? "", new RegExp(`${workspacePackageImportConfirmRouteMaxZipBytes} bytes`));
  assert.match(discoveryEnvelope.instructions, new RegExp(`up to ${workspacePackageImportConfirmRouteMaxZipBytes} bytes`));
  assert.equal(
    requestBodyContent["multipart/form-data"]?.schema?.properties?.file?.maxLength,
    workspacePackageImportConfirmRouteMaxZipBytes,
  );
  assert.match(
    JSON.stringify(openApiDocument.paths?.["/"] ?? {}),
    new RegExp(`up to ${workspacePackageImportConfirmRouteMaxZipBytes} bytes`),
  );
  assert.match(
    JSON.stringify(openApiDocument.paths?.["/agent"] ?? {}),
    new RegExp(`up to ${workspacePackageImportConfirmRouteMaxZipBytes} bytes`),
  );
});

test("agent setup envelopes point API-key clients to the media-capable discovery surface", () => {
  const accountEnvelope = createAgentAccountEnvelope(
    testAgentRequestUrl,
    testApiKeyRequestContext,
    testAgentWorkspaceReplicaId,
  );
  const envelopes = [
    accountEnvelope,
    createAgentWorkspacesEnvelope(testAgentRequestUrl, [], null),
    createAgentWorkspacesEnvelope(testAgentRequestUrl, [testUnselectedWorkspaceSummary], null),
    createAgentWorkspacesEnvelope(testAgentRequestUrl, [testWorkspaceSummary], null),
    createAgentWorkspaceReadyEnvelope(testAgentRequestUrl, testWorkspaceSummary),
  ];

  for (const envelope of envelopes) {
    assert.match(envelope.instructions, /GET https:\/\/api\.flashcards-open-source-app\.com\/v1\/agent/);
    assert.match(envelope.instructions, /media-capable discovery surface/);
    assert.match(envelope.instructions, /multipart upload session/);
    assert.match(envelope.instructions, /download URL templates/);
    assert.match(envelope.instructions, /data\.agentWorkspaceReplicaId/);
    assert.match(envelope.instructions, /lastModifiedByReplicaId/);
    assertDoesNotAdvertiseUploadIntentFlow(envelope.instructions, "Agent setup instructions");
  }

  assert.equal(accountEnvelope.data.agentWorkspaceReplicaId, testAgentWorkspaceReplicaId);
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
