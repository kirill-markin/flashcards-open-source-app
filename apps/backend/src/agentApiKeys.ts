import { createHash, timingSafeEqual } from "node:crypto";
import { query } from "./db";
import { HttpError } from "./errors";
import { normalizeCrockfordToken } from "./crockford";

const AGENT_API_KEY_PREFIX = "fca";
const AGENT_API_KEY_ID_LENGTH = 8;
const AGENT_API_KEY_SECRET_LENGTH = 26;
const LAST_USED_UPDATE_INTERVAL_MS = 5 * 60_000;

type AgentApiKeyRow = Readonly<{
  connection_id: string;
  user_id: string;
  label: string;
  key_id: string;
  key_hash: string;
  created_at: Date | string;
  last_used_at: Date | string | null;
  revoked_at: Date | string | null;
}>;

export type AgentApiKeyConnection = Readonly<{
  connectionId: string;
  label: string;
  createdAt: string;
  lastUsedAt: string | null;
  revokedAt: string | null;
}>;

export type AuthenticatedAgentApiKey = Readonly<{
  userId: string;
  connectionId: string;
}>;

function toIsoString(value: Date | string | null): string | null {
  if (value === null) {
    return null;
  }

  return value instanceof Date ? value.toISOString() : new Date(value).toISOString();
}

function mapConnection(row: AgentApiKeyRow): AgentApiKeyConnection {
  return {
    connectionId: row.connection_id,
    label: row.label,
    createdAt: toIsoString(row.created_at) ?? "",
    lastUsedAt: toIsoString(row.last_used_at),
    revokedAt: toIsoString(row.revoked_at),
  };
}

function hashSecret(secret: string): string {
  return createHash("sha256").update(secret).digest("hex");
}

function isEqualHash(expectedHash: string, actualHash: string): boolean {
  if (expectedHash.length !== actualHash.length) {
    return false;
  }

  return timingSafeEqual(Buffer.from(expectedHash), Buffer.from(actualHash));
}

/**
 * Parses the public key identifier and secret from a user-owned agent API key.
 * The shape is intentionally fixed so parsing stays predictable for callers.
 */
export function parseAgentApiKey(value: string): Readonly<{
  keyId: string;
  secret: string;
}> {
  const trimmedValue = value.replace(/[\s-]/g, "").toUpperCase();
  const prefix = `${AGENT_API_KEY_PREFIX.toUpperCase()}_`;
  if (!trimmedValue.startsWith(prefix)) {
    throw new HttpError(401, "Invalid API key", "AGENT_API_KEY_INVALID");
  }

  const remaining = trimmedValue.slice(prefix.length);
  const separatorIndex = remaining.indexOf("_");
  if (separatorIndex <= 0 || separatorIndex === remaining.length - 1) {
    throw new HttpError(401, "Invalid API key", "AGENT_API_KEY_INVALID");
  }

  let keyId: string;
  let secret: string;
  try {
    keyId = normalizeCrockfordToken(remaining.slice(0, separatorIndex), "agent API key id");
    secret = normalizeCrockfordToken(remaining.slice(separatorIndex + 1), "agent API key secret");
    if (keyId.length !== AGENT_API_KEY_ID_LENGTH || secret.length !== AGENT_API_KEY_SECRET_LENGTH) {
      throw new Error("Invalid API key length");
    }
  } catch {
    throw new HttpError(401, "Invalid API key", "AGENT_API_KEY_INVALID");
  }

  return { keyId, secret };
}

/**
 * Authenticates an ApiKey header value and touches the connection's last-used
 * timestamp on a coarse interval so revokes apply immediately without turning
 * every request into a hot write.
 */
export async function authenticateAgentApiKey(apiKey: string): Promise<AuthenticatedAgentApiKey> {
  const parsedKey = parseAgentApiKey(apiKey);
  const result = await query<AgentApiKeyRow>(
    [
      "SELECT connection_id, user_id, label, key_id, key_hash, created_at, last_used_at, revoked_at",
      "FROM auth.agent_api_keys",
      "WHERE key_id = $1",
    ].join(" "),
    [parsedKey.keyId],
  );
  const row = result.rows[0];
  if (row === undefined || row.revoked_at !== null) {
    throw new HttpError(401, "Invalid API key", "AGENT_API_KEY_INVALID");
  }

  if (isEqualHash(row.key_hash, hashSecret(parsedKey.secret)) === false) {
    throw new HttpError(401, "Invalid API key", "AGENT_API_KEY_INVALID");
  }

  const now = Date.now();
  const lastUsedAtMs = row.last_used_at === null ? null : new Date(row.last_used_at).getTime();
  if (lastUsedAtMs === null || now - lastUsedAtMs >= LAST_USED_UPDATE_INTERVAL_MS) {
    await query(
      [
        "UPDATE auth.agent_api_keys",
        "SET last_used_at = now()",
        "WHERE connection_id = $1",
        "AND (last_used_at IS NULL OR last_used_at < $2)",
      ].join(" "),
      [row.connection_id, new Date(now - LAST_USED_UPDATE_INTERVAL_MS)],
    );
  }

  return {
    userId: row.user_id,
    connectionId: row.connection_id,
  };
}

export async function listAgentApiKeyConnectionsForUser(userId: string): Promise<ReadonlyArray<AgentApiKeyConnection>> {
  const result = await query<AgentApiKeyRow>(
    [
      "SELECT connection_id, user_id, label, key_id, key_hash, created_at, last_used_at, revoked_at",
      "FROM auth.agent_api_keys",
      "WHERE user_id = $1",
      "ORDER BY created_at DESC, connection_id DESC",
    ].join(" "),
    [userId],
  );

  return result.rows.map(mapConnection);
}

/**
 * Revokes one human-managed long-lived agent connection immediately so the
 * backing API key stops authenticating on the next request.
 */
export async function revokeAgentApiKeyConnectionForUser(userId: string, connectionId: string): Promise<AgentApiKeyConnection> {
  const result = await query<AgentApiKeyRow>(
    [
      "UPDATE auth.agent_api_keys",
      "SET revoked_at = COALESCE(revoked_at, now())",
      "WHERE user_id = $1 AND connection_id = $2",
      "RETURNING connection_id, user_id, label, key_id, key_hash, created_at, last_used_at, revoked_at",
    ].join(" "),
    [userId, connectionId],
  );
  const row = result.rows[0];
  if (row === undefined) {
    throw new HttpError(404, "Agent connection not found", "AGENT_API_KEY_NOT_FOUND");
  }

  return mapConnection(row);
}
