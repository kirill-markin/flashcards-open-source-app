import { authenticateRequest, type AuthResult } from "../../auth";
import { HttpError } from "../../shared/errors";
import { ensureUserProfile, type UserProfile } from "../../auth/ensureUser";
import {
  parseOptionalWorkspaceIdParam,
  resolveAccessibleChatWorkspaceId,
} from "../../server/requestContext";
import type { BackendTraceCarrier } from "../../observability/sentry";
import { assertChatLiveRunAccess } from "./access";
import {
  CHAT_LIVE_AFTER_CURSOR_INVALID_CODE,
  CHAT_LIVE_RUN_ID_REQUIRED_CODE,
  CHAT_LIVE_SESSION_ID_REQUIRED_CODE,
  CHAT_LIVE_WORKSPACE_SELECTION_REQUIRED_CODE,
} from "./errors";
import { verifyChatLiveAuthorizationHeader } from "./auth";

export type LiveStreamParams = Readonly<{
  sessionId: string;
  runId: string;
  afterCursor: number | undefined;
  userId: string;
  workspaceId: string;
  traceContext?: BackendTraceCarrier | null;
  requestId?: string;
  clientRequestId?: string;
  resumeAttemptId?: string;
  clientPlatform?: string;
  clientVersion?: string;
}>;

type HandleLiveRequestDependencies = Readonly<{
  authenticateRequestFn: typeof authenticateRequest;
  ensureUserProfileFn: typeof ensureUserProfile;
  verifyChatLiveAuthorizationHeaderFn: typeof verifyChatLiveAuthorizationHeader;
  resolveAccessibleChatWorkspaceIdFn: typeof resolveAccessibleChatWorkspaceId;
  assertChatLiveRunAccessFn: typeof assertChatLiveRunAccess;
}>;

const defaultHandleLiveRequestDependencies: HandleLiveRequestDependencies = {
  authenticateRequestFn: authenticateRequest,
  ensureUserProfileFn: ensureUserProfile,
  verifyChatLiveAuthorizationHeaderFn: verifyChatLiveAuthorizationHeader,
  resolveAccessibleChatWorkspaceIdFn: resolveAccessibleChatWorkspaceId,
  assertChatLiveRunAccessFn: assertChatLiveRunAccess,
};

const chatRequestIdPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function readOptionalHeader(headers: Headers | Record<string, string | undefined>, name: string): string | undefined {
  if (headers instanceof Headers) {
    const value = headers.get(name);
    return value === null || value === "" ? undefined : value;
  }

  const normalizedHeaderName = name.toLowerCase();
  const headerEntries = Object.entries(headers) as ReadonlyArray<readonly [string, string | undefined]>;
  for (const [key, value] of headerEntries) {
    if (key.toLowerCase() === normalizedHeaderName && value !== undefined && value !== "") {
      return value;
    }
  }

  return undefined;
}

export function readOptionalChatRequestIdHeader(
  headers: Headers | Record<string, string | undefined>,
): string | undefined {
  const value = readOptionalHeader(headers, "X-Chat-Request-Id");
  if (value === undefined) {
    return undefined;
  }

  const trimmedValue = value.trim();
  if (trimmedValue === "" || !chatRequestIdPattern.test(trimmedValue)) {
    return undefined;
  }

  return trimmedValue;
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
  const clientRequestId = readOptionalChatRequestIdHeader(headers);
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
      traceContext: verifiedLiveAuth.traceContext ?? null,
      ...(clientRequestId === undefined ? {} : { clientRequestId }),
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
  const explicitWorkspaceId = parseOptionalWorkspaceIdParam(url.searchParams.get("workspaceId") ?? undefined);

  let workspaceId: string;
  try {
    workspaceId = await liveRequestDependencies.resolveAccessibleChatWorkspaceIdFn(
      {
        userId: authResult.userId,
        selectedWorkspaceId: authResult.transport === "api_key"
          ? authResult.selectedWorkspaceId
          : userProfile?.selectedWorkspaceId ?? null,
      },
      explicitWorkspaceId,
    );
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
    traceContext: null,
    ...(clientRequestId === undefined ? {} : { clientRequestId }),
    resumeAttemptId: readOptionalHeader(headers, "X-Chat-Resume-Attempt-Id"),
    clientPlatform: readOptionalHeader(headers, "X-Client-Platform"),
    clientVersion: readOptionalHeader(headers, "X-Client-Version"),
  };
}
