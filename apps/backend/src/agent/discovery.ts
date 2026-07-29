import { getPublicAgentDocs, getPublicApiBaseUrl, getPublicLegalLinks } from "../shared/publicUrls";
import { maximumImageIngestionOriginalBytes } from "../mediaAssets/validators";
import {
  workspacePackageImportConfirmRouteMaxZipBytes,
  workspacePackageImportPreviewRouteMaxZipBytes,
} from "../routes/workspacePackages";

type AgentDiscoveryEnvelope = Readonly<{
  ok: true;
  data: Readonly<{
    service: Readonly<{
      name: string;
      version: "v1";
      description: string;
    }>;
    authentication: Readonly<{
      type: "email_otp_then_api_key";
      sendCodeUrl: string;
      verifyCodeUrl: string;
    }>;
    capabilitiesBeforeLogin: ReadonlyArray<string>;
    capabilitiesAfterLogin: ReadonlyArray<string>;
    authBaseUrl: string;
    apiBaseUrl: string;
    surface: Readonly<{
      accountUrl: string;
      workspacesUrl: string;
      sqlQueryUrl: string;
      sqlExecuteUrl: string;
      mediaAssetImageIngestionUrlTemplate: string;
      mediaAssetUploadSessionCreateUrlTemplate: string;
      mediaAssetUploadSessionPartsUrlTemplate: string;
      mediaAssetUploadSessionCompleteUrlTemplate: string;
      mediaAssetUploadSessionAbortUrlTemplate: string;
      mediaAssetMetadataUrlTemplate: string;
      mediaAssetDownloadUrlTemplate: string;
      workspacePackageExportPreviewUrlTemplate: string;
      workspacePackageExportUrlTemplate: string;
      workspacePackageImportPreviewUrlTemplate: string;
      workspacePackageImportUrlTemplate: string;
      catalogPackagesUrl: string;
      catalogPackageDetailUrlTemplate: string;
      catalogPackageVersionCardsUrlTemplate: string;
      catalogPackageMediaDownloadUrlTemplate: string;
      catalogPackageMediaDownloadTemplate: string;
      catalogPackageInstallPreviewUrlTemplate: string;
      catalogPackageInstallUrlTemplate: string;
    }>;
    mcp: Readonly<{
      url: string;
      description: string;
      authorization: Readonly<{
        type: "oauth2";
        authorizationServer: string;
        authorizationServerMetadataUrl: string;
        protectedResourceMetadataUrl: string;
      }>;
      apiKeyBearer: Readonly<{
        type: "api_key";
        header: "Authorization";
        scheme: "Bearer";
        description: string;
      }>;
    }>;
  }>;
  links: Readonly<{
    websiteUrl: string;
    privacyUrl: string;
    termsUrl: string;
    supportUrl: string;
    docsUrl: string;
  }>;
  instructions: string;
  docs: Readonly<{
    openapiUrl: string;
    docsUrl: string;
  }>;
}>;

function stripTrailingSlash(value: string): string {
  return value.endsWith("/") ? value.slice(0, -1) : value;
}

function toRequestOrigin(requestUrl: string): string {
  const url = new URL(requestUrl);
  return `${url.protocol}//${url.host}`;
}

function buildAuthBaseUrl(requestUrl: string): string {
  const configuredBaseUrl = process.env.PUBLIC_AUTH_BASE_URL;
  if (configuredBaseUrl !== undefined && configuredBaseUrl !== "") {
    return stripTrailingSlash(configuredBaseUrl);
  }

  const origin = toRequestOrigin(requestUrl);
  const host = new URL(requestUrl).host;
  if (host === "localhost:8080" || host === "127.0.0.1:8080") {
    return "http://localhost:8081";
  }

  return stripTrailingSlash(origin.replace("//api.", "//auth."));
}

