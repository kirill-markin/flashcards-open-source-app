export type CognitoTypedError = Error & Readonly<{
  cognitoType: string;
}>;

export function createCognitoTypedError(
  message: string,
  cognitoType: string,
): CognitoTypedError {
  return Object.assign(new Error(message), { cognitoType });
}

export function isCognitoTypedError(error: unknown): error is CognitoTypedError {
  return error instanceof Error
    && "cognitoType" in error
    && typeof error.cognitoType === "string";
}

export function getCognitoErrorType(error: unknown): string | null {
  return isCognitoTypedError(error) ? error.cognitoType : null;
}

export function getNormalizedCognitoErrorType(error: unknown): string {
  const cognitoType = getCognitoErrorType(error);
  return cognitoType === null ? "" : cognitoType.toLowerCase();
}
