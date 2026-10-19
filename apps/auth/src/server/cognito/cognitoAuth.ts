import {
  AdminCreateUserCommand,
  AdminGetUserCommand,
  CognitoIdentityProviderClient,
  CognitoIdentityProviderServiceException,
} from "@aws-sdk/client-cognito-identity-provider";
import {
  createCognitoTypedError,
  getCognitoErrorType,
  getNormalizedCognitoErrorType,
  type CognitoOperation,
} from "./cognitoErrors.js";
import { assertNewlyIssuedSessionToken, IssuedSessionValidationError, verifiedBrowserSession, type BrowserSessionPresentation } from "../browserSession.js";
import { PrincipalSessionError } from "../social/principalSessions.js";
import { CognitoJwtVerifier } from "aws-jwt-verify";
import { assertAppleRelayDeliveryAllowed } from "../social/appleNotifications.js";
import { log, maskEmail } from "../logger.js";

type CognitoErrorResponse = Readonly<{
  cognitoType: string;
  message: string;
  reasonCode: string | null;
}>;

type InitiateAuthResult = Readonly<{
  session: string;
}>;

type ChallengeResponse = Readonly<{
  challengeName: string;
  session: string;
}>;

export type TokenResult = Readonly<{
  [verifiedBrowserSession]?: BrowserSessionPresentation;
  idToken: string;
  accessToken: string;
  refreshToken: string;
  expiresIn: number;
}>;

type RefreshResult = Readonly<{
  idToken: string;
  accessToken: string;
  expiresIn: number;
}>;

const getRegion = (): string => {
  const region = process.env.COGNITO_REGION ?? "";
  if (region === "") throw new Error("COGNITO_REGION is not configured");
  return region;
};

export const getClientId = (): string => {
  const clientId = process.env.COGNITO_CLIENT_ID ?? "";
  if (clientId === "") throw new Error("COGNITO_CLIENT_ID is not configured");
  return clientId;
};

function getCognitoErrorResponseContext(
  operation: CognitoOperation,
  providerStatusCode: number,
): string {
  return `Cognito ${operation} error response (HTTP ${providerStatusCode})`;
}

function parseRequiredCognitoErrorString(
  value: unknown,
  fieldName: "__type" | "message",
  context: string,
): string {
  if (typeof value !== "string" || value.trim() === "") {
    throw new TypeError(`${context} must include a non-empty string ${fieldName} field`);
  }

  return value;
}

function parseCognitoReasonCode(value: unknown, context: string): string | null {
  if (value === undefined) {
    return null;
  }

  if (typeof value !== "string" || value.trim() === "") {
    throw new TypeError(`${context} reasonCode field must be a non-empty string when present`);
  }

  return value;
}

function parseCognitoErrorResponse(
  value: unknown,
  operation: CognitoOperation,
  providerStatusCode: number,
): CognitoErrorResponse {
  const context = getCognitoErrorResponseContext(operation, providerStatusCode);
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new TypeError(`${context} must be a JSON object`);
  }

  const fields = value as Record<string, unknown>;
  return {
    cognitoType: parseRequiredCognitoErrorString(fields.__type, "__type", context),
    message: parseRequiredCognitoErrorString(fields.message, "message", context),
    reasonCode: parseCognitoReasonCode(fields.reasonCode, context),
  };
}

export const cognitoFetch = async (
  target: CognitoOperation,
  body: Record<string, unknown>,
): Promise<Record<string, unknown>> => {
  const endpoint = `https://cognito-idp.${getRegion()}.amazonaws.com/`;

  const response = await fetch(endpoint, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-amz-json-1.1",
      "X-Amz-Target": `AWSCognitoIdentityProviderService.${target}`,
    },
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    let errorResponseValue: unknown;
    try {
      errorResponseValue = await response.json();
    } catch (error) {
      throw new TypeError(
        `${getCognitoErrorResponseContext(target, response.status)} was not valid JSON`,
        { cause: error },
      );
    }

    const errorResponse = parseCognitoErrorResponse(errorResponseValue, target, response.status);
    throw createCognitoTypedError({
      operation: target,
      providerStatusCode: response.status,
      cognitoType: errorResponse.cognitoType,
      reasonCode: errorResponse.reasonCode,
      message: errorResponse.message,
    });
  }

  return response.json() as Promise<Record<string, unknown>>;
};

