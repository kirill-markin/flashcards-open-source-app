import { createHash } from "node:crypto";
import { unsafeQuery } from "../database/unsafe";
import { HttpError } from "../shared/errors";

/**
 * Resolved MCP connection for one validated OAuth Bearer access token.
 *
 * Mirrors the agent API-key resolution result (apps/backend/src/agent/apiKeys.ts
 * `AuthenticatedAgentApiKey`): an access token maps to one OAuth connection,
 * which fixes the user and the currently selected workspace for the request.
 */
export type AuthenticatedMcpAccessToken = Readonly<{
  userId: string;
  connectionId: string;
  selectedWorkspaceId: string | null;
}>;

type McpAccessTokenRow = Readonly<{
  user_id: string;
  connection_id: string;
  selected_workspace_id: string | null;
  expires_at: Date | string;
  resource: string;
  connection_revoked_at: Date | string | null;
}>;

const MCP_TOKEN_INVALID_CODE = "MCP_ACCESS_TOKEN_INVALID";

function hashAccessToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

function toTimestampMs(value: Date | string): number {
  return value instanceof Date ? value.getTime() : new Date(value).getTime();
}

/**
 * Authenticates an OAuth Bearer access token against `auth.oauth_access_tokens`
 * and resolves the owning connection.
 *
 * The `auth.oauth_*` tables carry no Row Level Security (see
 * db/migrations/0074_oauth_mcp_authorization.sql): isolation is enforced by the
 * hashed-secret point lookup here, exactly like the guest-session sibling those
 * tables mirror. We therefore resolve with `unsafeQuery` (no request scope) and
 * the returned `userId` becomes the trusted scope for all downstream work.
 *
 * Validation rejects a token when it is missing, expired, issued for a different
 * resource than `expectedResource`, or backed by a revoked connection. Every
 * failure returns the same opaque 401 so callers cannot probe token state.
 *
 * Scope is intentionally not enforced here: by current contract every issued MCP
 * access token is full-access (the single `sql` tool is read + write), and scope
 * issuance is owned by the OAuth authorization/consent items (03/06). The
 * `auth.oauth_access_tokens.scope` column is therefore not read yet. When a
 * future item issues narrower-scoped tokens (e.g. read-only), this resolver must
 * start selecting and asserting that scope before granting tool access.
 */
export async function authenticateMcpAccessToken(
  token: string,
  expectedResource: string,
): Promise<AuthenticatedMcpAccessToken> {
  const trimmedToken = token.trim();
  if (trimmedToken === "") {
    throw new HttpError(401, "Invalid MCP access token", MCP_TOKEN_INVALID_CODE);
  }

  const result = await unsafeQuery<McpAccessTokenRow>(
    [
      "SELECT",
      "  c.user_id AS user_id,",
      "  t.connection_id AS connection_id,",
      "  c.selected_workspace_id AS selected_workspace_id,",
      "  t.expires_at AS expires_at,",
      "  t.resource AS resource,",
      "  c.revoked_at AS connection_revoked_at",
      "FROM auth.oauth_access_tokens t",
      "JOIN auth.oauth_connections c ON c.connection_id = t.connection_id",
      "WHERE t.token_hash = $1",
    ].join(" "),
    [hashAccessToken(trimmedToken)],
  );

  const row = result.rows[0];
  if (row === undefined) {
    throw new HttpError(401, "Invalid MCP access token", MCP_TOKEN_INVALID_CODE);
  }

  if (row.connection_revoked_at !== null) {
    throw new HttpError(401, "Invalid MCP access token", MCP_TOKEN_INVALID_CODE);
  }

  if (toTimestampMs(row.expires_at) <= Date.now()) {
    throw new HttpError(401, "Invalid MCP access token", MCP_TOKEN_INVALID_CODE);
  }

  if (row.resource !== expectedResource) {
    throw new HttpError(401, "Invalid MCP access token", MCP_TOKEN_INVALID_CODE);
  }

  return {
    userId: row.user_id,
    connectionId: row.connection_id,
    selectedWorkspaceId: row.selected_workspace_id,
  };
}
