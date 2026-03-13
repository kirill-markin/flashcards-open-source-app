import { createHash, randomUUID } from "node:crypto";
import {
  applyWorkspaceDatabaseScopeInExecutor,
  query,
  transactionWithUserScope,
  type DatabaseExecutor,
} from "../db.js";
import { verifySessionTokenIdentity } from "./browserSession.js";
import { createCrockfordToken } from "./crockford.js";

const AGENT_API_KEY_PREFIX = "fca";
const AGENT_API_KEY_ID_LENGTH = 8;
const AGENT_API_KEY_SECRET_LENGTH = 26;
const AUTO_CREATED_WORKSPACE_NAME = "Personal";

type AgentApiKeyRow = Readonly<{
  connection_id: string;
  user_id: string;
  label: string;
  key_id: string;
  selected_workspace_id: string | null;
  created_at: Date | string;
  last_used_at: Date | string | null;
  revoked_at: Date | string | null;
}>;

type WorkspaceMembershipRow = Readonly<{
  workspace_id: string;
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

const upsertUserSettingsSql = [
  "INSERT INTO org.user_settings (user_id, email)",
  "VALUES ($1, $2)",
  "ON CONFLICT (user_id) DO UPDATE",
  "SET email = EXCLUDED.email",
  "WHERE org.user_settings.email IS NULL",
  "AND EXCLUDED.email IS NOT NULL",
].join(" ");

async function createWorkspaceInExecutor(
  executor: DatabaseExecutor,
  userId: string,
): Promise<string> {
  const workspaceId = randomUUID();
  const bootstrapDeviceId = randomUUID();
  const bootstrapTimestamp = new Date().toISOString();
  const bootstrapOperationId = `bootstrap-workspace-${workspaceId}`;

  await applyWorkspaceDatabaseScopeInExecutor(executor, { userId, workspaceId });

  await executor.query(
    [
      "INSERT INTO org.workspaces",
      "(",
      "workspace_id, name, fsrs_client_updated_at, fsrs_last_modified_by_device_id, fsrs_last_operation_id",
      ")",
      "VALUES ($1, $2, $3, $4, $5)",
    ].join(" "),
    [workspaceId, AUTO_CREATED_WORKSPACE_NAME, bootstrapTimestamp, bootstrapDeviceId, bootstrapOperationId],
  );

  await executor.query(
    [
      "INSERT INTO org.workspace_memberships",
      "(workspace_id, user_id, role)",
      "VALUES ($1, $2, 'owner')",
    ].join(" "),
    [workspaceId, userId],
  );

  await executor.query(
    [
      "INSERT INTO sync.devices",
      "(device_id, workspace_id, user_id, platform, app_version, last_seen_at)",
      "VALUES ($1, $2, $3, 'ios', $4, now())",
    ].join(" "),
    [bootstrapDeviceId, workspaceId, userId, "server-bootstrap"],
  );

  return workspaceId;
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
  const identity = await verifySessionTokenIdentity(idToken);
  const normalizedLabel = normalizeAgentApiKeyLabel(label);
  const connectionId = randomUUID();
  const keyId = createKeyId();
  const keySecret = createKeySecret();
  const keyHash = hashKeySecret(keySecret);

  const result = await transactionWithUserScope({ userId: identity.userId }, async (executor) => {
    await executor.query(
      upsertUserSettingsSql,
      [identity.userId, identity.email],
    );
    const membershipResult = await executor.query<WorkspaceMembershipRow>(
      [
        "SELECT workspace_id",
        "FROM org.workspace_memberships",
        "WHERE user_id = $1",
        "ORDER BY created_at ASC, workspace_id ASC",
      ].join(" "),
      [identity.userId],
    );
    let selectedWorkspaceId: string | null;
    if (membershipResult.rows.length === 0) {
      selectedWorkspaceId = await createWorkspaceInExecutor(executor, identity.userId);
    } else if (membershipResult.rows.length === 1) {
      const onlyWorkspace = membershipResult.rows[0];
      if (onlyWorkspace === undefined) {
        throw new Error("Expected one workspace membership row");
      }
      selectedWorkspaceId = onlyWorkspace.workspace_id;
    } else {
      selectedWorkspaceId = null;
    }

    const inserted = await executor.query<AgentApiKeyRow>(
      [
        "INSERT INTO auth.agent_api_keys",
        "(connection_id, user_id, label, key_id, key_hash, selected_workspace_id)",
        "VALUES ($1, $2, $3, $4, $5, $6)",
        "RETURNING connection_id, user_id, label, key_id, selected_workspace_id, created_at, last_used_at, revoked_at",
      ].join(" "),
      [connectionId, identity.userId, normalizedLabel, keyId, keyHash, selectedWorkspaceId],
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
      "SELECT connection_id, user_id, label, key_id, selected_workspace_id, created_at, last_used_at, revoked_at",
      "FROM auth.agent_api_keys",
      "WHERE user_id = $1",
      "ORDER BY created_at DESC, connection_id DESC",
    ].join(" "),
    [userId],
  );

  return result.rows.map(mapConnection);
}
