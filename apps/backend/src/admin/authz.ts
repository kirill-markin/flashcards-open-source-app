import { authenticateRequest, type AuthRequest, type AuthResult } from "../auth";
import { ensureCognitoUserProfile, type UserProfile } from "../auth/ensureUser";
import { HttpError } from "../shared/errors";
import {
  enforceSessionCsrfProtection,
  extractRequestAuthInputs,
  toAuthRequest,
  type RequestAuthInputs,
} from "../auth/requestSecurity";
import { queryWithUserScopeReadOnly } from "../database";
import { unsafeQuery } from "../database/unsafe";

type AdminAccessQueryRow = Readonly<{
  exists: number;
}>;

type AdminProfileEmailQueryRow = Readonly<{
  email: string | null;
}>;

type RequireAdminRequestDependencies = Readonly<{
  authenticateRequestFn: (request: AuthRequest) => Promise<AuthResult>;
  ensureCognitoUserProfileFn: (subjectUserId: string, email: string | null) => Promise<UserProfile>;
  hasActiveAdminGrantFn: (email: string) => Promise<boolean>;
}>;

type RequireCatalogAdminRequestDependencies = RequireAdminRequestDependencies & Readonly<{
  loadAdminProfileEmailFn: (userId: string) => Promise<AdminProfileEmailQueryRow | null>;
}>;

type AdminRequestContextFields = Readonly<{
  email: string;
  userId: string;
  subjectUserId: string;
  requestAuthInputs: RequestAuthInputs;
}>;

export type AdminRequestContext = AdminRequestContextFields & Readonly<{
  transport: "session" | "none";
}>;

export type CatalogAdminRequestContext = AdminRequestContextFields & Readonly<{
  transport: "session" | "api_key" | "none";
}>;

type AuthenticatedAdminRequest = Readonly<{
  auth: AuthResult;
  requestAuthInputs: RequestAuthInputs;
}>;

const localAdminEmail = "local-admin@localhost";

function normalizeAdminEmail(email: string): string {
  const normalizedEmail = email.trim().toLowerCase();
  if (normalizedEmail === "") {
    throw new HttpError(403, "Admin access requires an authenticated email.", "ADMIN_ACCESS_REQUIRED");
  }

  return normalizedEmail;
}

export async function hasActiveAdminGrant(email: string): Promise<boolean> {
  const result = await unsafeQuery<AdminAccessQueryRow>(
    [
      "SELECT 1 AS exists",
      "FROM auth.admin_users",
      "WHERE email = $1",
      "  AND revoked_at IS NULL",
      "LIMIT 1",
    ].join(" "),
    [normalizeAdminEmail(email)],
  );

  return result.rowCount !== 0;
}

export async function loadAdminProfileEmail(
  userId: string,
): Promise<AdminProfileEmailQueryRow | null> {
  const result = await queryWithUserScopeReadOnly<AdminProfileEmailQueryRow>(
    { userId },
    "SELECT email FROM org.user_settings WHERE user_id = $1 LIMIT 1",
    [userId],
  );
  const profile = result.rows[0];
  if (profile === undefined) {
    return null;
  }
  if (profile.email !== null && typeof profile.email !== "string") {
    throw new Error(`Admin profile email has an invalid database value. userId=${userId}`);
  }

  return { email: profile.email };
}

function isLoopbackHostname(hostname: string): boolean {
  return hostname === "localhost" || hostname === "127.0.0.1" || hostname === "[::1]";
}

function isAllowedInsecureLocalAdminRequest(request: Request, auth: AuthResult): boolean {
  if (auth.transport !== "none") {
    return false;
  }

  const requestHostname = new URL(request.url).hostname.toLowerCase();
  return isLoopbackHostname(requestHostname);
}

async function authenticateAdminRequest(
  request: Request,
  authenticateRequestFn: (request: AuthRequest) => Promise<AuthResult>,
): Promise<AuthenticatedAdminRequest> {
  const requestAuthInputs = extractRequestAuthInputs(request);
  const auth = await authenticateRequestFn(toAuthRequest(requestAuthInputs));

  return { auth, requestAuthInputs };
}

function requireLocalAdminRequest(
  request: Request,
  auth: AuthResult,
  requestAuthInputs: RequestAuthInputs,
): AdminRequestContext {
  if (!isAllowedInsecureLocalAdminRequest(request, auth)) {
    throw new HttpError(
      403,
      "Insecure local admin access is limited to localhost development requests.",
      "ADMIN_LOCALHOST_ONLY",
    );
  }

  return {
    email: localAdminEmail,
    transport: "none",
    userId: auth.userId,
    subjectUserId: auth.subjectUserId,
    requestAuthInputs,
  };
}

