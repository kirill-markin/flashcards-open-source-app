import {
  authenticateRequest,
  authenticateRequestWithAbortSignal,
  type AuthResult,
  type AuthTransport,
} from "../auth";
import type { GuestSessionPlatform } from "../guestAuth/types";
import { isDeletedSubject } from "../auth/deletedSubjects";
import { HttpError } from "../shared/errors";
import {
  ensureCognitoUserProfile,
  ensureUserProfile,
  type AccountPreferences,
} from "../auth/ensureUser";
import { assertUserHasWorkspaceAccess } from "../workspaces/selection";
import {
  isWorkspaceId,
  normalizeWorkspaceId,
} from "../workspaces/identity";
import {
  enforceSessionCsrfProtection,
  enforceSessionCsrfProtectionWithAbortSignal,
  extractRequestAuthInputs,
  toAuthRequest,
  type RequestAuthInputs,
} from "../auth/requestSecurity";
import { getAllowedBrowserOrigins } from "./browserCors";

export type RequestContext = Readonly<{
  userId: string;
  subjectUserId: string;
  selectedWorkspaceId: string | null;
  email: string | null;
  locale: string;
  userSettingsCreatedAt: string;
  preferences: AccountPreferences;
  transport: AuthTransport;
  connectionId: string | null;
  guestSessionId: string | null;
  guestPlatform: GuestSessionPlatform | null;
}>;

export type WorkspaceRequestContext = Readonly<{
  userId: string;
  selectedWorkspaceId: string | null;
}>;

export type WorkspaceAccessRequestContext = Readonly<{
  userId: string;
}>;

type WorkspaceSelectionErrorConfig = Readonly<{
  statusCode: 403 | 409;
  message: string;
  code: "AI_WORKSPACE_REQUIRED" | "WORKSPACE_SELECTION_REQUIRED";
}>;

type LoadRequestContextDependencies = Readonly<{
  authenticateRequestFn: typeof authenticateRequest;
  isDeletedSubjectFn: typeof isDeletedSubject;
  ensureCognitoUserProfileFn: typeof ensureCognitoUserProfile;
  ensureUserProfileFn: typeof ensureUserProfile;
}>;

type LoadRequestContextWithAbortSignalDependencies = Readonly<{
  authenticateRequestWithAbortSignalFn:
    typeof authenticateRequestWithAbortSignal;
  isDeletedSubjectFn: typeof isDeletedSubject;
  ensureCognitoUserProfileFn: typeof ensureCognitoUserProfile;
  ensureUserProfileFn: typeof ensureUserProfile;
}>;

const chatWorkspaceSelectionRequiredError: WorkspaceSelectionErrorConfig = {
  statusCode: 409,
  message: "Select a workspace before using this endpoint",
  code: "WORKSPACE_SELECTION_REQUIRED",
};

const aiDictationWorkspaceRequiredError: WorkspaceSelectionErrorConfig = {
  statusCode: 403,
  message: "A workspace must be selected before using AI dictation.",
  code: "AI_WORKSPACE_REQUIRED",
};

const mcpWorkspaceSelectionRequiredError: WorkspaceSelectionErrorConfig = {
  statusCode: 409,
  message: "Select a workspace before using the sql tool, or pass the workspaceId argument.",
  code: "WORKSPACE_SELECTION_REQUIRED",
};

export function getAllowedOrigins(): Array<string> {
  return getAllowedBrowserOrigins();
}

export async function loadRequestContextWithDependencies(
  requestAuthInputs: RequestAuthInputs,
  dependencies: LoadRequestContextDependencies,
): Promise<RequestContext> {
  const auth = await dependencies.authenticateRequestFn(toAuthRequest(requestAuthInputs));
  return loadAuthenticatedRequestContext(
    auth,
    dependencies,
    () => {},
  );
}

