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
import { authenticateMcpBearerToken } from "../auth/mcpTokens";
import { createMcpServer } from "../mcp/server";
import { normalizeMcpTelemetryHeader, runWithMcpRequestId } from "../mcp/requestTelemetry";
import { HttpError } from "../shared/errors";
import { logMcpRequestEvent } from "../server/logging";
import { getHttpErrorResponseHeaders } from "../server/httpErrorResponseHeaders";
import { parsePublicOrigin } from "../shared/publicUrls";
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
 * Per-request context, mirroring apps/backend/src/server/app.ts: one request id
 * is generated per request and read back by `app.onError`, so every response
 * and every observation of the same request carries the same id.
 */
type McpAppEnv = {
  Variables: {
    requestId: string;
  };
};

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

/**
 * Resolves the public marketing-site origin surfaced in the MCP implementation
 * metadata. Env-driven via `PUBLIC_SITE_BASE_URL` (self-hosters set their own
 * domain, mirroring the discovery envelope's legal links); when unset it
 * defaults to the apex origin derived from `MCP_BASE_DOMAIN`.
 */
function getWebsiteUrl(baseDomain: string): string {
  const configuredValue = process.env.PUBLIC_SITE_BASE_URL;
  if (configuredValue !== undefined && configuredValue !== "") {
    return parsePublicOrigin(configuredValue, "PUBLIC_SITE_BASE_URL");
  }

  return parsePublicOrigin(`https://${baseDomain}`, "PUBLIC_SITE_BASE_URL");
}

/**
 * Resolves the absolute https URL of the served branded SVG icon advertised in
 * the MCP implementation `icons`. Derived from the same public site origin as
 * `getWebsiteUrl` (env `PUBLIC_SITE_BASE_URL`, fallback to the apex origin from
 * `MCP_BASE_DOMAIN`) and pointed at the served `/icon.svg`, so self-hosters
 * advertise their own icon without extra configuration.
 */
