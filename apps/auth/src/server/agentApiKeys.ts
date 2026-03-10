import { createHash, randomUUID } from "node:crypto";
import { transaction, query } from "../db.js";
import { verifySessionTokenSubject } from "./browserSession.js";
import { createCrockfordToken } from "./crockford.js";

const AGENT_API_KEY_PREFIX = "fca";
const AGENT_API_KEY_ID_LENGTH = 8;
const AGENT_API_KEY_SECRET_LENGTH = 26;

type AgentApiKeyRow = Readonly<{
  connection_id: string;
  user_id: string;
  label: string;
  key_id: string;
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

export type CreatedAgentApiKey = Readonly<{
  apiKey: string;
  connection: AgentApiKeyConnection;
}>;

function toIsoString(value: Date | string | null): string | null {
  if (value === null) {
    return null;
  }

  return value instanceof Date ? value.toISOString() : new Date(value).toISOString();
}

/**
 * Validates the human-readable label shown in settings for this long-lived
 * agent connection.
 */
export function normalizeAgentApiKeyLabel(label: string): string {
  const trimmedLabel = label.trim();
  if (trimmedLabel === "") {
    throw new Error("Connection label is required");
  }

  if (trimmedLabel.length > 120) {
    throw new Error("Connection label must be at most 120 characters");
  }

  return trimmedLabel;
}

function createKeyId(): string {
  return createCrockfordToken(AGENT_API_KEY_ID_LENGTH);
}

function createKeySecret(): string {
  return createCrockfordToken(AGENT_API_KEY_SECRET_LENGTH);
}

function hashKeySecret(secret: string): string {
  return createHash("sha256").update(secret).digest("hex");
}

function formatAgentApiKey(keyId: string, secret: string): string {
  return `${AGENT_API_KEY_PREFIX}_${keyId}_${secret}`;
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

/**
 * Creates a full-user long-lived API key from a freshly issued Cognito ID
 * token. The key is shown once and only its hash is persisted.
 */
export async function createAgentApiKeyFromIdToken(idToken: string, label: string): Promise<CreatedAgentApiKey> {
  const userId = await verifySessionTokenSubject(idToken);
  const normalizedLabel = normalizeAgentApiKeyLabel(label);
  const connectionId = randomUUID();
  const keyId = createKeyId();
  const keySecret = createKeySecret();
  const keyHash = hashKeySecret(keySecret);

  const result = await transaction(async (executor) => {
    await executor.query(
      "INSERT INTO org.user_settings (user_id) VALUES ($1) ON CONFLICT (user_id) DO NOTHING",
      [userId],
    );
    const inserted = await executor.query<AgentApiKeyRow>(
      [
        "INSERT INTO auth.agent_api_keys",
        "(connection_id, user_id, label, key_id, key_hash)",
        "VALUES ($1, $2, $3, $4, $5)",
        "RETURNING connection_id, user_id, label, key_id, created_at, last_used_at, revoked_at",
      ].join(" "),
      [connectionId, userId, normalizedLabel, keyId, keyHash],
    );
    const row = inserted.rows[0];
    if (row === undefined) {
      throw new Error("Failed to create agent API key");
    }

    return mapConnection(row);
  });

  return {
    apiKey: formatAgentApiKey(keyId, keySecret),
    connection: result,
  };
}

export async function listAgentApiKeyConnectionsForUser(userId: string): Promise<ReadonlyArray<AgentApiKeyConnection>> {
  const result = await query<AgentApiKeyRow>(
    [
      "SELECT connection_id, user_id, label, key_id, created_at, last_used_at, revoked_at",
      "FROM auth.agent_api_keys",
      "WHERE user_id = $1",
      "ORDER BY created_at DESC, connection_id DESC",
    ].join(" "),
    [userId],
  );

  return result.rows.map(mapConnection);
}
