/**
 * Store/model over the auth.oauth_* tables backing the machine-facing OAuth 2.1
 * Authorization Server (RFC 8414 metadata, RFC 7591 DCR, and the token
 * endpoint). Tokens and authorization codes are opaque secrets shown to the
 * client once; only their SHA-256 hashes are persisted, mirroring the
 * hash-on-store / compare-on-read pattern from agentApiKeys.ts and
 * server/otp/crockford.ts.
 *
 * Per-user isolation for these tables is enforced at the application layer via
 * explicit WHERE clauses and hashed-secret point lookups (see
 * db/migrations/0074), so reads/writes use the unscoped `query`/`transaction`
 * helpers rather than the RLS-scoped variants.
 */
import { hasOAuthScope } from "./scopes.js";
import { signOidcIdToken } from "./oidcSigning.js";
import { randomUUID } from "node:crypto";
import { query, transaction, transactionWithUserScope, type DatabaseExecutor } from "../../db.js";
import { verifySessionTokenIdentity } from "../browserSession.js";
import {
  ensureUserSettingsAndSelectWorkspace,
  resolveOrCreateCanonicalUserId,
} from "../agent/userWorkspace.js";
import { createCrockfordToken, hashOpaqueToken, normalizeCrockfordToken } from "../otp/crockford.js";

const ACCESS_TOKEN_PREFIX = "fco";
const REFRESH_TOKEN_PREFIX = "fcr";
const OAUTH_TOKEN_SECRET_LENGTH = 40;
const CLIENT_ID_LENGTH = 24;
const AUTHORIZATION_CODE_SECRET_LENGTH = 40;
// Authorization codes are short-lived: the client redeems them at the token
// endpoint within seconds of the redirect (OAuth 2.1 recommends <= 10 minutes).
export const AUTHORIZATION_CODE_TTL_SECONDS = 600;
const AUTHORIZATION_CODE_TTL_MS = AUTHORIZATION_CODE_TTL_SECONDS * 1000;

export const ACCESS_TOKEN_TTL_SECONDS = 3600;
const ACCESS_TOKEN_TTL_MS = ACCESS_TOKEN_TTL_SECONDS * 1000;
// Refresh tokens are long-lived; the connection's revoked_at gate is the real
// lifecycle control, so no fixed expiry is set on issuance.

export type OAuthClient = Readonly<{
  clientId: string;
  redirectUris: ReadonlyArray<string>;
  tokenEndpointAuthMethod: string;
  clientName: string | null;
}>;

export type OAuthAuthorizationCode = Readonly<{
  clientId: string;
  connectionId: string;
  redirectUri: string;
  codeChallenge: string;
  codeChallengeMethod: string;
  scope: string | null;
  resource: string;
}>;

export type IssuedTokens = Readonly<{
  accessToken: string;
  refreshToken: string;
  expiresInSeconds: number;
  scope: string | null;
  resource: string;
  idToken: string | null;
}>;

type GrantContext = Readonly<{
  connectionId: string;
  scope: string | null;
  resource: string;
  identityEmail: string | null;
  identityEmailVerified: boolean | null;
}>;

type OAuthClientRow = Readonly<{
  client_id: string;
  redirect_uris: ReadonlyArray<string>;
  token_endpoint_auth_method: string;
  client_name: string | null;
}>;

type OAuthAuthorizationCodeRow = Readonly<{
  client_id: string;
  connection_id: string;
  redirect_uri: string;
  code_challenge: string;
  code_challenge_method: string;
  scope: string | null;
  resource: string;
  expires_at: Date | string;
  consumed_at: Date | string | null;
  nonce: string | null;
  identity_email: string | null;
  identity_email_verified: boolean | null;
}>;

type GrantContextRow = Readonly<{
  connection_id: string;
  resource: string;
  scope: string | null;
  identity_email: string | null;
  identity_email_verified: boolean | null;
}>;

function asMillis(value: Date | string): number {
  return (value instanceof Date ? value : new Date(value)).getTime();
}

