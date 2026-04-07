import { authenticateRequest, type AuthTransport } from "../auth";
import { isDeletedSubject } from "../deletedSubjects";
import { HttpError } from "../errors";
import { ensureUserProfile } from "../ensureUser";
import { assertUserHasWorkspaceAccess } from "../workspaces";
import {
  enforceSessionCsrfProtection,
  extractRequestAuthInputs,
  toAuthRequest,
  type RequestAuthInputs,
} from "../requestSecurity";

export type RequestContext = Readonly<{
  userId: string;
  subjectUserId: string;
  selectedWorkspaceId: string | null;
  email: string | null;
  locale: string;
  userSettingsCreatedAt: string;
  transport: AuthTransport;
  connectionId: string | null;
}>;

export type WorkspaceRequestContext = Readonly<{
  userId: string;
  selectedWorkspaceId: string | null;
}>;

export type WorkspaceAccessRequestContext = Readonly<{
  userId: string;
}>;

type LoadRequestContextDependencies = Readonly<{
  authenticateRequestFn: typeof authenticateRequest;
  isDeletedSubjectFn: typeof isDeletedSubject;
  ensureUserProfileFn: typeof ensureUserProfile;
}>;

export function getAllowedOrigins(): Array<string> {
  const raw = process.env.BACKEND_ALLOWED_ORIGINS ?? "http://localhost:3000";
  return raw
    .split(",")
    .map((value) => value.trim())
    .filter((value) => value !== "");
}

export async function loadRequestContextWithDependencies(
  requestAuthInputs: RequestAuthInputs,
  dependencies: LoadRequestContextDependencies,
): Promise<RequestContext> {
  const auth = await dependencies.authenticateRequestFn(toAuthRequest(requestAuthInputs));
  const subjectUserId = auth.subjectUserId;
  if (auth.transport !== "none" && await dependencies.isDeletedSubjectFn(subjectUserId)) {
    throw new HttpError(410, "This account has already been deleted.", "ACCOUNT_DELETED");
  }
  const userProfile = await dependencies.ensureUserProfileFn(auth.userId, auth.email);
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
    transport: auth.transport,
    connectionId: auth.connectionId,
  };
}

export async function loadRequestContext(
  requestAuthInputs: RequestAuthInputs,
): Promise<RequestContext> {
  return loadRequestContextWithDependencies(requestAuthInputs, {
    authenticateRequestFn: authenticateRequest,
    isDeletedSubjectFn: isDeletedSubject,
    ensureUserProfileFn: ensureUserProfile,
  });
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

export function parseWorkspaceIdParam(value: string | undefined): string {
  if (value === undefined) {
    throw new HttpError(400, "workspaceId is required", "WORKSPACE_ID_REQUIRED");
  }

  const trimmedValue = value.trim();
  if (trimmedValue === "") {
    throw new HttpError(400, "workspaceId must not be empty", "WORKSPACE_ID_INVALID");
  }

  const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
  if (!uuidPattern.test(trimmedValue)) {
    throw new HttpError(400, "workspaceId must be a UUID", "WORKSPACE_ID_INVALID");
  }

  return trimmedValue;
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

/**
 * Resolves the currently selected workspace and revalidates access before a
 * workspace-bound route continues with business logic.
 */
export async function requireAccessibleSelectedWorkspaceId(
  requestContext: WorkspaceRequestContext,
): Promise<string> {
  if (requestContext.selectedWorkspaceId === null) {
    throw new HttpError(
      409,
      "Select a workspace before using this endpoint",
      "WORKSPACE_SELECTION_REQUIRED",
    );
  }

  return requireAccessibleWorkspaceId(requestContext, requestContext.selectedWorkspaceId);
}

/**
 * AI dictation keeps its existing 403 contract when no workspace is selected,
 * but still revalidates the selected workspace before any downstream work.
 */
export async function requireAccessibleSelectedWorkspaceIdForAiDictation(
  requestContext: WorkspaceRequestContext,
): Promise<string> {
  if (requestContext.selectedWorkspaceId === null) {
    throw new HttpError(403, "A workspace must be selected before using AI dictation.", "AI_WORKSPACE_REQUIRED");
  }

  return requireAccessibleWorkspaceId(requestContext, requestContext.selectedWorkspaceId);
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
