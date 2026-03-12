import { getPublicAgentDocs } from "./publicUrls";

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
    details?: Readonly<{
      validationIssues: ReadonlyArray<Readonly<{
        path: string;
        code: string;
        message: string;
      }>>;
    }>;
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
  details?: Readonly<{
    validationIssues: ReadonlyArray<Readonly<{
      path: string;
      code: string;
      message: string;
    }>>;
  }>,
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
