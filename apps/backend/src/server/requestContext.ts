import { authenticateRequest, type AuthTransport } from "../auth";
import { HttpError } from "../errors";
import { ensureUserProfile } from "../ensureUser";
import {
  enforceSessionCsrfProtection,
  extractRequestAuthInputs,
  toAuthRequest,
  type RequestAuthInputs,
} from "../requestSecurity";

export type RequestContext = Readonly<{
  userId: string;
  selectedWorkspaceId: string | null;
  email: string | null;
  locale: string;
  userSettingsCreatedAt: string;
  transport: AuthTransport;
}>;

export function getAllowedOrigins(): Array<string> {
  const raw = process.env.BACKEND_ALLOWED_ORIGINS ?? "http://localhost:3000";
  return raw
    .split(",")
    .map((value) => value.trim())
    .filter((value) => value !== "");
}

export async function loadRequestContext(
  requestAuthInputs: RequestAuthInputs,
): Promise<RequestContext> {
  const auth = await authenticateRequest(toAuthRequest(requestAuthInputs));
  const userProfile = await ensureUserProfile(auth.userId);

  return {
    userId: userProfile.userId,
    selectedWorkspaceId: userProfile.selectedWorkspaceId,
    email: userProfile.email,
    locale: userProfile.locale,
    userSettingsCreatedAt: userProfile.createdAt,
    transport: auth.transport,
  };
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
