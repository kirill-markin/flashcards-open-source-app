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
import { isPublicCatalogAuthorWebsiteUrlValid } from "../../catalog/publicSafety";
import {
  isValidMediaAssetLastOperationId,
  maximumMediaAssetLastOperationIdLength,
} from "../../mediaAssets/lastOperationId";
import { createSourceDiscoveryResponse } from "../../shared/sourceDiscovery";
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
  catalogSnapshotUrl: "/catalog",
  catalogPackagesUrl: "/catalog/packages",
  catalogPackageDetailUrlTemplate: "/catalog/packages/{packageSlug}",
  catalogPackageVersionCardsUrlTemplate: "/catalog/package-versions/{packageVersionId}/cards",
  catalogPackageMediaDownloadUrlTemplate: "/catalog/package-versions/{packageVersionId}/media-assets/{packageMediaKey}/download-url",
  catalogPackageMediaDownloadTemplate: "/catalog/package-versions/{packageVersionId}/media-assets/{packageMediaKey}/download",
  catalogPackageInstallPreviewUrlTemplate: "/workspaces/{workspaceId}/catalog/package-versions/{packageVersionId}/install/preview",
  catalogPackageInstallUrlTemplate: "/workspaces/{workspaceId}/catalog/package-versions/{packageVersionId}/install",
} as const;
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

