/**
 * JWT authentication middleware for the backend Lambda.
 *
 * AUTH_MODE=none  → returns { userId: "local" } (local dev)
 * AUTH_MODE=cognito → verifies JWT from Authorization: Bearer header
 */
import type { APIGatewayProxyEvent } from "aws-lambda";
import { CognitoJwtVerifier } from "aws-jwt-verify";

export type AuthResult = Readonly<{
  userId: string;
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

export async function authenticateRequest(event: APIGatewayProxyEvent): Promise<AuthResult> {
  const authMode = process.env.AUTH_MODE ?? "none";

  if (authMode === "none") {
    return { userId: "local" };
  }

  const authHeader = event.headers?.Authorization ?? event.headers?.authorization ?? "";
  if (authHeader === "") {
    throw new AuthError(401, "Missing Authorization header");
  }

  if (!authHeader.startsWith("Bearer ")) {
    throw new AuthError(401, "Authorization header must use Bearer scheme");
  }

  const token = authHeader.slice(7);

  try {
    const payload = await getVerifier().verify(token);
    return { userId: payload.sub };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    throw new AuthError(401, `Invalid token: ${message}`);
  }
}

export class AuthError extends Error {
  readonly statusCode: number;

  constructor(statusCode: number, message: string) {
    super(message);
    this.statusCode = statusCode;
  }
}
