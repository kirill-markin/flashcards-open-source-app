import * as cognito from "../cognito/cognitoAuth.js";
import { assertNewlyIssuedSessionToken, verifiedBrowserSession } from "../browserSession.js";
import {
  initiateLocalEmailOtp,
  LocalRefreshRejectedError,
  refreshLocalTokens,
  revokeLocalToken,
  verifyLocalEmailOtp,
} from "../local/localEmailOtp.js";
import { getIdentityProvider, SignInUnavailableError } from "./identityProvider.js";

/** The email-code and token-lifecycle calls of the browser and agent routes, per identity provider. */
export type SessionTokens = Omit<cognito.TokenResult, "accessToken">;
export type RefreshedSessionTokens = Readonly<{
  idToken: string;
  /** Present only when the provider rotated the refresh token; otherwise the caller keeps the one it sent. */
  refreshToken: string | null;
  expiresIn: number;
}>;

const signInDisabledMessage = "Sign-in is disabled on this server.";

export async function initiateEmailOtp(email: string): Promise<Readonly<{ session: string }>> {
  const provider = getIdentityProvider();
  if (provider === "cognito") return cognito.initiateEmailOtp(email);
  if (provider === "local") return initiateLocalEmailOtp(email);
  throw new SignInUnavailableError(signInDisabledMessage);
}

export async function verifyEmailOtp(email: string, code: string, session: string): Promise<SessionTokens> {
  const provider = getIdentityProvider();
  if (provider === "cognito") return cognito.verifyEmailOtp(email, code, session);
  if (provider === "none") throw new SignInUnavailableError(signInDisabledMessage);
  const tokens = await verifyLocalEmailOtp(email, code, session);
  return { ...tokens, [verifiedBrowserSession]: await assertNewlyIssuedSessionToken(tokens.idToken) };
}

/** Review-account password sign-in exists only on Cognito. */
export async function signInWithPassword(email: string, password: string): Promise<SessionTokens> {
  if (getIdentityProvider() !== "cognito") throw new SignInUnavailableError("Password sign-in is unavailable on this server.");
  return cognito.signInWithPassword(email, password);
}

export async function refreshTokens(refreshToken: string): Promise<RefreshedSessionTokens> {
  const provider = getIdentityProvider();
  if (provider === "cognito") return cognito.refreshTokens(refreshToken);
  if (provider === "none") throw new SignInUnavailableError(signInDisabledMessage);
  const tokens = await refreshLocalTokens(refreshToken);
  await assertNewlyIssuedSessionToken(tokens.idToken);
  return tokens;
}

export function isTerminalRefreshFailure(error: unknown): boolean {
  return error instanceof LocalRefreshRejectedError || cognito.isTerminalRefreshFailure(error);
}

export async function revokeToken(refreshToken: string): Promise<void> {
  const provider = getIdentityProvider();
  if (provider === "cognito") return cognito.revokeToken(refreshToken);
  if (provider === "local") return revokeLocalToken(refreshToken);
  throw new SignInUnavailableError(signInDisabledMessage);
}