function formatToken(prefix: string, secret: string): string {
  return `${prefix}_${secret}`;
}

/**
 * Parses an issued opaque token of the form `<prefix>_<secret>` back into its
 * bare Crockford secret, mirroring parseAgentApiKey in
 * apps/backend/src/agent/apiKeys.ts. Returns null on a malformed or
 * prefix-mismatched token so callers can map it to invalid_grant.
 *
 * Hashing asymmetry (do not "fix" by hashing the full value):
 *   - Authorization codes hash the full opaque value via hashOpaqueToken (no
 *     prefix is ever added to a code), so store and read hash identical bytes.
 *   - Access/refresh tokens are issued with a `fco_`/`fcr_` prefix but stored as
 *     the hash of the bare secret only. The read path MUST parse off the prefix
 *     and hash just the parsed secret, or storage and lookup hash different
 *     strings and every grant fails.
 */
function parseToken(prefix: string, token: string): string | null {
  const expectedPrefix = `${prefix.toUpperCase()}_`;
  const normalized = token.replace(/[\s-]/g, "").toUpperCase();
  if (!normalized.startsWith(expectedPrefix)) {
    return null;
  }

  const secret = normalized.slice(expectedPrefix.length);
  try {
    return normalizeCrockfordToken(secret, "oauth token secret");
  } catch {
    return null;
  }
}

export function createClientId(): string {
  return `fcc_${createCrockfordToken(CLIENT_ID_LENGTH)}`;
}

export async function getClient(clientId: string): Promise<OAuthClient | null> {
  const result = await query<OAuthClientRow>(
    [
      "SELECT client_id, redirect_uris, token_endpoint_auth_method, client_name",
      "FROM auth.oauth_clients",
      "WHERE client_id = $1",
    ].join(" "),
    [clientId],
  );
  const row = result.rows[0];
  if (row === undefined) {
    return null;
  }

  return mapClient(row);
}

export async function saveClient(
  redirectUris: ReadonlyArray<string>,
  clientName: string | null,
): Promise<OAuthClient> {
  const clientId = createClientId();
  const result = await query<OAuthClientRow>(
    [
      "INSERT INTO auth.oauth_clients",
      "(client_id, redirect_uris, token_endpoint_auth_method, client_name)",
      "VALUES ($1, $2, 'none', $3)",
      "RETURNING client_id, redirect_uris, token_endpoint_auth_method, client_name",
    ].join(" "),
    [clientId, redirectUris, clientName],
  );
  const row = result.rows[0];
  if (row === undefined) {
    throw new Error("Failed to register OAuth client");
  }

  return mapClient(row);
}

function mapClient(row: OAuthClientRow): OAuthClient {
  return {
    clientId: row.client_id,
    redirectUris: row.redirect_uris,
    tokenEndpointAuthMethod: row.token_endpoint_auth_method,
    clientName: row.client_name,
  };
}

export async function getActiveAuthorizationCode(
  code: string,
  nowMs: number,
): Promise<OAuthAuthorizationCode | null> {
  const codeHash = hashOpaqueToken(code);
  const result = await query<OAuthAuthorizationCodeRow>(
    [
      "SELECT client_id, connection_id, redirect_uri, code_challenge, code_challenge_method,",
      "scope, resource, expires_at, consumed_at, nonce, identity_email, identity_email_verified",
      "FROM auth.oauth_authorization_codes",
      "WHERE code_hash = $1",
    ].join(" "),
    [codeHash],
  );
  const row = result.rows[0];
  if (row === undefined || row.consumed_at !== null || asMillis(row.expires_at) <= nowMs) {
    return null;
  }

  return {
    clientId: row.client_id,
    connectionId: row.connection_id,
    redirectUri: row.redirect_uri,
    codeChallenge: row.code_challenge,
    codeChallengeMethod: row.code_challenge_method,
    scope: row.scope,
    resource: row.resource,
  };
}