type CognitoFetchFunction = (
  target: CognitoOperation,
  body: Record<string, unknown>,
) => Promise<Record<string, unknown>>;

let provisioningClient: CognitoIdentityProviderClient | undefined;

function getProvisioningClient(): CognitoIdentityProviderClient {
  if (provisioningClient === undefined) {
    provisioningClient = new CognitoIdentityProviderClient({ region: getRegion() });
  }
  return provisioningClient;
}

export type CognitoEmailPrincipal = Readonly<{
  cognitoSubject: string;
  cognitoUsername: string;
  email: string;
}>;

function getUserPoolId(): string {
  const userPoolId = process.env.COGNITO_USER_POOL_ID ?? "";
  if (userPoolId === "") throw new Error("COGNITO_USER_POOL_ID is not configured");
  return userPoolId;
}

function rethrowProvisioningError(error: unknown, operation: "AdminCreateUser" | "AdminGetUser"): never {
  // Without a real provider status the error stays unclassified rather than claiming a Cognito outage.
  if (!(error instanceof CognitoIdentityProviderServiceException) || error.$metadata.httpStatusCode === undefined) throw error;
  throw createCognitoTypedError({
    operation,
    providerStatusCode: error.$metadata.httpStatusCode,
    cognitoType: error.name,
    reasonCode: "reasonCode" in error && typeof error.reasonCode === "string" ? error.reasonCode : null,
    message: error.message,
  });
}

async function createPasswordlessUser(email: string): Promise<void> {
  try {
    await getProvisioningClient().send(new AdminCreateUserCommand({
      UserPoolId: getUserPoolId(), Username: email, MessageAction: "SUPPRESS", ForceAliasCreation: false,
      UserAttributes: [{ Name: "email", Value: email }, { Name: "email_verified", Value: "false" }],
    }));
  } catch (error) {
    rethrowProvisioningError(error, "AdminCreateUser");
  }
}

export async function createProvedEmailPrincipal(email: string): Promise<CognitoEmailPrincipal | null> {
  try {
    const result = await getProvisioningClient().send(new AdminCreateUserCommand({
      UserPoolId: getUserPoolId(), Username: email, MessageAction: "SUPPRESS", ForceAliasCreation: false,
      UserAttributes: [{ Name: "email", Value: email }, { Name: "email_verified", Value: "true" }],
    }));
    const user = result.User;
    const subject = user?.Attributes?.find((attribute) => attribute.Name === "sub")?.Value;
    const actualEmail = user?.Attributes?.find((attribute) => attribute.Name === "email")?.Value;
    const verified = user?.Attributes?.find((attribute) => attribute.Name === "email_verified")?.Value;
    if (typeof subject !== "string" || subject === "" || typeof user?.Username !== "string" || user.Username === ""
      || typeof actualEmail !== "string" || actualEmail.toLowerCase() !== email || verified !== "true") {
      throw new Error("Cognito AdminCreateUser did not return the proved email and immutable principal");
    }
    return { cognitoSubject: subject, cognitoUsername: user.Username, email };
  } catch (error) {
    if (error instanceof CognitoIdentityProviderServiceException
      && (error.name === "UsernameExistsException" || error.name === "AliasExistsException")) return null;
    rethrowProvisioningError(error, "AdminCreateUser");
  }
}

type ExistingEmailPrincipalLookup =
  | Readonly<{ status: "available"; principal: CognitoEmailPrincipal }>
  | Readonly<{ status: "unavailable" }>;

