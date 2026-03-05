import * as cdk from "aws-cdk-lib";
import * as cognito from "aws-cdk-lib/aws-cognito";
import * as lambda from "aws-cdk-lib/aws-lambda";
import { Construct } from "constructs";

export interface AuthProps {
  preSignUpFn: lambda.Function;
}

export interface AuthResult {
  userPool: cognito.UserPool;
  userPoolClient: cognito.UserPoolClient;
}

export function auth(scope: Construct, props: AuthProps): AuthResult {
  const userPool = new cognito.UserPool(scope, "UserPool", {
    userPoolName: "flashcards-users",
    selfSignUpEnabled: true,
    signInAliases: { email: true },
    autoVerify: { email: true },
    lambdaTriggers: { preSignUp: props.preSignUpFn },
    removalPolicy: cdk.RemovalPolicy.RETAIN,
  });

  // Essentials tier required for USER_AUTH + EMAIL_OTP (no L2 support yet)
  const cfnUserPool = userPool.node.defaultChild as cdk.CfnResource;
  cfnUserPool.addPropertyOverride("UserPoolTier", "ESSENTIALS");
  cfnUserPool.addPropertyOverride("Policies.SignInPolicy.AllowedFirstAuthFactors", ["PASSWORD", "EMAIL_OTP"]);

  const userPoolClient = userPool.addClient("AppClient", {
    generateSecret: false,
    supportedIdentityProviders: [
      cognito.UserPoolClientIdentityProvider.COGNITO,
    ],
    refreshTokenValidity: cdk.Duration.days(7),
    enableTokenRevocation: true,
  });

  // CDK L2 doesn't expose USER_AUTH auth flow — override via L1
  (userPoolClient.node.defaultChild as cdk.CfnResource).addPropertyOverride(
    "ExplicitAuthFlows",
    ["ALLOW_USER_AUTH", "ALLOW_REFRESH_TOKEN_AUTH"],
  );

  return { userPool, userPoolClient };
}
