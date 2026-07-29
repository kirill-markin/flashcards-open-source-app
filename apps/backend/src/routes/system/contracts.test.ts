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
  properties?: Readonly<Record<string, OpenApiBinarySchemaForTest>>;
}>;
type OpenApiMediaTypeForTest = Readonly<{
  schema?: OpenApiBinarySchemaForTest;
}>;
type OpenApiRequestBodyForTest = Readonly<{
  content?: Readonly<Record<string, OpenApiMediaTypeForTest>>;
}>;
type OpenApiResponseForTest = Readonly<{
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