async function lookupExistingEmailPrincipal(email: string): Promise<ExistingEmailPrincipalLookup | null> {
  try {
    const result = await getProvisioningClient().send(new AdminGetUserCommand({
      UserPoolId: getUserPoolId(), Username: email,
    }));
    const subjects = result.UserAttributes?.filter((attribute) => attribute.Name === "sub") ?? [];
    const emails = result.UserAttributes?.filter((attribute) => attribute.Name === "email") ?? [];
    const subject = subjects[0]?.Value;
    const actualEmail = emails[0]?.Value;
    if (subjects.length !== 1 || emails.length !== 1 || typeof subject !== "string"
      || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(subject)
      || typeof result.Username !== "string" || result.Username.trim() === ""
      || typeof actualEmail !== "string" || actualEmail.toLowerCase() !== email) {
      throw new Error("Cognito AdminGetUser did not return the exact email and immutable principal");
    }
    if (result.Enabled !== true || result.UserStatus !== "CONFIRMED") {
      return { status: "unavailable" };
    }
    return { status: "available", principal: { cognitoSubject: subject, cognitoUsername: result.Username, email } };
  } catch (error) {
    if (error instanceof CognitoIdentityProviderServiceException && error.name === "UserNotFoundException") return null;
    rethrowProvisioningError(error, "AdminGetUser");
  }
}

/** Resolves identity only: fresh authoritative provider proof must supply mailbox ownership. */
export async function loadExistingEmailPrincipal(email: string): Promise<CognitoEmailPrincipal | null> {
  const result = await lookupExistingEmailPrincipal(email);
  if (result === null) return null;
  if (result.status === "unavailable") {
    throw createCognitoTypedError({ operation: "AdminGetUser", providerStatusCode: 400,
      cognitoType: "NotAuthorizedException", reasonCode: null,
      message: "Cognito email principal must be enabled and confirmed for provider sign-in" });
  }
  return result.principal;
}

/** Optional collision evidence cannot prevent an established provider method from signing in. */
export async function loadAvailableEmailPrincipal(email: string): Promise<CognitoEmailPrincipal | null> {
  const result = await lookupExistingEmailPrincipal(email);
  return result?.status === "available" ? result.principal : null;
}

let emailPrincipalVerifier: ReturnType<typeof CognitoJwtVerifier.create> | undefined;

/** Called with the result of this request's real EMAIL_OTP challenge, never a caller-supplied token. */
export async function verifyEmailOtpPrincipal(
  email: string, code: string, session: string,
): Promise<CognitoEmailPrincipal & Readonly<{ authTime: number }>> {
  return verifyOtpPrincipalTokens(email, await verifyEmailOtp(email, code, session));
}

/** Existing principal only: no provisioning, alias lookup or forced alias transfer. */
export async function initiateCurrentEmailOtp(email: string, username: string): Promise<InitiateAuthResult> {
  await assertAppleRelayDeliveryAllowed(email);
  const result = await cognitoFetch("InitiateAuth", {
    AuthFlow: "USER_AUTH", ClientId: getClientId(),
    AuthParameters: { USERNAME: username, PREFERRED_CHALLENGE: "EMAIL_OTP" },
  });
  const challenge = extractChallengeResponse(result, "Cognito current-account reauthentication");
  if (challenge.challengeName !== "EMAIL_OTP") throw new Error(`Unexpected Cognito email challenge: ${challenge.challengeName}`);
  return { session: challenge.session };
}

export async function verifyCurrentEmailOtpPrincipal(
  email: string, username: string, code: string, session: string,
): Promise<CognitoEmailPrincipal & Readonly<{ authTime: number }>> {
  return verifyOtpPrincipalTokens(email, await verifyEmailOtp(username, code, session));
}

async function verifyOtpPrincipalTokens(
  email: string, tokens: TokenResult,
): Promise<CognitoEmailPrincipal & Readonly<{ authTime: number }>> {
  try {
    if (emailPrincipalVerifier === undefined) {
      emailPrincipalVerifier = CognitoJwtVerifier.create({
        userPoolId: getUserPoolId(), tokenUse: "id", clientId: getClientId(), graceSeconds: 0,
      });
    }
    const payload = await emailPrincipalVerifier.verify(tokens.idToken);
    const username = payload["cognito:username"];
    const now = Math.floor(Date.now() / 1_000);
    if (typeof payload.sub !== "string" || payload.sub === "" || typeof username !== "string" || username === ""
      || typeof payload.email !== "string" || payload.email.toLowerCase() !== email || payload.email_verified !== true
      || !Number.isSafeInteger(payload.auth_time) || (payload.auth_time as number) < now - 60
      || (payload.auth_time as number) > now + 30) {
      throw new Error("Cognito EMAIL_OTP did not return a fresh verified mailbox principal");
    }
    return { cognitoSubject: payload.sub, cognitoUsername: username, email, authTime: payload.auth_time as number };
  } catch (error) {
    log({ domain: "auth", action: "issued_session_validation_error",
      error: error instanceof Error ? error.message : String(error) });
    throw new IssuedSessionValidationError(error);
  }
}

