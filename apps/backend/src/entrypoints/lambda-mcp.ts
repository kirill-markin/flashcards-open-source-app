/**
 * Lambda entry point for the dedicated MCP API Gateway on mcp.<domain>.
 *
 * Serves the OAuth Protected Resource Metadata (PRM) document, a Bearer 401
 * challenge, and the Streamable HTTP `/mcp` transport that exposes the single
 * `sql` tool. Every `/mcp` request must carry an OAuth Bearer access token,
 * which resolves to a connection (user + selected workspace) before the MCP
 * server runs.
 *
 * The canonical MCP resource is `https://mcp.<domain>/mcp` (no `/v1` stage
 * prefix), and the authorization server lives on `https://auth.<domain>`.
 *
 * Routes are mounted at both `/` and `/v1`, mirroring the auth app
 * (apps/auth/src/app.ts): custom-domain traffic on `mcp.<domain>` arrives
 * without a stage prefix, while the raw execute-api invoke URL delivers the
 * `/v1` stage name in the request path.
 */
import { handle } from "hono/aws-lambda";
import { type Context, Hono } from "hono";
import type { ContentfulStatusCode } from "hono/utils/http-status";
import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import { authenticateMcpAccessToken } from "../auth/mcpTokens";
import { createMcpServer } from "../mcp/server";
import { HttpError } from "../shared/errors";
import { getHttpErrorResponseHeaders } from "../server/app";
import {
  captureBackendException,
  createBackendObservationScope,
  initializeBackendSentry,
  normalizeCaughtError,
  wrapBackendHandler,
} from "../observability/sentry";
import { hasReportedBackendException } from "../observability/reporting";

initializeBackendSentry("backend-api");

const supportedScopes = ["flashcards"] as const;

/**
 * Resolves the public base domain from the environment. Backend Lambdas are
 * wired with `MCP_BASE_DOMAIN`, and we fail loudly rather than serve a
 * metadata document pointing at the wrong host.
 */
function getBaseDomain(): string {
  const baseDomain = process.env.MCP_BASE_DOMAIN;
  if (baseDomain === undefined || baseDomain.trim() === "") {
    throw new Error("MCP_BASE_DOMAIN environment variable is required for the MCP handler");
  }

  return baseDomain.trim();
}

function getResourceUrl(baseDomain: string): string {
  return `https://mcp.${baseDomain}/mcp`;
}

function getAuthorizationServerUrl(baseDomain: string): string {
  return `https://auth.${baseDomain}`;
}

/**
 * RFC 9728 §3.1 path-aware Protected Resource Metadata URL. Because the
 * resource identifier carries a `/mcp` path, the well-known suffix is inserted
 * between the host and the path, so spec-current MCP clients that derive the
 * metadata URL from the resource find the document and the `resource` field
 * matches what they expect.
 */
function getProtectedResourceMetadataUrl(baseDomain: string): string {
  return `https://mcp.${baseDomain}/.well-known/oauth-protected-resource/mcp`;
}

function buildProtectedResourceMetadata(baseDomain: string): Record<string, unknown> {
  return {
    resource: getResourceUrl(baseDomain),
    authorization_servers: [getAuthorizationServerUrl(baseDomain)],
    bearer_methods_supported: ["header"],
    scopes_supported: [...supportedScopes],
  };
}

const BEARER_PREFIX_PATTERN = /^Bearer\s+(\S+)$/i;

/**
 * Builds the shared Bearer 401 challenge so an unauthenticated or invalid-token
 * `/mcp` request points spec-current MCP clients at the PRM document.
 */
function buildBearerChallenge(c: Context, baseDomain: string): Response {
  return c.json(
    {
      error: "invalid_token",
      error_description: "A valid OAuth Bearer token is required to access the MCP resource.",
    },
    401,
    {
      "WWW-Authenticate": `Bearer resource_metadata="${getProtectedResourceMetadataUrl(baseDomain)}"`,
    },
  );
}

function extractBearerToken(authorization: string | undefined): string | null {
  if (authorization === undefined) {
    return null;
  }

  const match = BEARER_PREFIX_PATTERN.exec(authorization.trim());
  return match === null ? null : match[1];
}

/**
 * Runs one stateless MCP request: a fresh server + Web Standard Streamable HTTP
 * transport per call, with `enableJsonResponse` so the buffered API Gateway
 * Lambda integration returns a single JSON-RPC response instead of an SSE
 * stream. The transport is closed after the response is produced.
 *
 * DNS-rebinding protection is enabled with the canonical MCP host on the
 * allowlist (MCP spec recommendation for Streamable HTTP servers). Real client
 * traffic arrives on the custom domain `mcp.<domain>` (API Gateway forwards the
 * custom-domain Host to the Lambda); the non-canonical execute-api host is not
 * used by real clients because issued tokens bind to the custom-domain
 * `resource` and would 401 on any other host.
 */
async function handleMcpTransportRequest(
  request: Request,
  connection: Awaited<ReturnType<typeof authenticateMcpAccessToken>>,
  baseDomain: string,
): Promise<Response> {
  const server = createMcpServer(connection, getResourceUrl(baseDomain));
  const transport = new WebStandardStreamableHTTPServerTransport({
    sessionIdGenerator: undefined,
    enableJsonResponse: true,
    enableDnsRebindingProtection: true,
    allowedHosts: [`mcp.${baseDomain}`],
  });

  try {
    await server.connect(transport);
    return await transport.handleRequest(request);
  } finally {
    await transport.close();
    await server.close();
  }
}

