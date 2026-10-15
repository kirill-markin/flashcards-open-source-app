import {
  AdminUserGlobalSignOutCommand, CognitoIdentityProviderClient, UserNotFoundException,
} from "@aws-sdk/client-cognito-identity-provider";
import { logWarning } from "../logger.js";

const client = new CognitoIdentityProviderClient({
  maxAttempts: 2,
  requestHandler: { connectionTimeout: 1_000, requestTimeout: 3_000, throwOnRequestTimeout: true },
});
client.middlewareStack.add((next) => async (args) => {
  try {
    return await next(args);
  } catch (error) {
    logWarning({ domain: "auth", action: "error", code: "PRINCIPAL_SIGNOUT_ATTEMPT_FAILED" });
    throw error;
  }
}, { step: "finalizeRequest", priority: "low", name: "principalSessionRevocationAttemptLogger" });

/** Consume the immutable subject from the leased lifecycle job, never notification or HTTP input. */
export async function revokePrincipalRefreshSessions(cognitoSubject: string): Promise<void> {
  const userPoolId = process.env.COGNITO_USER_POOL_ID;
  if (userPoolId === undefined || userPoolId === "") throw new Error("Cognito user pool is not configured for session revocation");
  try {
    await client.send(new AdminUserGlobalSignOutCommand({ UserPoolId: userPoolId, Username: cognitoSubject }), {
      abortSignal: AbortSignal.timeout(8_000),
    });
  } catch (error) {
    if (error instanceof UserNotFoundException) return;
    throw new Error("PRINCIPAL_SIGNOUT_FAILED");
  }
}
