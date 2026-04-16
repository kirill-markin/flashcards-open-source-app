/**
 * Cognito Identity Provider API client for passwordless Email OTP.
 *
 * Calls the Cognito IDP endpoint directly via fetch — no AWS SDK needed.
 * Uses USER_AUTH flow with EMAIL_OTP challenge (Essentials tier).
 */
import { randomBytes } from "node:crypto";
import { log, maskEmail } from "./logger.js";

type CognitoErrorResponse = Readonly<{
  __type?: string;
  message?: string;
}>;

type CognitoError = Error & Readonly<{
  cognitoType?: string;
}>;

type InitiateAuthResult = Readonly<{
  session: string;
}>;

type ChallengeResponse = Readonly<{
  challengeName: string;
  session: string;
}>;

export type TokenResult = Readonly<{
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

const getClientId = (): string => {
  const clientId = process.env.COGNITO_CLIENT_ID ?? "";
  if (clientId === "") throw new Error("COGNITO_CLIENT_ID is not configured");
  return clientId;
};

const cognitoFetch = async (
  target: string,
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
    const error = await response.json() as CognitoErrorResponse;
    const errorType = error.__type ?? "";
    const errorMessage = error.message ?? `Cognito ${target} failed: ${response.status}`;
    const err = new Error(errorMessage);
    (err as Error & { cognitoType: string }).cognitoType = errorType;
    throw err;
  }

  return response.json() as Promise<Record<string, unknown>>;
};

function getNormalizedCognitoErrorType(error: unknown): string {
  return error instanceof Error && "cognitoType" in error && typeof (error as CognitoError).cognitoType === "string"
    ? (error as CognitoError).cognitoType.toLowerCase()
    : "";
}

type CognitoFetchFunction = (
  target: string,
  body: Record<string, unknown>,
) => Promise<Record<string, unknown>>;

const signUpUser = async (email: string): Promise<void> => {
  await cognitoFetch("SignUp", {
    ClientId: getClientId(),
    Username: email,
    Password: randomBytes(48).toString("base64"),
    UserAttributes: [{ Name: "email", Value: email }],
  });
};

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

function extractTokenResult(
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
    const cognitoType = (err as Error & { cognitoType?: string }).cognitoType;
    if (cognitoType === "UserNotFoundException") {
      try {
        await signUpUser(email);
      } catch (signUpErr) {
        // Concurrent request already created the user — safe to proceed
        const signUpType = (signUpErr as Error & { cognitoType?: string }).cognitoType;
        if (signUpType !== "UsernameExistsException") throw signUpErr;
      }
      result = await initiateAuth();
    } else {
      throw err;
    }
  }

  const session = result.Session as string | undefined;
  if (session === undefined || session === "") {
    throw new Error("Cognito InitiateAuth did not return a session");
  }

  return { session };
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

  return extractTokenResult(result, "Cognito RespondToAuthChallenge");
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
): Promise<TokenResult> => signInWithPasswordViaCognito(cognitoFetch, email, password);

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

  return extractRefreshResult(result, "Cognito REFRESH_TOKEN_AUTH");
};

export function isTerminalRefreshFailure(error: unknown): boolean {
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
