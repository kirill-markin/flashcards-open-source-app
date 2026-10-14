import {
  AdminCreateUserCommand,
  CognitoIdentityProviderClient,
  CognitoIdentityProviderServiceException,
} from "@aws-sdk/client-cognito-identity-provider";
import {
  createCognitoTypedError,
  getCognitoErrorType,
  getNormalizedCognitoErrorType,
  type CognitoOperation,
} from "./cognitoErrors.js";
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

async function createPasswordlessUser(email: string): Promise<void> {
  const userPoolId = process.env.COGNITO_USER_POOL_ID ?? "";
  if (userPoolId === "") throw new Error("COGNITO_USER_POOL_ID is not configured");

  try {
    // SUPPRESS prevents an invitation; EMAIL_OTP delivers the only sign-in message.
    // With passwordless enabled, omitting TemporaryPassword creates no password:
    // https://docs.aws.amazon.com/cognito-user-identity-pools/latest/APIReference/API_AdminCreateUser.html
    await getProvisioningClient().send(new AdminCreateUserCommand({
      UserPoolId: userPoolId,
      Username: email,
      MessageAction: "SUPPRESS",
      ForceAliasCreation: false,
      UserAttributes: [
        { Name: "email", Value: email },
        { Name: "email_verified", Value: "false" },
      ],
    }));
  } catch (error) {
    if (!(error instanceof CognitoIdentityProviderServiceException)) throw error;
    throw createCognitoTypedError({
      operation: "AdminCreateUser",
      providerStatusCode: error.$metadata.httpStatusCode ?? 500,
      cognitoType: error.name,
      reasonCode: "reasonCode" in error && typeof error.reasonCode === "string"
        ? error.reasonCode
        : null,
      message: error.message,
    });
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
