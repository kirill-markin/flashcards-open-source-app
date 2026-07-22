export type CognitoOperation =
  | "InitiateAuth"
  | "RespondToAuthChallenge"
  | "RevokeToken"
  | "SignUp";

export type CognitoErrorMetadata = Readonly<{
  operation: CognitoOperation;
  providerStatusCode: number;
  cognitoType: string;
  reasonCode: string | null;
  message: string;
}>;

export type CognitoTypedError = Readonly<Error & {
  operation: CognitoOperation;
  providerStatusCode: number;
  cognitoType: string;
  reasonCode: string | null;
}>;

export function createCognitoTypedError(metadata: CognitoErrorMetadata): CognitoTypedError {
  return Object.assign(new Error(metadata.message), {
    operation: metadata.operation,
    providerStatusCode: metadata.providerStatusCode,
    cognitoType: metadata.cognitoType,
    reasonCode: metadata.reasonCode,
  });
}

function isCognitoOperation(value: unknown): value is CognitoOperation {
  return value === "InitiateAuth"
    || value === "RespondToAuthChallenge"
    || value === "RevokeToken"
    || value === "SignUp";
}

export function isCognitoTypedError(error: unknown): error is CognitoTypedError {
  return error instanceof Error
    && "operation" in error
    && isCognitoOperation(error.operation)
    && "providerStatusCode" in error
    && typeof error.providerStatusCode === "number"
    && Number.isInteger(error.providerStatusCode)
    && error.providerStatusCode >= 100
    && error.providerStatusCode <= 599
    && "cognitoType" in error
    && typeof error.cognitoType === "string"
    && error.cognitoType.trim() !== ""
    && "reasonCode" in error
    && (
      error.reasonCode === null
      || (typeof error.reasonCode === "string" && error.reasonCode.trim() !== "")
    );
}

export function getCognitoErrorType(error: unknown): string | null {
  return isCognitoTypedError(error) ? error.cognitoType : null;
}

export function getNormalizedCognitoErrorType(error: unknown): string {
  const cognitoType = getCognitoErrorType(error);
  return cognitoType === null ? "" : cognitoType.toLowerCase();
}

export function isCognitoInvalidEmailError(error: unknown): error is CognitoTypedError {
  return isCognitoTypedError(error)
    && error.operation === "SignUp"
    && error.cognitoType === "InvalidParameterException"
    && error.message.trim().toLowerCase() === "invalid email address format.";
}
