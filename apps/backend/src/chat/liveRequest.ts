import { authenticateRequest, type AuthResult } from "../auth";
import { HttpError } from "../errors";
import { ensureUserProfile, type UserProfile } from "../ensureUser";
import { requireAccessibleSelectedWorkspaceId } from "../server/requestContext";
import { assertChatLiveRunAccess } from "./liveAccess";
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

type HandleLiveRequestDependencies = Readonly<{
  authenticateRequestFn: typeof authenticateRequest;
  ensureUserProfileFn: typeof ensureUserProfile;
  verifyChatLiveAuthorizationHeaderFn: typeof verifyChatLiveAuthorizationHeader;
  requireAccessibleSelectedWorkspaceIdFn: typeof requireAccessibleSelectedWorkspaceId;
  assertChatLiveRunAccessFn: typeof assertChatLiveRunAccess;
}>;

const defaultHandleLiveRequestDependencies: HandleLiveRequestDependencies = {
  authenticateRequestFn: authenticateRequest,
  ensureUserProfileFn: ensureUserProfile,
  verifyChatLiveAuthorizationHeaderFn: verifyChatLiveAuthorizationHeader,
  requireAccessibleSelectedWorkspaceIdFn: requireAccessibleSelectedWorkspaceId,
  assertChatLiveRunAccessFn: assertChatLiveRunAccess,
};

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
  dependencies?: HandleLiveRequestDependencies,
): Promise<LiveStreamParams> {
  const liveRequestDependencies = dependencies ?? defaultHandleLiveRequestDependencies;
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
    const verifiedLiveAuth = await liveRequestDependencies.verifyChatLiveAuthorizationHeaderFn(
      authorizationHeader,
      sessionId,
      runId,
    );
    await liveRequestDependencies.assertChatLiveRunAccessFn(
      verifiedLiveAuth.userId,
      verifiedLiveAuth.workspaceId,
      sessionId,
      runId,
    );
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

  const authResult: AuthResult = await liveRequestDependencies.authenticateRequestFn({
    authorizationHeader: effectiveAuth,
    sessionToken: undefined,
  });

  const userProfile: UserProfile | null = authResult.transport === "api_key"
    ? null
    : await liveRequestDependencies.ensureUserProfileFn(authResult.userId, null);

  let workspaceId: string;
  try {
    workspaceId = await liveRequestDependencies.requireAccessibleSelectedWorkspaceIdFn({
      userId: authResult.userId,
      selectedWorkspaceId: authResult.transport === "api_key"
        ? authResult.selectedWorkspaceId
        : userProfile?.selectedWorkspaceId ?? null,
    });
  } catch (error) {
    if (
      error instanceof HttpError
      && error.statusCode === 409
      && error.code === "WORKSPACE_SELECTION_REQUIRED"
    ) {
      throw new HttpError(409, "No workspace selected.", CHAT_LIVE_WORKSPACE_SELECTION_REQUIRED_CODE);
    }

    throw error;
  }

  await liveRequestDependencies.assertChatLiveRunAccessFn(authResult.userId, workspaceId, sessionId, runId);

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