function assertDoesNotAdvertiseUploadIntentFlow(value: string, label: string): void {
  assert.doesNotMatch(value, /upload[-\s]?intents?/i, `${label} must not advertise the legacy upload intent flow`);
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

  assert.match(
    apiGatewaySource,
    /const publicSiteOrigin = parsePublicOrigin\(\s*props\.siteBaseUrl \?\? `https:\/\/\$\{props\.baseDomain\}`,\s*"siteBaseUrl",\s*\);/,
  );
  assert.match(apiGatewaySource, /const publicCatalogAllowedOrigins = \[\s*publicSiteOrigin,/);
  assert.match(apiGatewaySource, /const allowedOrigins = \[\s*publicAppOrigin/);
  assert.match(apiGatewaySource, /createPublicCatalogCorsPreflightOptions\(publicCatalogAllowedOrigins\)/);
  assert.match(apiGatewaySource, /catalog\.addMethod\("GET", integration\);/);
  assert.match(apiGatewaySource, /\.addResource\("\{proxy\+}", \{\s*defaultCorsPreflightOptions: createPublicCatalogCorsPreflightOptions\(publicCatalogAllowedOrigins\),\s*\}\)\s*\.addMethod\("GET", integration\);/);
  assert.match(apiGatewaySource, /PUBLIC_APP_BASE_URL: props\.publicAppOrigin/);
  assert.match(apiGatewaySource, /BACKEND_ALLOWED_ORIGINS: props\.allowedOrigins\.join\(","\)/);
});

test("all conventional document probes build the same concise source-discovery response", () => {
  const requestBaseUrl = "https://api.flashcards-open-source-app.com/v1";
  const responses = [
    "/openapi.json",
    "/swagger.json",
    "/agent/openapi.json",
    "/agent/swagger.json",
  ].map((path) => createSourceDiscoveryResponse(`${requestBaseUrl}${path}`));
  const response = responses[0];
  assert.ok(response !== undefined);

  for (const aliasResponse of responses.slice(1)) {
    assert.deepEqual(aliasResponse, response);
  }
  assert.deepEqual(Object.keys(response), [
    "ok",
    "openapiAvailable",
    "message",
    "discoveryUrl",
    "docsUrl",
    "source",
  ]);
  assert.equal(response.ok, true);
  assert.equal(response.openapiAvailable, false);
  assert.match(response.message, /^[\x20-\x7e]{1,100}$/u);
  assert.equal(response.discoveryUrl, `${requestBaseUrl}/`);
  assert.equal(response.docsUrl, "https://flashcards-open-source-app.com/docs/");
  assert.deepEqual(response.source, {
    repositoryUrl: "https://github.com/kirill-markin/flashcards-open-source-app",
    agentRoutesUrl: "https://github.com/kirill-markin/flashcards-open-source-app/tree/main/apps/backend/src/routes",
    authRoutesUrl: "https://github.com/kirill-markin/flashcards-open-source-app/tree/main/apps/auth/src/routes/agent",
  });
  assert.equal("openapi" in response, false);
});

test("author website runtime policy accepts only canonical absolute HTTP URLs", () => {
  const cases = [
    ["HTTPS://authors.example.test/profile", true],
    ["HtTp://[2001:db8::1]:8080/profile", true],
    ["https://192.0.2.1:8443/profile", true],
    ["https://authors.example.test:/profile", false],
    ["https://authors.example.test:99999/profile", false],
    ["https://999.999.999.999/profile", false],
    ["https://[::::]/profile", false],
    [" https://authors.example.test/profile", false],
    ["https://authors.example.test/profile ", false],
    ["https:///authors.example.test/profile", false],
    ["https:////authors.example.test/profile", false],
  ] as const;

  for (const [websiteUrl, expected] of cases) {
    assert.equal(
      isPublicCatalogAuthorWebsiteUrlValid(websiteUrl),
      expected,
      `Runtime URL policy mismatch for ${websiteUrl}`,
    );
  }
});

test("operation identifier validators enforce their runtime limits", () => {
  for (const [value, expected] of [
    ["550e8400-e29b-41d4-a716-446655440000", true],
    ["01ARZ3NDEKTSV4RRFFQ69G5FAV", true],
    ["operation with internal spaces", true],
    [" leading-space", false],
    ["trailing-space ", false],
    ["operation\ncontrol", false],
    ["operation\u00a0nbsp", false],
  ] as const) {
    assert.equal(isValidMediaAssetLastOperationId(value), expected, value);
    assert.equal(isValidWorkspacePackageImportOperationIdPrefix(value), expected, value);
    assert.equal(isValidCatalogPackageInstallOperationIdPrefix(value), expected, value);
  }

  assert.equal(
    isValidMediaAssetLastOperationId("a".repeat(maximumMediaAssetLastOperationIdLength)),
    true,
  );
  assert.equal(
    isValidWorkspacePackageImportOperationIdPrefix(
      "a".repeat(workspacePackageImportOperationIdPrefixMaximumLength + 1),
    ),
    false,
  );
  assert.equal(
    isValidCatalogPackageInstallOperationIdPrefix(
      "a".repeat(catalogPackageInstallOperationIdPrefixMaximumLength + 1),
    ),
    false,
  );
});

test("catalog install discovery explains tag choices and idempotency", () => {
  const discoveryEnvelope = createAgentDiscoveryEnvelope(testAgentRequestUrl);

  assert.match(discoveryEnvelope.instructions, /source tagCounts and defaultOptions/);
  assert.match(discoveryEnvelope.instructions, /addImportTag, importTag, and removeTags/);
  assert.match(discoveryEnvelope.instructions, /Omitting all three tag options preserves source tags/);
  assert.match(discoveryEnvelope.instructions, /catalog ordinal order/);
  assert.match(discoveryEnvelope.instructions, /workspace-scoped idempotency key/);
  assert.match(discoveryEnvelope.instructions, /not a successful replay/);
});

test("agent discovery explains retryable multipart replacement gating", () => {
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
});

test("agent discovery advertises the published media, package, and catalog surface", () => {
  const apiBaseUrl = "https://api.flashcards-open-source-app.com/v1";
  const discoveryEnvelope = createAgentDiscoveryEnvelope(`${apiBaseUrl}/agent`);

  assert.deepEqual(discoveryEnvelope.data.capabilitiesBeforeLogin, [
    "Read the complete public catalog snapshot, package detail, card previews, and package media download URLs",
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
    "MEDIA_ASSET_UPLOAD_SESSION_NOT_FOUND",
    "WORKSPACE_ACCESS_DENIED",
    "MEDIA_ASSET_REPLICA_INVALID",
    "DATABASE_COMMIT_OUTCOME_UNKNOWN",
    "MEDIA_ASSET_STORAGE_UNAVAILABLE",
    "MEDIA_BLOB_LIFECYCLE_BUSY",
    "SERVICE_UNAVAILABLE",
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
  assert.match(discoveryEnvelope.instructions, /404 MEDIA_ASSET_UPLOAD_SESSION_NOT_FOUND/);
  assert.match(discoveryEnvelope.instructions, /verify sessionId/);
  assert.match(discoveryEnvelope.instructions, /rollback is not guaranteed/);
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
  assert.match(discoveryEnvelope.instructions, /catalog for the complete normalized snapshot/);
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

test("agent discovery publishes the transport-safe image body limit", () => {
  assert.ok(maximumImageIngestionOriginalBytes <= maximumLambdaProxySafeImageIngestionOriginalBytes);

  const apiBaseUrl = "https://api.flashcards-open-source-app.com/v1";
  const discoveryEnvelope = createAgentDiscoveryEnvelope(`${apiBaseUrl}/agent`);

  assert.match(discoveryEnvelope.instructions, new RegExp(`up to ${maximumImageIngestionOriginalBytes} bytes`));
});

test("agent discovery publishes the workspace package import preview body limit", () => {
  assert.ok(workspacePackageImportPreviewRouteMaxZipBytes <= maximumLambdaProxySafeImageIngestionOriginalBytes);

  const apiBaseUrl = "https://api.flashcards-open-source-app.com/v1";
  const discoveryEnvelope = createAgentDiscoveryEnvelope(`${apiBaseUrl}/agent`);

  assert.match(discoveryEnvelope.instructions, new RegExp(`up to ${workspacePackageImportPreviewRouteMaxZipBytes} bytes`));
});

test("agent discovery publishes the workspace package import confirm file limit", () => {
  assert.ok(workspacePackageImportConfirmRouteMaxZipBytes <= maximumLambdaProxySafeImageIngestionOriginalBytes);

  const apiBaseUrl = "https://api.flashcards-open-source-app.com/v1";
  const discoveryEnvelope = createAgentDiscoveryEnvelope(`${apiBaseUrl}/agent`);

  assert.match(discoveryEnvelope.instructions, new RegExp(`up to ${workspacePackageImportConfirmRouteMaxZipBytes} bytes`));
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
    assert.equal(envelope.docs.discoveryUrl, "https://api.flashcards-open-source-app.com/v1/");
    assert.equal(
      envelope.docs.source.agentRoutesUrl,
      "https://github.com/kirill-markin/flashcards-open-source-app/tree/main/apps/backend/src/routes",
    );
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
