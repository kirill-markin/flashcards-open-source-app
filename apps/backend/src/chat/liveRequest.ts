import { authenticateRequest, type AuthResult } from "../auth";
import { ensureUserProfile } from "../ensureUser";
import { verifyChatLiveAuthorizationHeader } from "./liveAuth";

export type LiveStreamParams = Readonly<{
  sessionId: string;
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
    throw new Error("Missing sessionId parameter");
  }

  const afterCursorParam = url.searchParams.get("afterCursor");
  const afterCursor = afterCursorParam !== null
    ? Number.parseInt(afterCursorParam, 10)
    : undefined;
  if (afterCursor !== undefined && (!Number.isSafeInteger(afterCursor) || afterCursor < 0)) {
    throw new Error("Invalid afterCursor parameter");
  }

  const tokenParam = url.searchParams.get("token");
  if (authorizationHeader !== undefined && authorizationHeader.startsWith("Live ")) {
    const verifiedLiveAuth = await verifyChatLiveAuthorizationHeader(authorizationHeader, sessionId);
    return {
      sessionId,
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
    throw new Error("No workspace selected");
  }

  return {
    sessionId,
    afterCursor,
    userId: authResult.userId,
    workspaceId,
    resumeAttemptId: readOptionalHeader(headers, "X-Chat-Resume-Attempt-Id"),
    clientPlatform: readOptionalHeader(headers, "X-Client-Platform"),
    clientVersion: readOptionalHeader(headers, "X-Client-Version"),
  };
}
