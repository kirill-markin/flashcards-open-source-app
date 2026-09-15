import { createAgentRemediationInstructions } from "../aiTools/toolContract/remediationInstructions";
import type { PublicHttpErrorDetails } from "../shared/errors";
import { getPublicAgentDocs, type PublicAgentDocs } from "../shared/publicUrls";

export type AgentDocs = PublicAgentDocs;

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
    createAgentRemediationInstructions(code, statusCode, { surface: "rest", requestUrl }),
    requestId,
    details,
  );
}