async function requireSessionAdminRequest(
  request: Request,
  allowedOrigins: ReadonlyArray<string>,
  auth: AuthResult,
  requestAuthInputs: RequestAuthInputs,
  dependencies: RequireAdminRequestDependencies,
): Promise<AdminRequestContext> {
  await enforceSessionCsrfProtection(request.method, requestAuthInputs, allowedOrigins);

  const normalizedEmail = normalizeAdminEmail(auth.email ?? "");
  const hasGrant = await dependencies.hasActiveAdminGrantFn(normalizedEmail);
  if (!hasGrant) {
    throw new HttpError(403, "Admin access required.", "ADMIN_ACCESS_REQUIRED");
  }
  const userProfile = await dependencies.ensureCognitoUserProfileFn(auth.subjectUserId, auth.email);

  return {
    email: normalizedEmail,
    transport: "session",
    userId: userProfile.userId,
    subjectUserId: auth.subjectUserId,
    requestAuthInputs,
  };
}

async function requireCatalogApiKeyAdminRequest(
  auth: AuthResult,
  requestAuthInputs: RequestAuthInputs,
  dependencies: RequireCatalogAdminRequestDependencies,
): Promise<CatalogAdminRequestContext> {
  const profile = await dependencies.loadAdminProfileEmailFn(auth.userId);
  if (profile === null) {
    throw new HttpError(
      403,
      "Catalog admin API-key access requires an existing user profile.",
      "ADMIN_ACCESS_REQUIRED",
    );
  }
  if (profile.email === null || profile.email.trim() === "") {
    throw new HttpError(
      403,
      "Catalog admin API-key access requires a profile email.",
      "ADMIN_ACCESS_REQUIRED",
    );
  }

  const normalizedEmail = normalizeAdminEmail(profile.email);
  const hasGrant = await dependencies.hasActiveAdminGrantFn(normalizedEmail);
  if (!hasGrant) {
    throw new HttpError(403, "Admin access required.", "ADMIN_ACCESS_REQUIRED");
  }

  return {
    email: normalizedEmail,
    transport: "api_key",
    userId: auth.userId,
    subjectUserId: auth.subjectUserId,
    requestAuthInputs,
  };
}

export async function requireAdminRequestWithDependencies(
  request: Request,
  allowedOrigins: ReadonlyArray<string>,
  dependencies: RequireAdminRequestDependencies,
): Promise<AdminRequestContext> {
  const { auth, requestAuthInputs } = await authenticateAdminRequest(
    request,
    dependencies.authenticateRequestFn,
  );

  if (auth.transport === "none") {
    return requireLocalAdminRequest(request, auth, requestAuthInputs);
  }

  if (auth.transport !== "session") {
    throw new HttpError(
      403,
      "Admin endpoints require a signed-in browser session.",
      "ADMIN_HUMAN_AUTH_REQUIRED",
    );
  }

  return requireSessionAdminRequest(request, allowedOrigins, auth, requestAuthInputs, dependencies);
}

export async function requireCatalogAdminRequestWithDependencies(
  request: Request,
  allowedOrigins: ReadonlyArray<string>,
  dependencies: RequireCatalogAdminRequestDependencies,
): Promise<CatalogAdminRequestContext> {
  const { auth, requestAuthInputs } = await authenticateAdminRequest(
    request,
    dependencies.authenticateRequestFn,
  );

  if (auth.transport === "none") {
    return requireLocalAdminRequest(request, auth, requestAuthInputs);
  }
  if (auth.transport === "session") {
    return requireSessionAdminRequest(request, allowedOrigins, auth, requestAuthInputs, dependencies);
  }
  if (auth.transport === "api_key") {
    return requireCatalogApiKeyAdminRequest(auth, requestAuthInputs, dependencies);
  }

  throw new HttpError(
    403,
    "Catalog admin endpoints require a signed-in browser session or admin API key.",
    "ADMIN_HUMAN_AUTH_REQUIRED",
  );
}

export async function requireAdminRequest(
  request: Request,
  allowedOrigins: ReadonlyArray<string>,
): Promise<AdminRequestContext> {
  return requireAdminRequestWithDependencies(request, allowedOrigins, {
    authenticateRequestFn: authenticateRequest,
    ensureCognitoUserProfileFn: ensureCognitoUserProfile,
    hasActiveAdminGrantFn: hasActiveAdminGrant,
  });
}

export async function requireCatalogAdminRequest(
  request: Request,
  allowedOrigins: ReadonlyArray<string>,
): Promise<CatalogAdminRequestContext> {
  return requireCatalogAdminRequestWithDependencies(request, allowedOrigins, {
    authenticateRequestFn: authenticateRequest,
    ensureCognitoUserProfileFn: ensureCognitoUserProfile,
    hasActiveAdminGrantFn: hasActiveAdminGrant,
    loadAdminProfileEmailFn: loadAdminProfileEmail,
  });
}