function getIconUrl(baseDomain: string): string {
  return `${getWebsiteUrl(baseDomain)}/icon.svg`;
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
 * Character length of the response body, measured without disturbing the
 * response the client receives. The transport runs with `enableJsonResponse`,
 * so a buffered JSON body can be read from a clone; anything else is left
 * unmeasured rather than risk consuming a stream the client needs.
 */
async function measureResponseBodyChars(response: Response): Promise<number | null> {
  if (response.body === null) {
    return 0;
  }

  const contentType = response.headers.get("content-type");
  if (contentType === null || contentType.toLowerCase().includes("application/json") === false) {
    return null;
  }

  return (await response.clone().text()).length;
}

/**
 * `measureResponseBodyChars` with its own failure boundary, and `null` when the
 * branch produced no response at all. A clone or a body read that rejects costs
 * this one field of one record, never the record itself, which is why the
 * emitter below resolves the size here before it decides to emit.
 */
async function resolveResponseBodyChars(response: Response | null): Promise<number | null> {
  if (response === null) {
    return null;
  }

  try {
    return await measureResponseBodyChars(response);
  } catch {
    return null;
  }
}

/**
 * The authenticated connection (user + selected workspace) a `/mcp` request
 * runs under, resolved from the request's OAuth Bearer token.
 */
type AuthenticatedMcpConnection = Awaited<ReturnType<typeof authenticateMcpBearerToken>>;

type McpRequestRecordInput = Readonly<{
  request: Request;
  connection: AuthenticatedMcpConnection;
  requestId: string;
  startedAtMs: number;
  statusCode: number;
  response: Response | null;
  toolName: string | null;
}>;

/**
 * Emits the one `mcp_request` record of an authenticated `/mcp` request. Every
 * branch of the route below that answers an authenticated client calls this
 * exactly once -- the transport response, the transport fault, and the non-POST
 * rejection alike -- so the record count is the authenticated request count.
 * The unauthenticated branches (no token, rejected token, auth-layer failure)
 * emit nothing: they have no connection, and this record is about traffic that
 * reached the resource.
 *
 * Its inputs are the request headers the MCP spec defines
 * (`MCP-Protocol-Version`, `Mcp-Method`, `User-Agent`, and `Mcp-Name` through
 * the caller-resolved `toolName`) plus the tool name the handlers report in
 * process, because `Mcp-Name` is only REQUIRED from MCP revision 2026-07-28 and
 * most live clients are older. Header values are client-controlled, so they are
 * normalized for telemetry and never validated: a missing or surprising header
 * must not change how a request that works today is served. The JSON-RPC body
 * is deliberately not parsed here; the transport owns it.
 *
 * Reading the response body and writing the record are purely observational, so
 * both are fenced, in two phases that keep the invariant above unconditional.
 * Phase one resolves the field values: every step that can fail -- today only
 * the response body measurement -- carries its own boundary and degrades to
 * `null`, so a value we could not resolve costs its field and not the record.
 * Phase two is the emit, and nothing awaited, optional, or computed for a field
 * sits inside it: once phase one has run, the record is written. Its fence
 * exists only so writing the record can neither fail a request that was already
 * answered, nor escape into a caller's catch and produce a second record for
 * one request.
 */
async function emitMcpRequestRecord(input: McpRequestRecordInput): Promise<void> {
  // Phase one: resolve the field values. The duration is taken before the body
  // is measured, so it stays the time spent serving the request rather than the
  // time spent observing it.
  const durationMs = Date.now() - input.startedAtMs;
  const responseChars = await resolveResponseBodyChars(input.response);
  const record = {
    requestId: input.requestId,
    httpMethod: input.request.method,
    userId: input.connection.userId,
    workspaceId: input.connection.selectedWorkspaceId,
    connectionId: input.connection.connectionId,
    caller: normalizeMcpTelemetryHeader(input.request.headers.get("user-agent")),
    protocolVersion: normalizeMcpTelemetryHeader(
      input.request.headers.get("mcp-protocol-version"),
    ),
    jsonRpcMethod: normalizeMcpTelemetryHeader(input.request.headers.get("mcp-method")),
    toolName: input.toolName,
    statusCode: input.statusCode,
    durationMs,
    responseChars,
  };

  // Phase two: emit the resolved record.
  try {
    logMcpRequestEvent(record);
  } catch {
    // Observability must not change the response the client receives.
  }
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
 *
 * Exactly one `mcp_request` telemetry record is emitted per request through the
 * shared `emitMcpRequestRecord` above, on the response path and on the
 * transport-fault path alike. The record names the tool the handlers report in
 * process, falling back to the `Mcp-Name` header when no handler ran.
 *
 * The request id is the one the `X-Request-Id` middleware below generated for
 * this request, so it is on every response of this surface including the ones
 * `app.onError` builds. It is published for the duration of the transport call,
 * so the `agent_sql` records the SQL tools emit underneath it and the Sentry
 * captures the tool layer makes both carry it and join to this record.
 */
async function handleMcpTransportRequest(
  request: Request,
  connection: AuthenticatedMcpConnection,
  baseDomain: string,
  requestId: string,
  startedAtMs: number,
): Promise<Response> {
  const caller = normalizeMcpTelemetryHeader(request.headers.get("user-agent"));
  const headerToolName = normalizeMcpTelemetryHeader(request.headers.get("mcp-name"));
  // Every tool the request runs, in call order. The last one is what the record
  // names, so a batched request still produces exactly one record.
  const invokedToolNames: Array<string> = [];
  const server = createMcpServer(
    connection,
    getResourceUrl(baseDomain),
    getWebsiteUrl(baseDomain),
    getIconUrl(baseDomain),
    {
      caller,
      recordInvokedTool: (toolName) => {
        invokedToolNames.push(toolName);
      },
    },
  );
  const transport = new WebStandardStreamableHTTPServerTransport({
    sessionIdGenerator: undefined,
    enableJsonResponse: true,
    enableDnsRebindingProtection: true,
    allowedHosts: [`mcp.${baseDomain}`],
  });
  const emitRequestRecord = (statusCode: number, response: Response | null): Promise<void> =>
    emitMcpRequestRecord({
      request,
      connection,
      requestId,
      startedAtMs,
      statusCode,
      response,
      toolName: invokedToolNames.at(-1) ?? headerToolName,
    });

  try {
    await server.connect(transport);
    const response = await runWithMcpRequestId(requestId, () => transport.handleRequest(request));
    // The transport builds its own Response rather than one built through the
    // Hono context, so the middleware's request id is carried over onto it.
    response.headers.set("X-Request-Id", requestId);
    await emitRequestRecord(response.status, response);

    return response;
  } catch (error) {
    // A transport-layer fault produces no response here; app.onError below turns
    // it into the client-facing status this records.
    await emitRequestRecord(error instanceof HttpError ? error.statusCode : 500, null);

    throw error;
  } finally {
    await transport.close();
    await server.close();
  }
}

function buildMcpRoutes(app: Hono<McpAppEnv>): Hono<McpAppEnv> {
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

    let connection: AuthenticatedMcpConnection;
    try {
      connection = await authenticateMcpBearerToken(token, getResourceUrl(baseDomain));
    } catch (error) {
      if (error instanceof HttpError && error.statusCode === 401) {
        return buildBearerChallenge(c, baseDomain);
      }

      throw error;
    }

    const requestId = c.get("requestId");
    // One clock for both branches below, started where the request is known to
    // be authenticated, so `durationMs` measures the same thing on every record.
    const startedAtMs = Date.now();

    // Stateless JSON mode only services request/response POSTs. A GET would make
    // the transport open a never-ending SSE stream that the buffered Lambda then
    // closes empty, and DELETE has no session to terminate, so reject non-POST
    // methods cleanly instead of routing them into the transport.
    if (c.req.method !== "POST") {
      const response = c.json(
        {
          error: "method_not_allowed",
          error_description: "The MCP resource only accepts POST in stateless JSON mode.",
        },
        405,
        { Allow: "POST" },
      );
      // MCP revisions 2025-03-26 through 2025-11-25 let a client open the
      // standalone notification stream with `GET /mcp`, so a client that keeps
      // attempting it and accepting the rejection is ordinary authenticated
      // traffic here, and exactly the client-compatibility signal this record
      // exists to surface. Emitted from the route because the transport helper
      // never sees these requests, and awaited before returning so one
      // authenticated request still means exactly one record.
      await emitMcpRequestRecord({
        request: c.req.raw,
        connection,
        requestId,
        startedAtMs,
        statusCode: 405,
        response,
        toolName: null,
      });

      return response;
    }

    return handleMcpTransportRequest(c.req.raw, connection, baseDomain, requestId, startedAtMs);
  });

  return app;
}

const app = new Hono<McpAppEnv>();
// Mirrors the HTTP surface (apps/backend/src/server/app.ts): the request id is
// generated and put on the response before any handler runs, so it survives
// onto the error responses `app.onError` builds below and not only onto the
// successful transport response.
app.use("*", async (context, next) => {
  const requestId = crypto.randomUUID();
  context.set("requestId", requestId);
  context.header("X-Request-Id", requestId);
  await next();
});
// Mount at `/` (custom domain root) and `/v1` (execute-api stage path).
app.route("/", buildMcpRoutes(new Hono<McpAppEnv>()));
app.route("/", buildMcpRoutes(new Hono<McpAppEnv>().basePath("/v1")));

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
        context.get("requestId"),
        "mcp",
        context.req.method,
        null,
        null,
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
