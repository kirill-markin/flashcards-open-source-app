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
import {
  catalogPackageInstallOperationIdPrefixMaximumLength,
  isValidCatalogPackageInstallOperationIdPrefix,
} from "../../catalog";
import {
  isValidMediaAssetLastOperationId,
  maximumMediaAssetLastOperationIdLength,
} from "../../mediaAssets/lastOperationId";
import { loadOpenApiDocument } from "../../shared/openapi";
import { maximumImageIngestionOriginalBytes } from "../../mediaAssets/validators";
import {
  workspacePackageImportConfirmRouteMaxZipBytes,
  workspacePackageImportPreviewRouteMaxZipBytes,
} from "../workspacePackages";
import {
  isValidWorkspacePackageImportOperationIdPrefix,
  workspacePackageImportOperationIdPrefixMaximumLength,
} from "../../workspacePackages/import/operationIds";
import type { RequestContext } from "../../server/requestContext";
import type { WorkspaceSummary } from "../../workspaces";

const operationMethodNames = ["get", "post", "put", "patch", "delete", "options", "head", "trace"] as const;

type OperationMethodName = (typeof operationMethodNames)[number];
type PathItemForTest = Readonly<Partial<Record<OperationMethodName, object>>>;
type OpenApiBinarySchemaForTest = Readonly<{
  $ref?: string;
  type?: string;
  format?: string;
  minLength?: number;
  maxLength?: number;
  pattern?: string;
  default?: string | boolean | ReadonlyArray<string>;
  required?: ReadonlyArray<string>;
  properties?: Readonly<Record<string, OpenApiBinarySchemaForTest>>;
}>;
type OpenApiMediaTypeForTest = Readonly<{
  schema?: OpenApiBinarySchemaForTest;
}>;
type OpenApiRequestBodyForTest = Readonly<{
  content?: Readonly<Record<string, OpenApiMediaTypeForTest>>;
}>;
type OpenApiResponseForTest = Readonly<{
  description?: string;
  headers?: Readonly<Record<string, object>>;
  content?: Readonly<Record<string, OpenApiMediaTypeForTest>>;
}>;
type OpenApiOperationForTest = Readonly<{
  description?: string;
  requestBody?: OpenApiRequestBodyForTest;
  responses?: Readonly<Record<string, OpenApiResponseForTest>>;
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
  required?: ReadonlyArray<string>;
  properties?: Readonly<{
    capabilitiesBeforeLogin?: object;
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
  "/workspaces/{workspaceId}/catalog/package-versions/{packageVersionId}/install/preview": ["post"],
  "/workspaces/{workspaceId}/catalog/package-versions/{packageVersionId}/install": ["post"],
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

const expectedAgentDiscoverySurfaceTemplates = {
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
  catalogPackagesUrl: "/catalog/packages",
  catalogPackageDetailUrlTemplate: "/catalog/packages/{packageSlug}",
  catalogPackageVersionCardsUrlTemplate: "/catalog/package-versions/{packageVersionId}/cards",
  catalogPackageMediaDownloadUrlTemplate: "/catalog/package-versions/{packageVersionId}/media-assets/{packageMediaKey}/download-url",
  catalogPackageMediaDownloadTemplate: "/catalog/package-versions/{packageVersionId}/media-assets/{packageMediaKey}/download",
  catalogPackageInstallPreviewUrlTemplate: "/workspaces/{workspaceId}/catalog/package-versions/{packageVersionId}/install/preview",
  catalogPackageInstallUrlTemplate: "/workspaces/{workspaceId}/catalog/package-versions/{packageVersionId}/install",
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

function loadApiGatewaySource(): string {
  const apiGatewayPath = resolve(process.cwd(), "../../infra/aws/lib/gateways/api-gateway.ts");
  return readFileSync(apiGatewayPath, "utf8");
}

function assertApiGatewayUsesBackendProxy(apiGatewaySource: string): void {
  assert.match(
    apiGatewaySource,
    /restApi\.root\.addResource\("\{proxy\+}"\)\.addMethod\("ANY", integration\);/,
  );
}

test("API Gateway proxies backend-owned browser and workspace routes", () => {
  const apiGatewaySource = loadApiGatewaySource();

  assertApiGatewayUsesBackendProxy(apiGatewaySource);
});

test("API Gateway proxy accepts package export and import preview routes with browser-safe binary media", () => {
  const apiGatewaySource = loadApiGatewaySource();

  assertApiGatewayUsesBackendProxy(apiGatewaySource);
  assert.match(apiGatewaySource, /binaryMediaTypes: \["\*\/\*"\]/);
});

test("API Gateway proxy accepts public catalog browser-safe binary media", () => {
  const apiGatewaySource = loadApiGatewaySource();

  assertApiGatewayUsesBackendProxy(apiGatewaySource);
  assert.match(apiGatewaySource, /binaryMediaTypes: \["\*\/\*"\]/);
});

test("API Gateway proxy forwards public catalog routes", () => {
  const apiGatewaySource = loadApiGatewaySource();

  assertApiGatewayUsesBackendProxy(apiGatewaySource);
});

test("API Gateway allows the public website origin for catalog browser reads", () => {
  const apiGatewaySource = loadApiGatewaySource();

  assert.match(apiGatewaySource, /const publicSiteOrigin = props\.siteBaseUrl \?\? `https:\/\/\$\{props\.baseDomain\}`;/);
  assert.match(apiGatewaySource, /const publicCatalogAllowedOrigins = \[\s*publicSiteOrigin,/);
  assert.match(apiGatewaySource, /const allowedOrigins = \[\s*`https:\/\/app\.\$\{props\.baseDomain\}`/);
  assert.match(apiGatewaySource, /createPublicCatalogCorsPreflightOptions\(publicCatalogAllowedOrigins\)/);
  assert.match(apiGatewaySource, /\.addResource\("\{proxy\+}", \{\s*defaultCorsPreflightOptions: createPublicCatalogCorsPreflightOptions\(publicCatalogAllowedOrigins\),\s*\}\)\s*\.addMethod\("GET", integration\);/);
  assert.match(apiGatewaySource, /BACKEND_ALLOWED_ORIGINS: props\.allowedOrigins\.join\(","\)/);
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

  const publicCatalogDownloadOperation = paths[
    "/catalog/package-versions/{packageVersionId}/media-assets/{packageMediaKey}/download"
  ]?.get as OpenApiOperationForTest | undefined;
  const publicCatalogDownloadContent = publicCatalogDownloadOperation?.responses?.["200"]?.content ?? {};
  assert.ok(publicCatalogDownloadContent["application/pdf"] !== undefined);
  assert.ok(publicCatalogDownloadContent["audio/mpeg"] !== undefined);
  assert.ok(publicCatalogDownloadContent["image/jpeg"] !== undefined);
  assert.ok(publicCatalogDownloadContent["image/png"] !== undefined);
  assert.ok(publicCatalogDownloadContent["image/webp"] !== undefined);
  assert.equal(publicCatalogDownloadContent["application/octet-stream"], undefined);
  assert.ok(publicCatalogDownloadOperation?.responses?.["415"] !== undefined);
  const publicCatalogDownloadUrlOperation = paths[
    "/catalog/package-versions/{packageVersionId}/media-assets/{packageMediaKey}/download-url"
  ]?.get as OpenApiOperationForTest | undefined;
  assert.ok(publicCatalogDownloadUrlOperation?.responses?.["415"] !== undefined);
});

test("published OpenAPI shares the backend last operation identifier contract", () => {
  const schemas = loadPublishedOpenApiDocument().components?.schemas ?? {};
  const canonicalSchema = schemas.MediaAssetLastOperationId as OpenApiBinarySchemaForTest | undefined;
  const responseSchema =
    schemas.MediaAssetLastOperationIdResponse as OpenApiBinarySchemaForTest | undefined;
  const mediaAssetSchema = schemas.MediaAsset as OpenApiBinarySchemaForTest | undefined;
  const uploadSessionSchema =
    schemas.MediaAssetUploadSessionCreateInput as OpenApiBinarySchemaForTest | undefined;
  const workspaceImportSchema =
    schemas.WorkspacePackageImportConfirmOptions as OpenApiBinarySchemaForTest | undefined;
  const catalogInstallSchema =
    schemas.CatalogPackageInstallConfirmInput as OpenApiBinarySchemaForTest | undefined;
  const mediaAssetLastOperationId = mediaAssetSchema?.properties?.lastOperationId;
  const uploadSessionLastOperationId =
    uploadSessionSchema?.properties?.lastOperationId;
  const workspaceImportPrefix = workspaceImportSchema?.properties?.operationIdPrefix;
  const catalogInstallPrefix = catalogInstallSchema?.properties?.operationIdPrefix;

  assert.equal(canonicalSchema?.minLength, 1);
  assert.equal(canonicalSchema?.maxLength, maximumMediaAssetLastOperationIdLength);
  assert.equal(responseSchema?.minLength, 1);
  assert.equal(responseSchema?.maxLength, undefined);
  assert.equal(
    mediaAssetLastOperationId?.$ref,
    "#/components/schemas/MediaAssetLastOperationIdResponse",
  );
  assert.equal(
    uploadSessionLastOperationId?.$ref,
    "#/components/schemas/MediaAssetLastOperationId",
  );
  assert.equal(
    workspaceImportPrefix?.maxLength,
    workspacePackageImportOperationIdPrefixMaximumLength,
  );
  assert.equal(
    catalogInstallPrefix?.maxLength,
    catalogPackageInstallOperationIdPrefixMaximumLength,
  );

  const canonicalPattern = new RegExp(canonicalSchema?.pattern ?? "");
  const responsePattern = new RegExp(responseSchema?.pattern ?? "");
  const workspaceImportPattern = new RegExp(workspaceImportPrefix?.pattern ?? "");
  const catalogInstallPattern = new RegExp(catalogInstallPrefix?.pattern ?? "");
  const values = [
    "550e8400-e29b-41d4-a716-446655440000",
    "01ARZ3NDEKTSV4RRFFQ69G5FAV",
    "operation with internal spaces",
    " leading-space",
    "trailing-space ",
    "operation\ncontrol",
    "operation\u00a0nbsp",
  ];
  for (const value of values) {
    assert.equal(canonicalPattern.test(value), isValidMediaAssetLastOperationId(value), value);
    assert.equal(
      workspaceImportPattern.test(value),
      isValidWorkspacePackageImportOperationIdPrefix(value),
      value,
    );
    assert.equal(
      catalogInstallPattern.test(value),
      isValidCatalogPackageInstallOperationIdPrefix(value),
      value,
    );
  }
  for (const [value, expected] of [
    ["", false],
    ["   ", false],
    ["legacy\u00a0operation", true],
    ["legacy-操作", true],
    ["legacy\noperation", true],
  ] as const) {
    assert.equal(responsePattern.test(value), expected, value);
  }
});

test("catalog install discovery and OpenAPI publish shared tag choices", () => {
  const openApiDocument = loadPublishedOpenApiDocument();
  const schemas = openApiDocument.components?.schemas ?? {};
  const previewSchema = schemas.CatalogPackageInstallPreviewResponse as OpenApiBinarySchemaForTest | undefined;
  const confirmInputSchema = schemas.CatalogPackageInstallConfirmInput as OpenApiBinarySchemaForTest | undefined;
  const confirmSummarySchema = schemas.CatalogPackageInstallConfirmSummary as OpenApiBinarySchemaForTest | undefined;
  const discoveryEnvelope = createAgentDiscoveryEnvelope(testAgentRequestUrl);

  assert.ok(previewSchema?.required?.includes("tagCounts"));
  assert.ok(previewSchema?.required?.includes("defaultOptions"));
  assert.equal(confirmInputSchema?.required?.includes("addImportTag"), false);
  assert.equal(confirmInputSchema?.required?.includes("importTag"), false);
  assert.equal(confirmInputSchema?.required?.includes("removeTags"), false);
  assert.equal(confirmInputSchema?.properties?.addImportTag?.default, false);
  assert.equal(confirmInputSchema?.properties?.importTag?.default, "");
  assert.deepEqual(confirmInputSchema?.properties?.removeTags?.default, []);
  assert.ok(confirmSummarySchema?.required?.includes("keptTagCount"));
  assert.ok(confirmSummarySchema?.required?.includes("removedTagCount"));
  assert.ok(confirmSummarySchema?.required?.includes("importTag"));
  assert.match(discoveryEnvelope.instructions, /source tagCounts and defaultOptions/);
  assert.match(discoveryEnvelope.instructions, /addImportTag, importTag, and removeTags/);
  assert.match(discoveryEnvelope.instructions, /Omitting all three tag options preserves source tags/);
  assert.match(discoveryEnvelope.instructions, /catalog ordinal order/);

  for (const path of ["/", "/agent"] as const) {
    const serializedPath = JSON.stringify(openApiDocument.paths?.[path] ?? {});
    assert.match(serializedPath, /source tagCounts and defaultOptions/);
    assert.match(serializedPath, /addImportTag, importTag, and removeTags/);
    assert.match(serializedPath, /catalog ordinal order/);
  }
});

test("multipart session create documents retryable replacement gating and exact 201 replay", () => {
  const openApiDocument = loadPublishedOpenApiDocument();
  const operation = openApiDocument.paths?.[
    "/workspaces/{workspaceId}/media-assets/upload-sessions"
  ]?.post as OpenApiOperationForTest | undefined;
  assert.ok(operation !== undefined);
  const serializedOperation = JSON.stringify(operation);
  assert.match(
    serializedOperation,
    /MEDIA_ASSET_UPLOAD_SESSION_COMPLETION_IN_PROGRESS/u,
  );
  assert.match(
    serializedOperation,
    /MEDIA_ASSET_UPLOAD_SESSION_CREATION_IN_PROGRESS/u,
  );
  assert.match(serializedOperation, /Retry-After/u);
  assert.match(operation.description ?? "", /same active session/u);

  const discovery = createAgentDiscoveryEnvelope(testAgentRequestUrl);
  assert.match(
    discovery.instructions,
    /MEDIA_ASSET_UPLOAD_SESSION_COMPLETION_IN_PROGRESS/u,
  );
  assert.match(
    discovery.instructions,
    /MEDIA_ASSET_UPLOAD_SESSION_CREATION_IN_PROGRESS/u,
  );
  assert.match(
    discovery.instructions,
    /retry the same create request unchanged/u,
  );
  for (const path of ["/", "/agent"] as const) {
    const serializedPath = JSON.stringify(openApiDocument.paths?.[path] ?? {});
    assert.match(
      serializedPath,
      /MEDIA_ASSET_UPLOAD_SESSION_COMPLETION_IN_PROGRESS/u,
    );
    assert.match(
      serializedPath,
      /MEDIA_ASSET_UPLOAD_SESSION_CREATION_IN_PROGRESS/u,
    );
  }
});

test("agent discovery advertises the published media, package, and catalog surface", () => {
  const apiBaseUrl = "https://api.flashcards-open-source-app.com/v1";
  const discoveryEnvelope = createAgentDiscoveryEnvelope(`${apiBaseUrl}/agent`);
  const openApiDocument = loadPublishedOpenApiDocument();
  const schemas = openApiDocument.components?.schemas ?? {};
  const discoveryDataSchema = schemas.AgentDiscoveryData as AgentDiscoveryDataSchemaForTest | undefined;
  const discoverySurfaceSchema = discoveryDataSchema?.properties?.surface;

  assert.ok(discoverySurfaceSchema !== undefined);
  assert.ok(discoveryDataSchema?.required?.includes("capabilitiesBeforeLogin"));
  assert.ok(discoveryDataSchema?.properties?.capabilitiesBeforeLogin !== undefined);
  assert.deepEqual(discoveryEnvelope.data.capabilitiesBeforeLogin, [
    "Read the public published package catalog, package detail, card previews, and package media download URLs",
  ]);
  assert.equal(
    discoveryEnvelope.data.capabilitiesAfterLogin.some((capability) => /public published package catalog/.test(capability)),
    false,
  );
  assert.ok(
    discoveryEnvelope.instructions.indexOf("Public catalog reads do not require authentication")
      < discoveryEnvelope.instructions.indexOf("For authenticated workspace operations"),
  );
  for (const [surfaceKey, pathTemplate] of Object.entries(expectedAgentDiscoverySurfaceTemplates)) {
    assert.equal(
      discoveryEnvelope.data.surface[surfaceKey as keyof typeof expectedAgentDiscoverySurfaceTemplates],
      `${apiBaseUrl}${pathTemplate}`,
    );
    assert.ok(
      expectedPublishedApiMethods[pathTemplate] !== undefined,
      `Discovery surface template ${surfaceKey} must be published in OpenAPI paths`,
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
  assert.match(
    discoveryEnvelope.instructions,
    /MEDIA_ASSET_UPLOAD_SESSION_COMPLETION_IN_PROGRESS/,
  );
  assert.match(
    discoveryEnvelope.instructions,
    /MEDIA_ASSET_UPLOAD_SESSION_COMPLETION_DEADLINE_EXCEEDED/,
  );
  assert.match(
    discoveryEnvelope.instructions,
    /completion returns 409 MEDIA_ASSET_UPLOAD_SESSION_EXPIRED/,
  );
  assert.match(
    discoveryEnvelope.instructions,
    /create a fresh upload session and upload the bytes again instead of retrying the same completion request/,
  );
  for (const errorCode of [
    "MEDIA_ASSET_UPLOAD_SESSION_RESTART_REQUIRED",
    "MEDIA_ASSET_UPLOAD_SESSION_COMPLETED",
    "MEDIA_ASSET_UPLOAD_SESSION_STATE_CONFLICT",
    "MEDIA_ASSET_UPLOAD_MISMATCH",
    "MEDIA_ASSET_UPLOAD_PROOF_MISMATCH",
    "MEDIA_ASSET_UPLOAD_NOT_FOUND",
    "MEDIA_ASSET_UPLOAD_SESSION_ACCESS_DENIED",
    "WORKSPACE_ACCESS_DENIED",
    "MEDIA_ASSET_REPLICA_INVALID",
  ]) {
    assert.match(
      discoveryEnvelope.instructions,
      new RegExp(errorCode),
    );
  }
  assert.match(
    discoveryEnvelope.instructions,
    /reload canonical session and media-asset state before acting/,
  );
  assert.match(
    discoveryEnvelope.instructions,
    /without blindly replaying or assuming rollback/,
  );
  assert.match(
    discoveryEnvelope.instructions,
    /MEDIA_ASSET_UPLOAD_SESSION_CREATION_IN_PROGRESS/,
  );
  assert.match(
    discoveryEnvelope.instructions,
    /foreground writer is live, abort returns 503/,
  );
  assert.match(
    discoveryEnvelope.instructions,
    /completion is pending or leased, abort returns 409/,
  );
  assert.match(
    discoveryEnvelope.instructions,
    /Both abort responses leave upload state and S3 unchanged/,
  );
  assert.match(
    discoveryEnvelope.instructions,
    /replacement session creation returns 503/,
  );
  assert.match(
    discoveryEnvelope.instructions,
    /session creation returns already_available/,
  );
  assertDoesNotAdvertiseUploadIntentFlow(discoveryEnvelope.instructions, "Agent discovery instructions");
  assert.match(discoveryEnvelope.instructions, /media-assets\/\{mediaAssetId\}\/download-url/);
  assert.match(discoveryEnvelope.instructions, /packages\/export\/preview/);
  assert.match(discoveryEnvelope.instructions, /packages\/export/);
  assert.match(discoveryEnvelope.instructions, /packages\/import\/preview/);
  assert.match(discoveryEnvelope.instructions, /packages\/import/);
  assert.match(discoveryEnvelope.instructions, /catalog\/packages/);
  assert.match(discoveryEnvelope.instructions, /catalog\/packages\/\{packageSlug\}/);
  assert.match(discoveryEnvelope.instructions, /catalog\/package-versions\/\{packageVersionId\}\/cards/);
  assert.match(discoveryEnvelope.instructions, /catalog\/package-versions\/\{packageVersionId\}\/media-assets\/\{packageMediaKey\}\/download-url/);
  assert.match(discoveryEnvelope.instructions, /catalog\/package-versions\/\{packageVersionId\}\/media-assets\/\{packageMediaKey\}\/download/);
  assert.match(discoveryEnvelope.instructions, /catalog\/package-versions\/\{packageVersionId\}\/install\/preview/);
  assert.match(discoveryEnvelope.instructions, /catalog\/package-versions\/\{packageVersionId\}\/install/);
  assert.match(discoveryEnvelope.instructions, /data\.agentWorkspaceReplicaId/);
  assert.match(discoveryEnvelope.instructions, /lastModifiedByReplicaId/);
});

test("multipart upload OpenAPI publishes durable completion recovery contracts", () => {
  const openApiDocument = loadPublishedOpenApiDocument();
  const discoveryEnvelope = createAgentDiscoveryEnvelope(
    "https://api.flashcards-open-source-app.com/v1/agent",
  );
  const createOperation = openApiDocument.paths?.[
    "/workspaces/{workspaceId}/media-assets/upload-sessions"
  ]?.post as OpenApiOperationForTest | undefined;
  const completeOperation = openApiDocument.paths?.[
    "/workspaces/{workspaceId}/media-assets/upload-sessions/{sessionId}/complete"
  ]?.post as OpenApiOperationForTest | undefined;
  const abortOperation = openApiDocument.paths?.[
    "/workspaces/{workspaceId}/media-assets/upload-sessions/{sessionId}/abort"
  ]?.post as OpenApiOperationForTest | undefined;

  assert.ok(createOperation !== undefined);
  assert.ok(completeOperation !== undefined);
  assert.ok(abortOperation !== undefined);
  assert.ok(createOperation.responses?.["503"]?.headers?.["Retry-After"]);
  assert.ok(completeOperation.responses?.["409"]?.headers?.["Retry-After"]);
  assert.ok(completeOperation.responses?.["503"]?.headers?.["Retry-After"]);
  assert.ok(abortOperation.responses?.["409"]?.headers?.["Retry-After"]);
  assert.ok(abortOperation.responses?.["503"]?.headers?.["Retry-After"]);
  const completeUnavailableResponse =
    JSON.stringify(completeOperation.responses?.["503"]);
  const completeInvalidResponse =
    JSON.stringify(completeOperation.responses?.["400"]);
  const completeAccessResponse =
    JSON.stringify(completeOperation.responses?.["403"]);
  const completeAccessDescription =
    completeOperation.responses?.["403"]?.description ?? "";
  const completeConflictResponse =
    JSON.stringify(completeOperation.responses?.["409"]);
  const completeConflictDescription =
    completeOperation.responses?.["409"]?.description ?? "";
  const completeNotFoundResponse =
    JSON.stringify(completeOperation.responses?.["404"]);
  const completeUnknownOutcomeResponse =
    JSON.stringify(completeOperation.responses?.["500"]);
  const abortUnavailableResponse =
    JSON.stringify(abortOperation.responses?.["503"]);
  const abortAccessResponse =
    JSON.stringify(abortOperation.responses?.["403"]);
  const abortNotFoundResponse =
    JSON.stringify(abortOperation.responses?.["404"]);
  const abortUnknownOutcomeResponse =
    JSON.stringify(abortOperation.responses?.["500"]);
  const abortUnavailableDescription =
    abortOperation.responses?.["503"]?.description ?? "";
  assert.match(
    JSON.stringify(createOperation.responses?.["503"]),
    /MEDIA_ASSET_UPLOAD_SESSION_COMPLETION_IN_PROGRESS/,
  );
  assert.match(
    JSON.stringify(createOperation.responses?.["503"]),
    /MEDIA_ASSET_UPLOAD_SESSION_CREATION_IN_PROGRESS/,
  );
  assert.match(
    completeUnavailableResponse,
    /same session and parts/,
  );
  assert.match(
    completeUnavailableResponse,
    /MEDIA_ASSET_UPLOAD_SESSION_COMPLETION_DEADLINE_EXCEEDED/,
  );
  for (const errorCode of [
    "MEDIA_ASSET_STORAGE_UNAVAILABLE",
    "MEDIA_BLOB_LIFECYCLE_BUSY",
    "SERVICE_UNAVAILABLE",
  ]) {
    assert.match(completeUnavailableResponse, new RegExp(errorCode));
    assert.match(abortUnavailableResponse, new RegExp(errorCode));
  }
  assert.match(completeUnavailableResponse, /do not assume rollback/);
  for (const errorCode of [
    "MEDIA_ASSET_PARTS_REQUIRED",
    "MEDIA_ASSET_PART_COUNT_INVALID",
    "MEDIA_ASSET_PART_NUMBER_INVALID",
    "MEDIA_ASSET_DUPLICATE_PART_NUMBER",
    "MEDIA_ASSET_PART_COUNT_MISMATCH",
    "MEDIA_ASSET_PART_SEQUENCE_INVALID",
    "MEDIA_ASSET_REPLICA_INVALID",
  ]) {
    assert.match(completeInvalidResponse, new RegExp(errorCode));
  }
  assert.match(completeInvalidResponse, /detected before storage/);
  assert.match(completeInvalidResponse, /do not assume rollback/);
  for (const errorCode of [
    "MEDIA_ASSET_UPLOAD_SESSION_ACCESS_DENIED",
    "WORKSPACE_ACCESS_DENIED",
  ]) {
    assert.match(completeAccessResponse, new RegExp(errorCode));
  }
  assert.match(completeAccessDescription, /before storage/);
  assert.match(
    completeAccessDescription,
    /during exact\s+resolution after storage work/,
  );
  assert.match(completeAccessDescription, /do not assume rollback/);
  assert.match(abortAccessResponse, /WORKSPACE_ACCESS_DENIED/);
  assert.match(abortAccessResponse, /before S3 abort admission/);
  assert.match(abortAccessResponse, /after admitted S3 work/);
  assert.match(abortAccessResponse, /do not assume rollback/);
  for (const errorCode of [
    "MEDIA_ASSET_UPLOAD_SESSION_RESTART_REQUIRED",
    "MEDIA_ASSET_UPLOAD_SESSION_EXPIRED",
    "MEDIA_ASSET_UPLOAD_SESSION_COMPLETION_IN_PROGRESS",
    "MEDIA_ASSET_UPLOAD_SESSION_COMPLETED",
    "MEDIA_ASSET_UPLOAD_SESSION_STATE_CONFLICT",
    "MEDIA_ASSET_UPLOAD_MISMATCH",
    "MEDIA_ASSET_UPLOAD_PROOF_MISMATCH",
    "MEDIA_ASSET_UPLOAD_NOT_FOUND",
  ]) {
    assert.match(completeConflictResponse, new RegExp(errorCode));
  }
  assert.match(completeConflictDescription, /before writer acquisition/);
  assert.match(
    completeConflictDescription,
    /session\s+cannot be completed; create a fresh upload session/,
  );
  assert.match(
    completeConflictDescription,
    /instead of retrying the same completion request/,
  );
  assert.match(
    completeConflictDescription,
    /Abort admission made no database or S3\s+mutation/,
  );
  assert.match(
    completeConflictDescription,
    /another completion won before\s+or during expiry cleanup/,
  );
  assert.match(
    completeConflictDescription,
    /before storage\s+or during exact resolution after storage work/,
  );
  assert.match(completeConflictResponse, /do not assume rollback/);
  assert.match(
    completeNotFoundResponse,
    /MEDIA_ASSET_UPLOAD_SESSION_NOT_FOUND/,
  );
  assert.match(completeNotFoundResponse, /wrong or stale/);
  assert.match(completeNotFoundResponse, /during exact resolution/);
  assert.match(completeNotFoundResponse, /Do not blindly retry/);
  assert.match(
    completeUnknownOutcomeResponse,
    /DATABASE_COMMIT_OUTCOME_UNKNOWN/,
  );
  assert.match(
    completeUnknownOutcomeResponse,
    /rollback is not guaranteed/,
  );
  assert.match(completeUnknownOutcomeResponse, /Reload or replay/);
  assert.match(
    abortNotFoundResponse,
    /MEDIA_ASSET_UPLOAD_SESSION_NOT_FOUND/,
  );
  assert.match(abortNotFoundResponse, /before abort admission/);
  assert.match(abortNotFoundResponse, /after admitted S3 work/);
  assert.match(abortNotFoundResponse, /Do not assume rollback/);
  assert.match(
    abortUnknownOutcomeResponse,
    /DATABASE_COMMIT_OUTCOME_UNKNOWN/,
  );
  assert.match(abortUnknownOutcomeResponse, /rollback is not guaranteed/);
  assert.match(abortUnknownOutcomeResponse, /Reload/);
  for (const discoveryContract of [
    discoveryEnvelope.instructions,
    JSON.stringify(openApiDocument.paths?.["/"]),
    JSON.stringify(openApiDocument.paths?.["/agent"]),
  ]) {
    assert.match(
      discoveryContract,
      /MEDIA_ASSET_UPLOAD_SESSION_EXPIRED/,
    );
    assert.match(
      discoveryContract,
      /fresh upload session/,
    );
    assert.match(
      discoveryContract,
      /instead of retrying the same completion request/,
    );
    for (const errorCode of [
      "MEDIA_ASSET_UPLOAD_SESSION_RESTART_REQUIRED",
      "MEDIA_ASSET_UPLOAD_SESSION_COMPLETED",
      "MEDIA_ASSET_UPLOAD_SESSION_STATE_CONFLICT",
      "MEDIA_ASSET_UPLOAD_MISMATCH",
      "MEDIA_ASSET_UPLOAD_PROOF_MISMATCH",
      "MEDIA_ASSET_UPLOAD_NOT_FOUND",
      "MEDIA_ASSET_UPLOAD_SESSION_ACCESS_DENIED",
      "WORKSPACE_ACCESS_DENIED",
      "MEDIA_ASSET_REPLICA_INVALID",
      "DATABASE_COMMIT_OUTCOME_UNKNOWN",
      "MEDIA_ASSET_STORAGE_UNAVAILABLE",
      "MEDIA_BLOB_LIFECYCLE_BUSY",
      "SERVICE_UNAVAILABLE",
    ]) {
      assert.match(discoveryContract, new RegExp(errorCode));
    }
    assert.match(
      discoveryContract,
      /404 MEDIA_ASSET_UPLOAD_SESSION_NOT_FOUND/,
    );
    assert.match(discoveryContract, /verify sessionId/);
    assert.match(
      discoveryContract,
      /rollback is not guaranteed/,
    );
    assert.match(
      discoveryContract,
      /reload canonical session and media-asset state before acting/,
    );
    assert.match(
      discoveryContract,
      /without blindly replaying or assuming rollback/,
    );
  }
  const abortConflictResponse =
    JSON.stringify(abortOperation.responses?.["409"]);
  assert.match(
    abortConflictResponse,
    /MEDIA_ASSET_UPLOAD_SESSION_COMPLETION_IN_PROGRESS/,
  );
  assert.match(
    abortConflictResponse,
    /MEDIA_ASSET_UPLOAD_SESSION_COMPLETED/,
  );
  assert.match(
    abortConflictResponse,
    /MEDIA_ASSET_UPLOAD_SESSION_STATE_CONFLICT/,
  );
  assert.match(abortConflictResponse, /no database/);
  assert.match(abortConflictResponse, /or S3 mutation occurred/);
  assert.match(abortConflictResponse, /pre-S3 abort admission/);
  assert.match(abortConflictResponse, /post-S3/);
  assert.match(
    abortOperation.responses?.["409"]?.description ?? "",
    /S3 abort work may or may not have run/,
  );
  assert.match(abortConflictResponse, /do not assume rollback/);
  assert.match(abortUnavailableResponse, /live foreground writer/);
  assert.match(
    abortUnavailableDescription,
    /no database\s+or S3 mutation occurred/,
  );
  assert.match(abortUnavailableResponse, /do not assume rollback/);
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

test("API Gateway proxy forwards /me/community/profile", () => {
  const apiGatewaySource = loadApiGatewaySource();

  assertApiGatewayUsesBackendProxy(apiGatewaySource);
});

test("API Gateway proxy forwards friend invitation routes", () => {
  const apiGatewaySource = loadApiGatewaySource();

  assertApiGatewayUsesBackendProxy(apiGatewaySource);
});

test("API Gateway proxy forwards /me/progress/leaderboard", () => {
  const apiGatewaySource = loadApiGatewaySource();

  assertApiGatewayUsesBackendProxy(apiGatewaySource);
});

test("API Gateway proxy forwards /me/progress/leaderboards/streak", () => {
  const apiGatewaySource = loadApiGatewaySource();

  assertApiGatewayUsesBackendProxy(apiGatewaySource);
});

test("API Gateway proxy forwards /me/progress/leaderboards/profiles/{publicProfileId}", () => {
  const apiGatewaySource = loadApiGatewaySource();

  assertApiGatewayUsesBackendProxy(apiGatewaySource);
});
