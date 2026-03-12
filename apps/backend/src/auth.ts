import { CognitoJwtVerifier } from "aws-jwt-verify";
import { authenticateAgentApiKey } from "./agentApiKeys";
import { getAuthConfig } from "./authConfig";

export type AuthTransport = "none" | "bearer" | "session" | "api_key";

export type AuthResult = Readonly<{
  userId: string;
  transport: AuthTransport;
  connectionId: string | null;
  selectedWorkspaceId: string | null;
}>;

export type AuthRequest = Readonly<{
  authorizationHeader: string | undefined;
  sessionToken: string | undefined;
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
  | Readonly<{ scheme: "api_key"; token: string }>;

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

  throw new AuthError(401, "Authorization header must use Bearer or ApiKey scheme");
}

async function verifyIdToken(token: string): Promise<string> {
  try {
    const payload = await getVerifier().verify(token);
    return payload.sub;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    throw new AuthError(401, `Invalid token: ${message}`);
  }
}

/**
 * Authenticates one request using the validated backend auth config rather
 * than raw env defaults. App startup must already have rejected missing or
 * unsafe auth configuration before any request reaches this function.
 */
export async function authenticateRequest(request: AuthRequest): Promise<AuthResult> {
  const authConfig = getAuthConfig();

  if (authConfig.mode === "none") {
    return { userId: "local", transport: "none", connectionId: null, selectedWorkspaceId: null };
  }

  const parsedAuthorization = parseAuthorizationHeader(request.authorizationHeader);
  if (parsedAuthorization.scheme === "api_key") {
    const auth = await authenticateAgentApiKey(parsedAuthorization.token);
    return {
      userId: auth.userId,
      transport: "api_key",
      connectionId: auth.connectionId,
      selectedWorkspaceId: auth.selectedWorkspaceId,
    };
  }

  if (parsedAuthorization.scheme === "bearer") {
    const userId = await verifyIdToken(parsedAuthorization.token);
    return { userId, transport: "bearer", connectionId: null, selectedWorkspaceId: null };
  }

  if (request.sessionToken !== undefined && request.sessionToken !== "") {
    const userId = await verifyIdToken(request.sessionToken);
    return { userId, transport: "session", connectionId: null, selectedWorkspaceId: null };
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