function buildMcpRoutes(app: Hono): Hono {
  app.get("/health", (c) => c.json({ status: "ok" }));

  // Serve PRM at both the RFC 9728 path-aware location (`/mcp` suffix, used by
  // spec-current clients) and the legacy path-less location (older clients).
  // Both return the same document with `resource` = https://mcp.<domain>/mcp.
  const protectedResourceMetadata = (c: Context) =>
    c.json(buildProtectedResourceMetadata(getBaseDomain()));

  app.get("/.well-known/oauth-protected-resource/mcp", protectedResourceMetadata);
  app.get("/.well-known/oauth-protected-resource", protectedResourceMetadata);

  app.all("/mcp", async (c) => {
    const baseDomain = getBaseDomain();
    const token = extractBearerToken(c.req.header("authorization"));
    if (token === null) {
      return buildBearerChallenge(c, baseDomain);
    }

    let connection: Awaited<ReturnType<typeof authenticateMcpAccessToken>>;
    try {
      connection = await authenticateMcpAccessToken(token, getResourceUrl(baseDomain));
    } catch (error) {
      if (error instanceof HttpError && error.statusCode === 401) {
        return buildBearerChallenge(c, baseDomain);
      }

      throw error;
    }

    // Stateless JSON mode only services request/response POSTs. A GET would make
    // the transport open a never-ending SSE stream that the buffered Lambda then
    // closes empty, and DELETE has no session to terminate, so reject non-POST
    // methods cleanly instead of routing them into the transport.
    if (c.req.method !== "POST") {
      return c.json(
        {
          error: "method_not_allowed",
          error_description: "The MCP resource only accepts POST in stateless JSON mode.",
        },
        405,
        { Allow: "POST" },
      );
    }

    return handleMcpTransportRequest(c.req.raw, connection, baseDomain);
  });

  return app;
}

const app = new Hono();
// Mount at `/` (custom domain root) and `/v1` (execute-api stage path).
app.route("/", buildMcpRoutes(new Hono()));
app.route("/", buildMcpRoutes(new Hono().basePath("/v1")));

// Mirror the HTTP agent surface (apps/backend/src/server/app.ts `app.onError`):
// errors that escape the tool try/catch -- transport-layer faults
// (`server.connect`, `transport.handleRequest`, `transport.close`) and any
// non-401 error rethrown from the `/mcp` auth catch -- are captured to Sentry,
// dedup-guarded, instead of falling through to Hono's default unreported 500.
// An HttpError preserves its real statusCode/code and the same Retry-After
// header the HTTP surface emits (getHttpErrorResponseHeaders), so a transient
// 503 SERVICE_UNAVAILABLE from the auth-layer DB boundary surfaces as a
// retryable signal rather than an opaque 500, and a future 4xx HttpError keeps
// its real status. Any non-HttpError/unknown failure collapses to a generic
// sanitized 500 (no driver/stack internals). The 401 Bearer challenge and
// tool-layer error handling are unchanged.
app.onError((error, context) => {
  const normalizedError = normalizeCaughtError(error);
  // Mirror the HTTP surface's shouldCaptureRequestFailureException core rule
  // (apps/backend/src/server/app.ts): only report unexpected/5xx errors. A
  // future 4xx HttpError thrown from a /mcp PRM/transport path stays unreported,
  // matching the HTTP agent surface. The benign-code exclusions there
  // (AuthError, CHAT_LIVE_RESUME_CONTRACT_VIOLATION, ...) are not reachable on
  // the MCP transport, so they are not replicated.
  const shouldCapture = error instanceof HttpError ? error.statusCode >= 500 : true;
  if (shouldCapture && hasReportedBackendException(normalizedError) === false) {
    captureBackendException({
      action: "request_failed",
      error: normalizedError,
      scope: createBackendObservationScope(
        "backend-api",
        null,
        "mcp",
        context.req.method,
        null,
        null,
        null,
        null,
        null,
      ),
      details: {
        statusCode: error instanceof HttpError ? error.statusCode : 500,
        code: error instanceof HttpError ? (error.code ?? "INTERNAL_ERROR") : "INTERNAL_ERROR",
        message: error instanceof Error ? error.message : String(error),
        validationIssues: [],
      },
    });
  }

  if (error instanceof HttpError) {
    context.status(error.statusCode as ContentfulStatusCode);
    for (const [name, value] of getHttpErrorResponseHeaders(error)) {
      context.header(name, value);
    }
    return context.json({ error: error.message, code: error.code ?? "INTERNAL_ERROR" });
  }

  return context.json({ error: "Internal Server Error", code: "INTERNAL_ERROR" }, 500);
});

// Sentry.wrapHandler: performs the per-invocation flush before the Lambda
// freezes, so the buffered captureBackendException events above (and the
// mcp/server.ts 5xx/unexpected captures) are actually delivered. This is the
// buffered-handler equivalent of lambda.ts:134 and matches how lambda.ts
// delivers buffered events.
export const handler = wrapBackendHandler(handle(app));