function buildMcpBaseUrl(requestUrl: string): string {
  const configuredBaseUrl = process.env.PUBLIC_MCP_BASE_URL;
  if (configuredBaseUrl !== undefined && configuredBaseUrl !== "") {
    return stripTrailingSlash(configuredBaseUrl);
  }

  const origin = toRequestOrigin(requestUrl);
  const host = new URL(requestUrl).host;
  if (host === "localhost:8080" || host === "127.0.0.1:8080") {
    return "http://localhost:8082";
  }

  return stripTrailingSlash(origin.replace("//api.", "//mcp."));
}

export function createAgentDiscoveryEnvelope(requestUrl: string): AgentDiscoveryEnvelope {
  const authBaseUrl = buildAuthBaseUrl(requestUrl);
  const mcpBaseUrl = buildMcpBaseUrl(requestUrl);
  const apiBaseUrl = getPublicApiBaseUrl(requestUrl);
  const links = getPublicLegalLinks(requestUrl);
  const docs = { ...getPublicAgentDocs(requestUrl), docsUrl: links.docsUrl };
  const mediaAssetImageIngestionUrlTemplate = `${apiBaseUrl}/workspaces/{workspaceId}/media-assets/images`;
  const mediaAssetUploadSessionCreateUrlTemplate = `${apiBaseUrl}/workspaces/{workspaceId}/media-assets/upload-sessions`;
  const mediaAssetUploadSessionPartsUrlTemplate = `${apiBaseUrl}/workspaces/{workspaceId}/media-assets/upload-sessions/{sessionId}/parts`;
  const mediaAssetUploadSessionCompleteUrlTemplate = `${apiBaseUrl}/workspaces/{workspaceId}/media-assets/upload-sessions/{sessionId}/complete`;
  const mediaAssetUploadSessionAbortUrlTemplate = `${apiBaseUrl}/workspaces/{workspaceId}/media-assets/upload-sessions/{sessionId}/abort`;
  const mediaAssetMetadataUrlTemplate = `${apiBaseUrl}/workspaces/{workspaceId}/media-assets/{mediaAssetId}`;
  const mediaAssetDownloadUrlTemplate = `${apiBaseUrl}/workspaces/{workspaceId}/media-assets/{mediaAssetId}/download-url`;
  const workspacePackageExportPreviewUrlTemplate = `${apiBaseUrl}/workspaces/{workspaceId}/packages/export/preview`;
  const workspacePackageExportUrlTemplate = `${apiBaseUrl}/workspaces/{workspaceId}/packages/export`;
  const workspacePackageImportPreviewUrlTemplate = `${apiBaseUrl}/workspaces/{workspaceId}/packages/import/preview`;
  const workspacePackageImportUrlTemplate = `${apiBaseUrl}/workspaces/{workspaceId}/packages/import`;
  const catalogPackagesUrl = `${apiBaseUrl}/catalog/packages`;
  const catalogPackageDetailUrlTemplate = `${apiBaseUrl}/catalog/packages/{packageSlug}`;
  const catalogPackageVersionCardsUrlTemplate = `${apiBaseUrl}/catalog/package-versions/{packageVersionId}/cards`;
  const catalogPackageMediaDownloadUrlTemplate = `${apiBaseUrl}/catalog/package-versions/{packageVersionId}/media-assets/{packageMediaKey}/download-url`;
  const catalogPackageMediaDownloadTemplate = `${apiBaseUrl}/catalog/package-versions/{packageVersionId}/media-assets/{packageMediaKey}/download`;
  const catalogPackageInstallPreviewUrlTemplate = `${apiBaseUrl}/workspaces/{workspaceId}/catalog/package-versions/{packageVersionId}/install/preview`;
  const catalogPackageInstallUrlTemplate = `${apiBaseUrl}/workspaces/{workspaceId}/catalog/package-versions/{packageVersionId}/install`;

  const envelope: AgentDiscoveryEnvelope = {
    ok: true,
    data: {
      service: {
        name: "flashcards-open-source-app",
        version: "v1",
        description:
          "Offline-first flashcards service with user-owned workspaces, a compact SQL agent surface, and direct media transfer URLs.",
      },
      authentication: {
        type: "email_otp_then_api_key",
        sendCodeUrl: `${authBaseUrl}/api/agent/send-code`,
        verifyCodeUrl: `${authBaseUrl}/api/agent/verify-code`,
      },
      capabilitiesBeforeLogin: [
        "Read the public published package catalog, package detail, card previews, and package media download URLs",
      ],
      capabilitiesAfterLogin: [
        "Load account context",
        "Select a workspace",
        "Inspect the published SQL surface through OpenAPI and SQL introspection",
        "Read cards and decks through POST /agent/sql/query (read-only)",
        "Write cards and decks through POST /agent/sql/execute (INSERT, UPDATE, DELETE)",
        "Ingest JPEG, PNG, and WebP image bytes through the workspace-scoped image media endpoint",
        "Upload and complete media assets through workspace-scoped direct transfer endpoints",
        "Read media asset metadata and create download URLs through workspace-scoped media endpoints",
        "Preview and download portable workspace package ZIP exports, and preview or confirm ZIP imports",
        "Preview and install published catalog package versions into a workspace",
      ],
      authBaseUrl,
      apiBaseUrl,
      surface: {
        accountUrl: `${apiBaseUrl}/agent/me`,
        workspacesUrl: `${apiBaseUrl}/agent/workspaces`,
        sqlQueryUrl: `${apiBaseUrl}/agent/sql/query`,
        sqlExecuteUrl: `${apiBaseUrl}/agent/sql/execute`,
        mediaAssetImageIngestionUrlTemplate,
        mediaAssetUploadSessionCreateUrlTemplate,
        mediaAssetUploadSessionPartsUrlTemplate,
        mediaAssetUploadSessionCompleteUrlTemplate,
        mediaAssetUploadSessionAbortUrlTemplate,
        mediaAssetMetadataUrlTemplate,
        mediaAssetDownloadUrlTemplate,
        workspacePackageExportPreviewUrlTemplate,
        workspacePackageExportUrlTemplate,
        workspacePackageImportPreviewUrlTemplate,
        workspacePackageImportUrlTemplate,
        catalogPackagesUrl,
        catalogPackageDetailUrlTemplate,
        catalogPackageVersionCardsUrlTemplate,
        catalogPackageMediaDownloadUrlTemplate,
        catalogPackageMediaDownloadTemplate,
        catalogPackageInstallPreviewUrlTemplate,
        catalogPackageInstallUrlTemplate,
      },
      mcp: {
        url: `${mcpBaseUrl}/mcp`,
        description:
          "Remote MCP server for AI clients that connect through custom connectors (for example Claude.ai or ChatGPT). Add the url as a custom connector and authorize through OAuth, then use the sql_query tool to read and the sql_execute tool to write cards and decks. Headless or CLI clients may instead send Authorization: Bearer fca_… using the agent API key from email_otp_then_api_key login (the same key as the REST agent surface), with no OAuth or browser needed.",
        authorization: {
          type: "oauth2",
          authorizationServer: authBaseUrl,
          authorizationServerMetadataUrl: `${authBaseUrl}/.well-known/oauth-authorization-server`,
          protectedResourceMetadataUrl: `${mcpBaseUrl}/.well-known/oauth-protected-resource`,
        },
        apiKeyBearer: {
          type: "api_key",
          header: "Authorization",
          scheme: "Bearer",
          description:
            "Send the agent API key (fca_…) as a Bearer token for headless/CLI use; same key as the REST agent surface.",
        },
      },
    },
    links,
    instructions:
      `Public catalog reads do not require authentication: use GET ${catalogPackagesUrl} to list or search published packages, GET ${catalogPackageDetailUrlTemplate} for package detail, GET ${catalogPackageVersionCardsUrlTemplate} for card previews, GET ${catalogPackageMediaDownloadUrlTemplate} for a backend-controlled media download URL, and GET ${catalogPackageMediaDownloadTemplate} for the media bytes. For authenticated workspace operations, start with POST ${authBaseUrl}/api/agent/send-code using the user's email. After send-code, follow the returned instructions: normal accounts require the 8-digit email code, while configured review/demo accounts use a deterministic 8-digit placeholder and do not send email. Do not immediately replay send-code. Then POST ${authBaseUrl}/api/agent/verify-code with the otpSessionToken, code, and label to obtain an API key. After login, call GET ${apiBaseUrl}/agent/me, then GET ${apiBaseUrl}/agent/workspaces?limit=100. If no workspace is selected for this API key, call POST ${apiBaseUrl}/agent/workspaces/{workspaceId}/select or create one with POST ${apiBaseUrl}/agent/workspaces using {"name":"Personal"}. After workspace bootstrap, call GET ${apiBaseUrl}/agent/me and use data.agentWorkspaceReplicaId as lastModifiedByReplicaId when creating media assets and catalog installs. Use POST ${apiBaseUrl}/agent/sql/query for all shared card and deck reads (SHOW TABLES, DESCRIBE, SHOW COLUMNS, SELECT) and POST ${apiBaseUrl}/agent/sql/execute for all writes (INSERT, UPDATE, DELETE). For JPEG, PNG, or WebP images up to ${maximumImageIngestionOriginalBytes} bytes, prefer POST ${mediaAssetImageIngestionUrlTemplate} with the image bytes as the request body and x-media-asset-id, x-media-created-at, x-media-client-updated-at, x-media-last-modified-by-replica-id, and x-media-last-operation-id headers; the backend normalizes to canonical JPEG bytes and returns the mediaAsset. For other media assets, create a multipart upload session with POST ${mediaAssetUploadSessionCreateUrlTemplate}; if status is already_available, use the returned mediaAsset and skip byte upload. If status is upload_required, request signed part URLs with POST ${mediaAssetUploadSessionPartsUrlTemplate}, upload each part with the returned signed URL, method, and headers, then complete the upload with POST ${mediaAssetUploadSessionCompleteUrlTemplate}. Abort unused sessions with POST ${mediaAssetUploadSessionAbortUrlTemplate}. Use GET ${mediaAssetMetadataUrlTemplate} for registry metadata and GET ${mediaAssetDownloadUrlTemplate} for a range-capable direct download URL. Use POST ${workspacePackageExportPreviewUrlTemplate} to preview a portable workspace package export, then POST ${workspacePackageExportUrlTemplate} to download the ZIP. Use POST ${workspacePackageImportPreviewUrlTemplate} with application/zip bytes up to ${workspacePackageImportPreviewRouteMaxZipBytes} bytes to preview a portable workspace package import; confirm with POST ${workspacePackageImportUrlTemplate} as multipart/form-data with file ZIP bytes up to ${workspacePackageImportConfirmRouteMaxZipBytes} bytes and an options JSON string. Use POST ${catalogPackageInstallPreviewUrlTemplate} to preview installing a published catalog package version, then POST ${catalogPackageInstallUrlTemplate} with a unique installId and operationIdPrefix to create normal cards and logical media assets without copying object-storage bytes. For routine low-risk writes, a clear user request already counts as permission. Ask again only for risky or unclear actions. SELECT returns at most 100 rows per statement, and INSERT, UPDATE, and DELETE may affect at most 100 rows per statement. If you need more than 100 writes, split the work into multiple batches of at most 100 records across separate SQL statements or separate tool calls. Use ${docs.openapiUrl} for the published external agent contract. The SQL surface is intentionally limited and is not full PostgreSQL.`,
    docs,
  };
  return {
    ...envelope,
    instructions: [
      envelope.instructions,
      "If session creation returns 503 MEDIA_ASSET_UPLOAD_SESSION_COMPLETION_IN_PROGRESS or MEDIA_ASSET_UPLOAD_SESSION_CREATION_IN_PROGRESS, wait for Retry-After and retry the same create request unchanged; do not start a parallel byte upload.",
    ].join(" "),
  };
}