function extractRequiredStringField(
  value: unknown,
  fieldName: string,
  context: string,
): string {
  if (typeof value !== "string" || value === "") {
    throw new Error(`${context} did not return ${fieldName}`);
  }

  return value;
}

export function extractTokenResult(
  result: Record<string, unknown>,
  context: string,
): TokenResult {
  const authResult = result.AuthenticationResult as Record<string, unknown> | undefined;
  if (authResult === undefined) {
    throw new Error(`${context} did not return AuthenticationResult`);
  }

  return {
    idToken: extractRequiredStringField(authResult.IdToken, "IdToken", context),
    accessToken: extractRequiredStringField(authResult.AccessToken, "AccessToken", context),
    refreshToken: extractRequiredStringField(authResult.RefreshToken, "RefreshToken", context),
    expiresIn: authResult.ExpiresIn as number,
  };
}

function extractRefreshResult(
  result: Record<string, unknown>,
  context: string,
): RefreshResult {
  const authResult = result.AuthenticationResult as Record<string, unknown> | undefined;
  if (authResult === undefined) {
    throw new Error(`${context} did not return AuthenticationResult`);
  }

  return {
    idToken: extractRequiredStringField(authResult.IdToken, "IdToken", context),
    accessToken: extractRequiredStringField(authResult.AccessToken, "AccessToken", context),
    expiresIn: authResult.ExpiresIn as number,
  };
}

function extractChallengeResponse(
  result: Record<string, unknown>,
  context: string,
): ChallengeResponse {
  const challengeName = extractRequiredStringField(result.ChallengeName, "ChallengeName", context);
  const session = extractRequiredStringField(result.Session, "Session", context);
  return {
    challengeName,
    session,
  };
}

export const initiateEmailOtp = async (email: string): Promise<InitiateAuthResult> => {
  await assertAppleRelayDeliveryAllowed(email);
  const clientId = getClientId();

  const initiateAuth = async (): Promise<Record<string, unknown>> =>
    cognitoFetch("InitiateAuth", {
      AuthFlow: "USER_AUTH",
      ClientId: clientId,
      AuthParameters: {
        USERNAME: email,
        PREFERRED_CHALLENGE: "EMAIL_OTP",
      },
    });

  let result: Record<string, unknown>;
  try {
    result = await initiateAuth();
  } catch (err) {
    const cognitoType = getCognitoErrorType(err);
    if (cognitoType === "UserNotFoundException") {
      try {
        await createPasswordlessUser(email);
      } catch (signUpErr) {
        const signUpType = getCognitoErrorType(signUpErr);
        if (signUpType !== "UsernameExistsException") throw signUpErr;
      }
      result = await initiateAuth();
    } else {
      throw err;
    }
  }

  const challenge = extractChallengeResponse(result, "Cognito InitiateAuth");
  if (challenge.challengeName !== "EMAIL_OTP") {
    throw new Error(`Unexpected Cognito email challenge: ${challenge.challengeName}`);
  }

  return { session: challenge.session };
};

export const verifyEmailOtp = async (
  email: string,
  code: string,
  session: string,
): Promise<TokenResult> => {
  const result = await cognitoFetch("RespondToAuthChallenge", {
    ClientId: getClientId(),
    ChallengeName: "EMAIL_OTP",
    Session: session,
    ChallengeResponses: {
      USERNAME: email,
      EMAIL_OTP_CODE: code,
    },
  });

  log({ domain: "auth", action: "verify_code", maskedEmail: maskEmail(email) });

  const tokens = extractTokenResult(result, "Cognito RespondToAuthChallenge");
  return { ...tokens, [verifiedBrowserSession]: await assertNewlyIssuedSessionToken(tokens.idToken) };
};

