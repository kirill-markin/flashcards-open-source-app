export type AgentApiKeyConnection = Readonly<{
  connectionId: string;
  label: string;
  createdAt: string;
  lastUsedAt: string | null;
  revokedAt: string | null;
}>;

export type AgentApiKeyConnectionsResponse = Readonly<{
  connections: ReadonlyArray<AgentApiKeyConnection>;
  instructions: string;
}>;

export type AgentApiKeyRevokeResponse = Readonly<{
  ok: true;
  connection: AgentApiKeyConnection;
  instructions: string;
}>;
