export type AgentAction = Readonly<{
  name: "send_code" | "verify_code" | "load_account" | "list_workspaces" | "create_workspace" | "select_workspace";
  method: "GET" | "POST";
  url?: string;
  urlTemplate?: string;
  input?: Readonly<{
    required?: ReadonlyArray<string>;
  }>;
  auth?: Readonly<{
    scheme: "ApiKey";
  }>;
}>;

export type AgentEnvelope<Data> = Readonly<{
  ok: boolean;
  data: Data;
  actions: ReadonlyArray<AgentAction>;
  instructions: string;
  error?: Readonly<{
    code: string;
    message: string;
  }>;
}>;

/**
 * Builds the stable agent-facing response envelope used by the terminal auth
 * flow. The shape stays intentionally small so bots can parse it without
 * learning a generic hypermedia standard.
 */
export function createAgentEnvelope<Data>(
  data: Data,
  actions: ReadonlyArray<AgentAction>,
  instructions: string,
): AgentEnvelope<Data> {
  return {
    ok: true,
    data,
    actions,
    instructions,
  };
}

/**
 * Builds a deterministic agent-facing error payload with retry guidance kept
 * in the same envelope shape as successful responses.
 */
export function createAgentErrorEnvelope(
  code: string,
  message: string,
  instructions: string,
): AgentEnvelope<Record<string, never>> {
  return {
    ok: false,
    data: {},
    actions: [],
    instructions,
    error: {
      code,
      message,
    },
  };
}