export type AuthorizationGrantRequest = Readonly<{
  clientId: string;
  redirectUri: string;
  codeChallenge: string;
  scope: string | null;
  resource: string;
  connectionLabel: string;
  nonce: string | null;
}>;

async function upsertConnectionInExecutor(
  executor: DatabaseExecutor,
  userId: string,
  clientId: string,
  label: string,
  selectedWorkspaceId: string | null,
): Promise<string> {
  // One active connection per (user, client): reuse the existing row on
  // reconnect so revoking it stays a single, predictable action for the user.
  // A connection revoked earlier is un-revoked here because the user is
  // explicitly re-approving the same client.
  const existing = await executor.query<{ connection_id: string }>(
    [
      "SELECT connection_id",
      "FROM auth.oauth_connections",
      "WHERE user_id = $1 AND client_id = $2",
      "ORDER BY created_at DESC, connection_id DESC",
      "LIMIT 1",
    ].join(" "),
    [userId, clientId],
  );

  const existingConnectionId = existing.rows[0]?.connection_id;
  if (existingConnectionId !== undefined) {
    await executor.query(
      [
        "UPDATE auth.oauth_connections",
        // COALESCE preserves an existing workspace binding when the resolver
        // returns null (multi-workspace users), so reconnect does not clobber a
        // previously selected workspace back to NULL.
        "SET label = $2, selected_workspace_id = COALESCE($3, auth.oauth_connections.selected_workspace_id), revoked_at = NULL",
        "WHERE connection_id = $1",
      ].join(" "),
      [existingConnectionId, label, selectedWorkspaceId],
    );
    return existingConnectionId;
  }

  const connectionId = randomUUID();
  await executor.query(
    [
      "INSERT INTO auth.oauth_connections",
      "(connection_id, user_id, client_id, label, selected_workspace_id)",
      "VALUES ($1, $2, $3, $4, $5)",
    ].join(" "),
    [connectionId, userId, clientId, label, selectedWorkspaceId],
  );
  return connectionId;
}

export async function approveAuthorizationRequest(
  idToken: string,
  request: AuthorizationGrantRequest,
  nowMs: number,
): Promise<string> {
  const identity = await verifySessionTokenIdentity(idToken);
  const userId = await resolveOrCreateCanonicalUserId(identity.userId, identity.email);
  const code = createCrockfordToken(AUTHORIZATION_CODE_SECRET_LENGTH);
  const codeHash = hashOpaqueToken(code);
  const expiresAt = new Date(nowMs + AUTHORIZATION_CODE_TTL_MS).toISOString();

  await transactionWithUserScope({ userId }, async (executor) => {
    const selectedWorkspaceId = await ensureUserSettingsAndSelectWorkspace(
      executor,
      userId,
      identity.email,
    );
    const connectionId = await upsertConnectionInExecutor(
      executor,
      userId,
      request.clientId,
      request.connectionLabel,
      selectedWorkspaceId,
    );

    await executor.query(
      [
        "INSERT INTO auth.oauth_authorization_codes",
        "(code_hash, client_id, connection_id, redirect_uri, code_challenge,",
        "code_challenge_method, scope, resource, expires_at, nonce, identity_email, identity_email_verified)",
        "VALUES ($1, $2, $3, $4, $5, 'S256', $6, $7, $8, $9, $10, $11)",
      ].join(" "),
      [
        codeHash,
        request.clientId,
        connectionId,
        request.redirectUri,
        request.codeChallenge,
        request.scope,
        request.resource,
        expiresAt,
        request.nonce,
        hasOAuthScope(request.scope, "email") ? identity.email : null,
        hasOAuthScope(request.scope, "email") ? identity.emailVerified : null,
      ],
    );
  });

  return code;
}

