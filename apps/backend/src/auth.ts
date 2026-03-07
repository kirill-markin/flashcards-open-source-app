import { CognitoJwtVerifier } from "aws-jwt-verify";

export type AuthTransport = "none" | "bearer" | "session";

export type AuthResult = Readonly<{
  userId: string;
  transport: AuthTransport;
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

function getBearerToken(authorizationHeader: string | undefined): string | null {
  if (authorizationHeader === undefined || authorizationHeader === "") {
    return null;
  }

  if (!authorizationHeader.startsWith("Bearer ")) {
    throw new AuthError(401, "Authorization header must use Bearer scheme");
  }

  const token = authorizationHeader.slice(7).trim();
  if (token === "") {
    throw new AuthError(401, "Authorization header must include a token");
  }

  return token;
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

export async function authenticateRequest(request: AuthRequest): Promise<AuthResult> {
  const authMode = process.env.AUTH_MODE ?? "none";

  if (authMode === "none") {
    return { userId: "local", transport: "none" };
  }

  const bearerToken = getBearerToken(request.authorizationHeader);
  if (bearerToken !== null) {
    const userId = await verifyIdToken(bearerToken);
    return { userId, transport: "bearer" };
  }

  if (request.sessionToken !== undefined && request.sessionToken !== "") {
    const userId = await verifyIdToken(request.sessionToken);
    return { userId, transport: "session" };
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
