import {
  AdminDeleteUserCommand,
  CognitoIdentityProviderClient,
  UserNotFoundException,
} from "@aws-sdk/client-cognito-identity-provider";
import { HttpError } from "../shared/errors";

let cognitoClient: CognitoIdentityProviderClient | undefined;

function getCognitoUserPoolId(): string {
  const userPoolId = process.env.COGNITO_USER_POOL_ID?.trim() ?? "";
  if (userPoolId === "") {
    throw new Error("COGNITO_USER_POOL_ID is required for Cognito user deletion");
  }

  return userPoolId;
}

function getCognitoRegion(): string | undefined {
  const region = process.env.COGNITO_REGION?.trim() ?? "";
  return region === "" ? undefined : region;
}

function getCognitoClient(): CognitoIdentityProviderClient {
  if (cognitoClient !== undefined) {
    return cognitoClient;
  }

  cognitoClient = new CognitoIdentityProviderClient({
    region: getCognitoRegion(),
  });
  return cognitoClient;
}

/** Address the immutable local-user sub so a cleanup retry cannot delete a reused username. */
export async function deleteCognitoUser(cognitoSubject: string): Promise<void> {
  if (cognitoSubject.trim() === "") {
    throw new HttpError(
      500,
      "Account deletion could not resolve the immutable Cognito subject for this user.",
      "ACCOUNT_DELETE_IDENTITY_DELETE_FAILED",
    );
  }

  try {
    await getCognitoClient().send(new AdminDeleteUserCommand({
      UserPoolId: getCognitoUserPoolId(),
      Username: cognitoSubject,
    }));
  } catch (error) {
    if (error instanceof UserNotFoundException) {
      return;
    }

    throw error;
  }
}