async function issueTokensInExecutor(
  executor: DatabaseExecutor,
  grant: GrantContext,
  nowMs: number,
): Promise<IssuedTokens> {
  const accessSecret = createCrockfordToken(OAUTH_TOKEN_SECRET_LENGTH);
  const refreshSecret = createCrockfordToken(OAUTH_TOKEN_SECRET_LENGTH);
  // Store the hash of the bare secret only; the read path parses the prefix off
  // the presented token before hashing (see parseToken).
  const accessHash = hashOpaqueToken(accessSecret);
  const refreshHash = hashOpaqueToken(refreshSecret);
  const accessExpiresAt = new Date(nowMs + ACCESS_TOKEN_TTL_MS).toISOString();

  await executor.query(
    [
      "INSERT INTO auth.oauth_access_tokens",
      "(token_hash, connection_id, scope, resource, expires_at, identity_email, identity_email_verified)",
      "VALUES ($1, $2, $3, $4, $5, $6, $7)",
    ].join(" "),
    [accessHash, grant.connectionId, grant.scope, grant.resource, accessExpiresAt, grant.identityEmail, grant.identityEmailVerified],
  );
  await executor.query(
    [
      "INSERT INTO auth.oauth_refresh_tokens",
      "(token_hash, connection_id, scope, resource, identity_email, identity_email_verified)",
      "VALUES ($1, $2, $3, $4, $5, $6)",
    ].join(" "),
    [refreshHash, grant.connectionId, grant.scope, grant.resource, grant.identityEmail, grant.identityEmailVerified],
  );

  return {
    accessToken: formatToken(ACCESS_TOKEN_PREFIX, accessSecret),
    refreshToken: formatToken(REFRESH_TOKEN_PREFIX, refreshSecret),
    expiresInSeconds: ACCESS_TOKEN_TTL_SECONDS,
    scope: grant.scope,
    resource: grant.resource,
    idToken: null,
  };
}

/**
 * Atomically consumes an authorization code and mints a fresh access/refresh
 * token pair bound to the code's connection. The single-use guard
 * (`consumed_at IS NULL` in the UPDATE) makes a concurrent double-redeem of the
 * same code fail rather than issue two token pairs. Returns null when the code
 * was already consumed between verification and this call.
 */
export async function consumeAuthorizationCodeAndIssueTokens(
  code: string,
  issuer: string,
  nowMs: number,
): Promise<IssuedTokens | null> {
  const codeHash = hashOpaqueToken(code);

  return transaction(async (executor) => {
    const consumed = await executor.query<OAuthAuthorizationCodeRow & Readonly<{ user_id: string }>>(
      [
        "UPDATE auth.oauth_authorization_codes",
        "SET consumed_at = now()",
        "WHERE code_hash = $1 AND consumed_at IS NULL AND expires_at > now()",
        // Gate minting on an active connection, matching the refresh path: a
        // connection revoked between code issuance and redemption must not mint.
        "AND connection_id IN (",
        "SELECT connection_id FROM auth.oauth_connections WHERE revoked_at IS NULL",
        ")",
        "RETURNING client_id, connection_id, redirect_uri, code_challenge, code_challenge_method,",
        "scope, resource, expires_at, consumed_at, nonce, identity_email, identity_email_verified,",
        "(SELECT user_id FROM auth.oauth_connections WHERE connection_id = auth.oauth_authorization_codes.connection_id) AS user_id",
      ].join(" "),
      [codeHash],
    );
    const row = consumed.rows[0];
    if (row === undefined) {
      return null;
    }

    const idToken = hasOAuthScope(row.scope, "openid")
      ? await signOidcIdToken({
        iss: issuer,
        sub: row.user_id,
        aud: row.client_id,
        iat: Math.floor(nowMs / 1000),
        exp: Math.floor(nowMs / 1000) + ACCESS_TOKEN_TTL_SECONDS,
        ...(row.nonce !== null ? { nonce: row.nonce } : {}),
        ...getEmailClaims(row.scope, row.identity_email, row.identity_email_verified),
      })
      : null;
    const tokens = await issueTokensInExecutor(executor, mapGrantContext(row), nowMs);
    return { ...tokens, idToken };
  });
}