async function signInWithPasswordViaCognito(
  cognitoFetchFn: CognitoFetchFunction,
  email: string,
  password: string,
): Promise<TokenResult> {
  const clientId = getClientId();
  const initialResult = await cognitoFetchFn("InitiateAuth", {
    AuthFlow: "USER_AUTH",
    ClientId: clientId,
    AuthParameters: {
      USERNAME: email,
      PREFERRED_CHALLENGE: "PASSWORD",
      PASSWORD: password,
    },
  });

  if (initialResult.AuthenticationResult !== undefined) {
    log({ domain: "auth", action: "sign_in_password", maskedEmail: maskEmail(email) });
    return extractTokenResult(initialResult, "Cognito InitiateAuth");
  }

  const initialChallenge = extractChallengeResponse(initialResult, "Cognito InitiateAuth");
  let passwordChallengeSession = initialChallenge.session;

  if (initialChallenge.challengeName === "SELECT_CHALLENGE") {
    const selectedChallengeResult = await cognitoFetchFn("RespondToAuthChallenge", {
      ClientId: clientId,
      ChallengeName: "SELECT_CHALLENGE",
      Session: initialChallenge.session,
      ChallengeResponses: {
        USERNAME: email,
        ANSWER: "PASSWORD",
        PASSWORD: password,
      },
    });

    if (selectedChallengeResult.AuthenticationResult !== undefined) {
      log({ domain: "auth", action: "sign_in_password", maskedEmail: maskEmail(email) });
      return extractTokenResult(selectedChallengeResult, "Cognito RespondToAuthChallenge");
    }

    const selectedChallenge = extractChallengeResponse(
      selectedChallengeResult,
      "Cognito RespondToAuthChallenge",
    );
    if (selectedChallenge.challengeName !== "PASSWORD") {
      throw new Error(`Unexpected Cognito password challenge: ${selectedChallenge.challengeName}`);
    }
    passwordChallengeSession = selectedChallenge.session;
  } else if (initialChallenge.challengeName !== "PASSWORD") {
    throw new Error(`Unexpected Cognito password challenge: ${initialChallenge.challengeName}`);
  }

  const passwordResult = await cognitoFetchFn("RespondToAuthChallenge", {
    ClientId: clientId,
    ChallengeName: "PASSWORD",
    Session: passwordChallengeSession,
    ChallengeResponses: {
      USERNAME: email,
      PASSWORD: password,
    },
  });

  log({ domain: "auth", action: "sign_in_password", maskedEmail: maskEmail(email) });
  return extractTokenResult(passwordResult, "Cognito RespondToAuthChallenge");
}

export const signInWithPassword = async (
  email: string,
  password: string,
): Promise<TokenResult> => {
  const tokens = await signInWithPasswordViaCognito(cognitoFetch, email, password);
  return { ...tokens, [verifiedBrowserSession]: await assertNewlyIssuedSessionToken(tokens.idToken) };
};

export const __internal = {
  signInWithPasswordViaCognito,
};

export const refreshTokens = async (refreshToken: string): Promise<RefreshResult> => {
  const result = await cognitoFetch("InitiateAuth", {
    AuthFlow: "REFRESH_TOKEN_AUTH",
    ClientId: getClientId(),
    AuthParameters: {
      REFRESH_TOKEN: refreshToken,
    },
  });

  log({ domain: "auth", action: "refresh_token" });

  const tokens = extractRefreshResult(result, "Cognito REFRESH_TOKEN_AUTH");
  await assertNewlyIssuedSessionToken(tokens.idToken);
  return tokens;
};

export function isTerminalRefreshFailure(error: unknown): boolean {
  if (error instanceof PrincipalSessionError) return error.statusCode !== 503;
  const normalizedType = getNormalizedCognitoErrorType(error);
  return normalizedType.includes("notauthorizedexception")
    || normalizedType.includes("refreshtokenreuseexception");
}

export const revokeToken = async (refreshToken: string): Promise<void> => {
  await cognitoFetch("RevokeToken", {
    Token: refreshToken,
    ClientId: getClientId(),
  });

  log({ domain: "auth", action: "revoke_token" });
};
