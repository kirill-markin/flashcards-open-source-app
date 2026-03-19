export function isRejectedPasswordSignIn(error: unknown): boolean {
  const message = error instanceof Error ? error.message.toLowerCase() : String(error).toLowerCase();
  const cognitoType = error instanceof Error && "cognitoType" in error && typeof error.cognitoType === "string"
    ? error.cognitoType.toLowerCase()
    : "";

  return (
    cognitoType.includes("notauthorizedexception")
    || cognitoType.includes("usernotfoundexception")
    || cognitoType.includes("userdisabledexception")
    || cognitoType.includes("passwordresetrequiredexception")
    || message.includes("incorrect username or password")
    || message.includes("user does not exist")
    || message.includes("password reset required")
    || message.includes("user is disabled")
  );
}