/**
 * Rotates a refresh token: consumes the presented refresh token and issues a
 * fresh access/refresh pair on the same connection. This is plain single-use
 * rotation: each refresh token can be redeemed once, which bounds a leaked
 * token's useful lifetime. It does NOT implement automatic reuse detection or
 * token-family / connection-wide revocation (OAuth 2.1 / RFC 9700 §4.14.2):
 * replaying an already-rotated token simply matches no active row and returns
 * null (invalid_grant) without revoking the connection or its live tokens.
 * Reuse-detection is deferred to a dedicated hardening item, so future code
 * must not assume reuse-revocation exists here.
 * Returns null when the token is malformed, unknown, expired, its connection is
 * revoked, or it was not issued to the presenting client.
 */
export async function rotateRefreshToken(
  refreshToken: string,
  clientId: string,
  nowMs: number,
): Promise<IssuedTokens | null> {
  // Parse the prefix off the presented token and hash only the bare secret so
  // the lookup hashes the same bytes that issuance stored (see parseToken).
  const parsedSecret = parseToken(REFRESH_TOKEN_PREFIX, refreshToken);
  if (parsedSecret === null) {
    return null;
  }
  const presentedHash = hashOpaqueToken(parsedSecret);

  return transaction(async (executor) => {
    const deleted = await executor.query<GrantContextRow>(
      [
        "DELETE FROM auth.oauth_refresh_tokens t",
        "USING auth.oauth_connections conn",
        "WHERE t.token_hash = $1",
        "AND t.connection_id = conn.connection_id",
        // Bind the refresh token to the requesting client (RFC 6749 §6); a
        // client_id mismatch is indistinguishable from an unknown token.
        "AND conn.client_id = $2",
        "AND conn.revoked_at IS NULL",
        "AND (t.expires_at IS NULL OR t.expires_at > now())",
        "RETURNING t.connection_id, t.resource, t.scope, t.identity_email, t.identity_email_verified",
      ].join(" "),
      [presentedHash, clientId],
    );
    const row = deleted.rows[0];
    if (row === undefined) {
      return null;
    }

    return issueTokensInExecutor(executor, mapGrantContext(row), nowMs);
  });
}

function mapGrantContext(row: GrantContextRow): GrantContext {
  return {
    connectionId: row.connection_id,
    resource: row.resource,
    scope: row.scope,
    identityEmail: row.identity_email,
    identityEmailVerified: row.identity_email_verified,
  };
}

function getEmailClaims(
  scope: string | null,
  email: string | null,
  emailVerified: boolean | null,
): Readonly<{ email?: string; email_verified?: boolean }> {
  if (!hasOAuthScope(scope, "email")) {
    return {};
  }
  if (email === null || emailVerified === null) {
    throw new Error("OAuth email grant has no verified identity snapshot; reconnect the client");
  }
  return { email, email_verified: emailVerified };
}

export type OidcUserInfo = Readonly<{ sub: string; email?: string; email_verified?: boolean }>;

export async function getOidcUserInfo(token: string, nowMs: number): Promise<OidcUserInfo | "insufficient_scope" | null> {
  const secret = parseToken(ACCESS_TOKEN_PREFIX, token);
  if (secret === null) {
    return null;
  }
  const result = await query<GrantContextRow & Readonly<{ user_id: string }>>(
    [
      "SELECT c.user_id, t.connection_id, t.resource, t.scope, t.identity_email, t.identity_email_verified",
      "FROM auth.oauth_access_tokens t",
      "JOIN auth.oauth_connections c ON c.connection_id = t.connection_id",
      "WHERE t.token_hash = $1 AND t.expires_at > $2 AND c.revoked_at IS NULL",
    ].join(" "),
    [hashOpaqueToken(secret), new Date(nowMs)],
  );
  const row = result.rows[0];
  if (row === undefined) {
    return null;
  }
  if (!hasOAuthScope(row.scope, "openid")) {
    return "insufficient_scope";
  }
  return { sub: row.user_id, ...getEmailClaims(row.scope, row.identity_email, row.identity_email_verified) };
}
