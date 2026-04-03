import { authenticateRequest, type AuthResult } from "../auth";
import { HttpError } from "../errors";
import { ensureUserProfile } from "../ensureUser";
import {
  CHAT_LIVE_AFTER_CURSOR_INVALID_CODE,
  CHAT_LIVE_RUN_ID_REQUIRED_CODE,
  CHAT_LIVE_SESSION_ID_REQUIRED_CODE,
  CHAT_LIVE_WORKSPACE_SELECTION_REQUIRED_CODE,
} from "./liveErrors";
import { verifyChatLiveAuthorizationHeader } from "./liveAuth";

export type LiveStreamParams = Readonly<{
  sessionId: string;
  runId: string;
  afterCursor: number | undefined;
  userId: string;
  workspaceId: string;
  requestId?: string;
  resumeAttemptId?: string;
  clientPlatform?: string;
  clientVersion?: string;
}>;

function readOptionalHeader(headers: Headers | Record<string, string | undefined>, name: string): string | undefined {
  if (headers instanceof Headers) {
    const value = headers.get(name);
    return value === null || value === "" ? undefined : value;
  }

  const normalizedHeaderName = name.toLowerCase();
  for (const [key, value] of Object.entries(headers)) {
    if (key.toLowerCase() === normalizedHeaderName && value !== undefined && value !== "") {
      return value;
    }
  }

  return undefined;
}

/**
 * Parses and authenticates the live SSE request.
 * The backend live endpoint is only a temporary overlay for an already-known
 * chat session, so the request must always identify the session and an
 * optional cursor boundary for safe replay.
 */
export async function handleLiveRequest(
  url: URL,
  authorizationHeader: string | undefined,
  headers: Headers | Record<string, string | undefined>,
): Promise<LiveStreamParams> {
  const sessionId = url.searchParams.get("sessionId");
  if (sessionId === null || sessionId === "") {
    throw new HttpError(400, "AI live stream request is missing sessionId.", CHAT_LIVE_SESSION_ID_REQUIRED_CODE);
  }
  const runId = url.searchParams.get("runId");
  if (runId === null || runId === "") {
    throw new HttpError(400, "AI live stream request is missing runId.", CHAT_LIVE_RUN_ID_REQUIRED_CODE);
  }

  const afterCursorParam = url.searchParams.get("afterCursor");
  const afterCursor = afterCursorParam !== null
    ? Number.parseInt(afterCursorParam, 10)
    : undefined;
  if (afterCursor !== undefined && (!Number.isSafeInteger(afterCursor) || afterCursor < 0)) {
    throw new HttpError(400, "AI live stream request has an invalid afterCursor.", CHAT_LIVE_AFTER_CURSOR_INVALID_CODE);
  }

  const tokenParam = url.searchParams.get("token");
  if (authorizationHeader !== undefined && authorizationHeader.startsWith("Live ")) {
    const verifiedLiveAuth = await verifyChatLiveAuthorizationHeader(authorizationHeader, sessionId, runId);
    return {
      sessionId,
      runId,
      afterCursor,
      userId: verifiedLiveAuth.userId,
      workspaceId: verifiedLiveAuth.workspaceId,
      resumeAttemptId: readOptionalHeader(headers, "X-Chat-Resume-Attempt-Id"),
      clientPlatform: readOptionalHeader(headers, "X-Client-Platform"),
      clientVersion: readOptionalHeader(headers, "X-Client-Version"),
    };
  }

  const effectiveAuth = authorizationHeader ?? (tokenParam !== null ? `Bearer ${tokenParam}` : undefined);

  const authResult: AuthResult = await authenticateRequest({
    authorizationHeader: effectiveAuth,
    sessionToken: undefined,
  });

  const workspaceId = authResult.transport === "api_key"
    ? authResult.selectedWorkspaceId
    : (await ensureUserProfile(authResult.userId, null)).selectedWorkspaceId;

  if (workspaceId === null) {
    throw new HttpError(409, "No workspace selected.", CHAT_LIVE_WORKSPACE_SELECTION_REQUIRED_CODE);
  }

  return {
    sessionId,
    runId,
    afterCursor,
    userId: authResult.userId,
    workspaceId,
    resumeAttemptId: readOptionalHeader(headers, "X-Chat-Resume-Attempt-Id"),
    clientPlatform: readOptionalHeader(headers, "X-Client-Platform"),
    clientVersion: readOptionalHeader(headers, "X-Client-Version"),
  };
}
