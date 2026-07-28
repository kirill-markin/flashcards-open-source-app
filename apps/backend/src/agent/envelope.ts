import type { PublicHttpErrorDetails } from "../shared/errors";
import { getPublicAgentDocs } from "../shared/publicUrls";

export type AgentDocs = Readonly<{
  openapiUrl: string;
}>;

export type AgentEnvelope<Data> = Readonly<{
  ok: true;
  data: Data;
  instructions: string;
  docs: AgentDocs;
}>;

export type AgentErrorEnvelope = Readonly<{
  ok: false;
  data: Record<string, never>;
  instructions: string;
  docs: AgentDocs;
  error: Readonly<{
    code: string;
    message: string;
    details?: PublicHttpErrorDetails;
  }>;
  requestId?: string;
}>;

export function createAgentEnvelope<Data>(
  requestUrl: string,
  data: Data,
  instructions: string,
): AgentEnvelope<Data> {
  return {
    ok: true,
    data,
    instructions,
    docs: getPublicAgentDocs(requestUrl),
  };
}

export function createAgentErrorEnvelope(
  requestUrl: string,
  code: string,
  message: string,
  instructions: string,
  requestId?: string,
  details?: PublicHttpErrorDetails,
): AgentErrorEnvelope {
  return {
    ok: false,
    data: {},
    instructions,
    docs: getPublicAgentDocs(requestUrl),
    error: {
      code,
      message,
      ...(details !== undefined ? { details } : {}),
    },
    requestId,
  };
}

export function isAgentApiKeyAuthorizationHeader(
  authorizationHeader: string | null | undefined,
): boolean {
  return authorizationHeader !== null
    && authorizationHeader !== undefined
    && authorizationHeader.startsWith("ApiKey ");
}

export function createAgentErrorInstructions(
  code: string | null,
  statusCode: number,
): string {
  switch (code) {
    case "SERVICE_UNAVAILABLE":
      return "Retry the same request after the Retry-After delay. If it fails again, treat it as a server-side error and stop changing the request. Use requestId when debugging.";
    case "AUTH_VERIFICATION_TEMPORARILY_UNAVAILABLE":
      return "Retry the same authenticated request after the Retry-After delay without changing the token. If it keeps failing, sign in again and use requestId when debugging.";
    case "MEDIA_BLOB_LIFECYCLE_BUSY":
    case "MEDIA_ASSET_WRITER_BUSY":
    case "MEDIA_ASSET_INGESTION_DEADLINE_EXCEEDED":
      return "Retry the unchanged request after the Retry-After delay. If it fails again, stop and use requestId when debugging.";
    case "AUTH_UNAUTHORIZED":
    case "AGENT_API_KEY_INVALID":
      return "Use a valid non-revoked API key in the Authorization header as: ApiKey $FLASHCARDS_OPEN_SOURCE_API_KEY after exporting it once. If needed, restart from GET /v1/agent.";
    case "QUERY_INVALID_SQL":
    case "QUERY_UNSUPPORTED_SYNTAX":
      return "Fix the sql string using error.message and any error.details.validationIssues, then retry the same endpoint: POST /v1/agent/sql/query for reads or POST /v1/agent/sql/execute for writes. Use docs.openapiUrl for the published SQL dialect.";
    case "WORKSPACE_SELECTION_REQUIRED":
      return "Call GET /v1/agent/me, then GET /v1/agent/workspaces?limit=100. A first workspace is auto-provisioned for new users. If data.nextCursor is not null, continue with the same limit and cursor=data.nextCursor. If multiple workspaces exist, select one with POST /v1/agent/workspaces/{workspaceId}/select before calling POST /v1/agent/sql/query or POST /v1/agent/sql/execute.";
    case "WORKSPACE_ID_REQUIRED":
    case "WORKSPACE_ID_INVALID":
      return "Provide a valid workspaceId UUID in the request URL, then retry the action.";
    case "DATABASE_COMMIT_OUTCOME_UNKNOWN":
      return "Do not blindly replay the same request. Reload and check the current state first, then retry only if the requested change is confirmed absent. Use requestId when debugging.";
  }

  if (statusCode >= 500) {
    return "Retry the same request once. If it fails again, treat it as a server-side error and stop changing the request. Use requestId when debugging.";
  }

  if (statusCode === 404) {
    return "Verify that the referenced resource id exists in the selected workspace, then retry only after correcting the id.";
  }

  if (statusCode >= 400) {
    return "Fix the request using error.message and any error.details.validationIssues, then retry the same request.";
  }

  return "If the issue persists, reload account context from GET /v1/agent/me or restart from GET /v1/agent.";
}

export function createAgentApiKeyErrorEnvelope(
  requestUrl: string,
  code: string,
  message: string,
  statusCode: number,
  requestId: string | undefined,
  details: PublicHttpErrorDetails | undefined,
): AgentErrorEnvelope {
  return createAgentErrorEnvelope(
    requestUrl,
    code,
    message,
    createAgentErrorInstructions(code, statusCode),
    requestId,
    details,
  );
}
