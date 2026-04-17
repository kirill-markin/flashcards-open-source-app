import { AuthError, authenticateRequest, type AuthRequest, type AuthResult } from "../auth";
import { HttpError } from "../errors";
import {
  enforceSessionCsrfProtection,
  extractRequestAuthInputs,
  toAuthRequest,
  type RequestAuthInputs,
} from "../requestSecurity";
import { unsafeQuery } from "../dbUnsafe";

type AdminAccessQueryRow = Readonly<{
  exists: number;
}>;

type RequireAdminRequestDependencies = Readonly<{
  authenticateRequestFn: (request: AuthRequest) => Promise<AuthResult>;
  hasActiveAdminGrantFn: (email: string) => Promise<boolean>;
}>;

export type AdminRequestContext = Readonly<{
  email: string;
  transport: "session" | "none";
  userId: string;
  subjectUserId: string;
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

export async function requireAdminRequestWithDependencies(
  request: Request,
  allowedOrigins: ReadonlyArray<string>,
  dependencies: RequireAdminRequestDependencies,
): Promise<AdminRequestContext> {
  const requestAuthInputs = extractRequestAuthInputs(request);
  let auth: AuthResult;

  try {
    auth = await dependencies.authenticateRequestFn(toAuthRequest(requestAuthInputs));
  } catch (error) {
    if (error instanceof AuthError) {
      throw error;
    }

    throw error;
  }

  if (auth.transport === "none") {
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

  if (auth.transport !== "session") {
    throw new HttpError(
      403,
      "Admin endpoints require a signed-in browser session.",
      "ADMIN_HUMAN_AUTH_REQUIRED",
    );
  }

  await enforceSessionCsrfProtection(request.method, requestAuthInputs, allowedOrigins);

  const normalizedEmail = normalizeAdminEmail(auth.email ?? "");
  const hasGrant = await dependencies.hasActiveAdminGrantFn(normalizedEmail);
  if (!hasGrant) {
    throw new HttpError(403, "Admin access required.", "ADMIN_ACCESS_REQUIRED");
  }

  return {
    email: normalizedEmail,
    transport: auth.transport,
    userId: auth.userId,
    subjectUserId: auth.subjectUserId,
    requestAuthInputs,
  };
}

export async function requireAdminRequest(
  request: Request,
  allowedOrigins: ReadonlyArray<string>,
): Promise<AdminRequestContext> {
  return requireAdminRequestWithDependencies(request, allowedOrigins, {
    authenticateRequestFn: authenticateRequest,
    hasActiveAdminGrantFn: hasActiveAdminGrant,
  });
}
