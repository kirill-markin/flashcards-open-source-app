import { CognitoJwtVerifier } from "aws-jwt-verify";
import { authenticateAgentApiKey } from "./agentApiKeys";
import { getAuthConfig } from "./authConfig";
import { unsafeQuery } from "./dbUnsafe";
import { authenticateGuestSession } from "./guestAuth";

export type AuthTransport = "none" | "bearer" | "session" | "api_key" | "guest";

export type AuthResult = Readonly<{
  userId: string;
  email: string | null;
  cognitoUsername: string | null;
  subjectUserId: string;
  transport: AuthTransport;
  connectionId: string | null;
  selectedWorkspaceId: string | null;
}>;

export type AuthRequest = Readonly<{
  authorizationHeader: string | undefined;
  sessionToken: string | undefined;
}>;

type VerifiedIdTokenPayload = Readonly<{
  sub: string;
  email?: unknown;
  "cognito:username"?: unknown;
}>;

export type AuthenticatedUserIdentity = Readonly<{
  userId: string;
  email: string;
  cognitoUsername: string | null;
}>;

let verifier: ReturnType<typeof CognitoJwtVerifier.create> | undefined;

function getVerifier(): ReturnType<typeof CognitoJwtVerifier.create> {
  if (verifier) return verifier;

  const userPoolId = process.env.COGNITO_USER_POOL_ID;
  const clientId = process.env.COGNITO_CLIENT_ID;
  if (!userPoolId || !clientId) {
    throw new Error("COGNITO_USER_POOL_ID and COGNITO_CLIENT_ID are required when AUTH_MODE=cognito");
  }

  verifier = CognitoJwtVerifier.create({
    userPoolId,
    tokenUse: "id",
    clientId,
  });

  return verifier;
}

type ParsedAuthorizationHeader =
  | Readonly<{ scheme: "none" }>
  | Readonly<{ scheme: "bearer"; token: string }>
  | Readonly<{ scheme: "guest"; token: string }>
  | Readonly<{ scheme: "api_key"; token: string }>;

type IdentityMappingRow = Readonly<{
  user_id: string;
}>;

function parseAuthorizationHeader(authorizationHeader: string | undefined): ParsedAuthorizationHeader {
  if (authorizationHeader === undefined || authorizationHeader === "") {
    return { scheme: "none" };
  }

  if (authorizationHeader.startsWith("Bearer ")) {
    const token = authorizationHeader.slice(7).trim();
    if (token === "") {
      throw new AuthError(401, "Authorization header must include a token");
    }

    return { scheme: "bearer", token };
  }

  if (authorizationHeader.startsWith("ApiKey ")) {
    const token = authorizationHeader.slice(7).trim();
    if (token === "") {
      throw new AuthError(401, "Authorization header must include an API key");
    }

    return { scheme: "api_key", token };
  }

  if (authorizationHeader.startsWith("Guest ")) {
    const token = authorizationHeader.slice(6).trim();
    if (token === "") {
      throw new AuthError(401, "Authorization header must include a guest token");
    }

    return { scheme: "guest", token };
  }

  throw new AuthError(401, "Authorization header must use Bearer, Guest, or ApiKey scheme");
}

export function extractVerifiedIdTokenIdentity(payload: VerifiedIdTokenPayload): AuthenticatedUserIdentity {
  const email = typeof payload.email === "string" ? payload.email.trim() : "";
  if (email === "") {
    throw new Error("Cognito ID token is missing email claim");
  }

  const cognitoUsername = typeof payload["cognito:username"] === "string"
    ? payload["cognito:username"].trim()
    : "";

  return {
    userId: payload.sub,
    email,
    cognitoUsername: cognitoUsername === "" ? null : cognitoUsername,
  };
}

async function verifyIdToken(token: string): Promise<AuthenticatedUserIdentity> {
  try {
    const payload = await getVerifier().verify(token);
    return extractVerifiedIdTokenIdentity(payload as VerifiedIdTokenPayload);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    throw new AuthError(401, `Invalid token: ${message}`);
  }
}

async function resolveMappedCognitoUserId(providerSubject: string): Promise<string | null> {
  const result = await unsafeQuery<IdentityMappingRow>(
    [
      "SELECT user_id",
      "FROM auth.user_identities",
      "WHERE provider_type = 'cognito' AND provider_subject = $1",
      "LIMIT 1",
    ].join(" "),
    [providerSubject],
  );

  return result.rows[0]?.user_id ?? null;
}

/**
 * Authenticates one request using the validated backend auth config rather
 * than raw env defaults. App startup must already have rejected missing or
 * unsafe auth configuration before any request reaches this function.
 */
export async function authenticateRequest(request: AuthRequest): Promise<AuthResult> {
  const authConfig = getAuthConfig();

  if (authConfig.mode === "none") {
    return {
      userId: "local",
      email: null,
      cognitoUsername: null,
      subjectUserId: "local",
      transport: "none",
      connectionId: null,
      selectedWorkspaceId: null,
    };
  }

  const parsedAuthorization = parseAuthorizationHeader(request.authorizationHeader);
  if (parsedAuthorization.scheme === "api_key") {
    const auth = await authenticateAgentApiKey(parsedAuthorization.token);
    return {
      userId: auth.userId,
      email: null,
      cognitoUsername: null,
      subjectUserId: auth.userId,
      transport: "api_key",
      connectionId: auth.connectionId,
      selectedWorkspaceId: auth.selectedWorkspaceId,
    };
  }

  if (parsedAuthorization.scheme === "bearer") {
    const identity = await verifyIdToken(parsedAuthorization.token);
    const mappedUserId = await resolveMappedCognitoUserId(identity.userId);
    return {
      ...identity,
      userId: mappedUserId ?? identity.userId,
      subjectUserId: identity.userId,
      transport: "bearer",
      connectionId: null,
      selectedWorkspaceId: null,
    };
  }

  if (parsedAuthorization.scheme === "guest") {
    const guestSession = await authenticateGuestSession(parsedAuthorization.token);
    return {
      userId: guestSession.userId,
      email: null,
      cognitoUsername: null,
      subjectUserId: guestSession.userId,
      transport: "guest",
      connectionId: null,
      selectedWorkspaceId: null,
    };
  }

  if (request.sessionToken !== undefined && request.sessionToken !== "") {
    const identity = await verifyIdToken(request.sessionToken);
    const mappedUserId = await resolveMappedCognitoUserId(identity.userId);
    return {
      ...identity,
      userId: mappedUserId ?? identity.userId,
      subjectUserId: identity.userId,
      transport: "session",
      connectionId: null,
      selectedWorkspaceId: null,
    };
  }

  throw new AuthError(401, "Missing authentication token");
}

export class AuthError extends Error {
  readonly statusCode: number;

  constructor(statusCode: number, message: string) {
    super(message);
    this.statusCode = statusCode;
  }
}