async function loadAuthenticatedRequestContext(
  auth: AuthResult,
  dependencies: Readonly<{
    isDeletedSubjectFn: typeof isDeletedSubject;
    ensureCognitoUserProfileFn: typeof ensureCognitoUserProfile;
    ensureUserProfileFn: typeof ensureUserProfile;
  }>,
  assertRequestActive: () => void,
): Promise<RequestContext> {
  assertRequestActive();
  const subjectUserId = auth.subjectUserId;
  if (auth.transport !== "none") {
    const deleted = await dependencies.isDeletedSubjectFn(subjectUserId);
    assertRequestActive();
    if (deleted) {
      throw new HttpError(410, "This account has already been deleted.", "ACCOUNT_DELETED");
    }
  }
  const userProfile = auth.transport === "bearer" || auth.transport === "session"
    ? await dependencies.ensureCognitoUserProfileFn(auth.subjectUserId, auth.email)
    : await dependencies.ensureUserProfileFn(auth.userId, auth.email);
  assertRequestActive();
  const selectedWorkspaceId = auth.transport === "api_key"
    ? auth.selectedWorkspaceId
    : userProfile.selectedWorkspaceId;

  return {
    userId: userProfile.userId,
    subjectUserId,
    selectedWorkspaceId,
    email: userProfile.email,
    locale: userProfile.locale,
    userSettingsCreatedAt: userProfile.createdAt,
    preferences: userProfile.preferences,
    transport: auth.transport,
    connectionId: auth.connectionId,
    guestSessionId: auth.guestSessionId,
    guestPlatform: auth.guestPlatform,
  };
}

export async function loadRequestContextWithAbortSignalAndDependencies(
  requestAuthInputs: RequestAuthInputs,
  abortSignal: AbortSignal,
  dependencies: LoadRequestContextWithAbortSignalDependencies,
): Promise<RequestContext> {
  abortSignal.throwIfAborted();
  const auth = await dependencies.authenticateRequestWithAbortSignalFn(
    toAuthRequest(requestAuthInputs),
    abortSignal,
  );
  abortSignal.throwIfAborted();
  return loadAuthenticatedRequestContext(
    auth,
    dependencies,
    () => abortSignal.throwIfAborted(),
  );
}

export async function loadRequestContext(
  requestAuthInputs: RequestAuthInputs,
): Promise<RequestContext> {
  return loadRequestContextWithDependencies(requestAuthInputs, {
    authenticateRequestFn: authenticateRequest,
    isDeletedSubjectFn: isDeletedSubject,
    ensureCognitoUserProfileFn: ensureCognitoUserProfile,
    ensureUserProfileFn: ensureUserProfile,
  });
}

export async function loadRequestContextWithAbortSignal(
  requestAuthInputs: RequestAuthInputs,
  abortSignal: AbortSignal,
): Promise<RequestContext> {
  return loadRequestContextWithAbortSignalAndDependencies(
    requestAuthInputs,
    abortSignal,
    {
      authenticateRequestWithAbortSignalFn:
        authenticateRequestWithAbortSignal,
      isDeletedSubjectFn: isDeletedSubject,
      ensureCognitoUserProfileFn: ensureCognitoUserProfile,
      ensureUserProfileFn: ensureUserProfile,
    },
  );
}

export async function loadRequestContextFromRequest(
  request: Request,
  allowedOrigins: ReadonlyArray<string>,
): Promise<Readonly<{
  requestAuthInputs: RequestAuthInputs;
  requestContext: RequestContext;
}>> {
  const requestAuthInputs = extractRequestAuthInputs(request);
  const requestContext = await loadRequestContext(requestAuthInputs);

  if (requestContext.transport === "session") {
    await enforceSessionCsrfProtection(request.method, requestAuthInputs, allowedOrigins);
  }

  return {
    requestAuthInputs,
    requestContext,
  };
}

export async function loadRequestContextFromRequestWithAbortSignal(
  request: Request,
  allowedOrigins: ReadonlyArray<string>,
  abortSignal: AbortSignal,
): Promise<Readonly<{
  requestAuthInputs: RequestAuthInputs;
  requestContext: RequestContext;
}>> {
  abortSignal.throwIfAborted();
  const requestAuthInputs = extractRequestAuthInputs(request);
  const requestContext = await loadRequestContextWithAbortSignal(
    requestAuthInputs,
    abortSignal,
  );
  abortSignal.throwIfAborted();

  if (requestContext.transport === "session") {
    await enforceSessionCsrfProtectionWithAbortSignal(
      request.method,
      requestAuthInputs,
      allowedOrigins,
      abortSignal,
    );
  }

  abortSignal.throwIfAborted();
  return {
    requestAuthInputs,
    requestContext,
  };
}

export function parseWorkspaceIdParam(value: string | undefined): string {
  if (value === undefined) {
    throw new HttpError(400, "workspaceId is required", "WORKSPACE_ID_REQUIRED");
  }

  const normalizedValue = normalizeWorkspaceId(value);
  if (normalizedValue === "") {
    throw new HttpError(400, "workspaceId must not be empty", "WORKSPACE_ID_INVALID");
  }

  if (!isWorkspaceId(normalizedValue)) {
    throw new HttpError(400, "workspaceId must be a UUID", "WORKSPACE_ID_INVALID");
  }

  return normalizedValue.toLowerCase();
}

export function parseOptionalWorkspaceIdParam(value: string | undefined): string | undefined {
  if (value === undefined) {
    return undefined;
  }

  return parseWorkspaceIdParam(value);
}

export function requireSelectedWorkspaceId(requestContext: RequestContext): string {
  if (requestContext.selectedWorkspaceId === null) {
    throw new HttpError(
      409,
      "Select a workspace before using this endpoint",
      "WORKSPACE_SELECTION_REQUIRED",
    );
  }

  return requestContext.selectedWorkspaceId;
}

export async function requireAccessibleWorkspaceId(
  requestContext: WorkspaceAccessRequestContext,
  workspaceId: string,
): Promise<string> {
  await assertUserHasWorkspaceAccess(requestContext.userId, workspaceId);
  return workspaceId;
}

function throwWorkspaceSelectionError(errorConfig: WorkspaceSelectionErrorConfig): never {
  throw new HttpError(errorConfig.statusCode, errorConfig.message, errorConfig.code);
}

export async function resolveAccessibleWorkspaceIdWithLegacySelectedWorkspaceFallback(
  requestContext: WorkspaceRequestContext,
  explicitWorkspaceId: string | undefined,
  missingWorkspaceError: WorkspaceSelectionErrorConfig,
): Promise<string> {
  if (explicitWorkspaceId !== undefined) {
    return requireAccessibleWorkspaceId(requestContext, explicitWorkspaceId);
  }

  // Legacy fallback for released AI clients that still rely on server-side
  // selected-workspace routing instead of sending an explicit workspaceId.
  // TODO: Remove this fallback once every supported AI client sends workspaceId.
  if (requestContext.selectedWorkspaceId === null) {
    throwWorkspaceSelectionError(missingWorkspaceError);
  }

  return requireAccessibleWorkspaceId(requestContext, requestContext.selectedWorkspaceId);
}

export async function resolveAccessibleChatWorkspaceId(
  requestContext: WorkspaceRequestContext,
  explicitWorkspaceId: string | undefined,
): Promise<string> {
  return resolveAccessibleWorkspaceIdWithLegacySelectedWorkspaceFallback(
    requestContext,
    explicitWorkspaceId,
    chatWorkspaceSelectionRequiredError,
  );
}

export async function resolveAccessibleAiDictationWorkspaceId(
  requestContext: WorkspaceRequestContext,
  explicitWorkspaceId: string | undefined,
): Promise<string> {
  return resolveAccessibleWorkspaceIdWithLegacySelectedWorkspaceFallback(
    requestContext,
    explicitWorkspaceId,
    aiDictationWorkspaceRequiredError,
  );
}

export async function resolveAccessibleMcpWorkspaceId(
  requestContext: WorkspaceRequestContext,
  explicitWorkspaceId: string | undefined,
): Promise<string> {
  return resolveAccessibleWorkspaceIdWithLegacySelectedWorkspaceFallback(
    requestContext,
    explicitWorkspaceId,
    mcpWorkspaceSelectionRequiredError,
  );
}

/**
 * Resolves the currently selected workspace and revalidates access before a
 * workspace-bound route continues with business logic.
 */
export async function requireAccessibleSelectedWorkspaceId(
  requestContext: WorkspaceRequestContext,
): Promise<string> {
  return resolveAccessibleChatWorkspaceId(requestContext, undefined);
}

/**
 * AI dictation keeps its existing 403 contract when no workspace is selected,
 * but still revalidates the selected workspace before any downstream work.
 */
export async function requireAccessibleSelectedWorkspaceIdForAiDictation(
  requestContext: WorkspaceRequestContext,
): Promise<string> {
  return resolveAccessibleAiDictationWorkspaceId(requestContext, undefined);
}

export function requireAgentConnectionId(requestContext: RequestContext): string {
  if (requestContext.transport !== "api_key" || requestContext.connectionId === null) {
    throw new HttpError(
      403,
      "This endpoint requires ApiKey authentication",
      "AGENT_API_KEY_REQUIRED",
    );
  }

  return requestContext.connectionId;
}
