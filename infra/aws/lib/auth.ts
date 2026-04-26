import * as cdk from "aws-cdk-lib";
import * as cognito from "aws-cdk-lib/aws-cognito";
import * as lambda from "aws-cdk-lib/aws-lambda";
import { Construct } from "constructs";
import { customEmailSender } from "./custom-email-sender";

export interface AuthProps {
  preSignUpFn: lambda.Function;
  resendApiKeySecretArn: string | undefined;
  resendSenderEmail: string | undefined;
}

export interface AuthResult {
  userPool: cognito.UserPool;
  userPoolClient: cognito.UserPoolClient;
  customEmailSenderFn: lambda.IFunction;
}

export function auth(scope: Construct, props: AuthProps): AuthResult {
  if (props.resendApiKeySecretArn === undefined) {
    throw new Error("resendApiKeySecretArn is required for Cognito email delivery");
  }

  if (props.resendSenderEmail === undefined) {
    throw new Error("resendSenderEmail is required for Cognito email delivery");
  }

  const sender = customEmailSender(scope, {
    resendApiKeySecretArn: props.resendApiKeySecretArn,
    resendSenderEmail: props.resendSenderEmail,
  });

  const userPool = new cognito.UserPool(scope, "UserPool", {
    userPoolName: "flashcards-users",
    selfSignUpEnabled: true,
    signInAliases: { email: true },
    autoVerify: { email: true },
    customSenderKmsKey: sender.kmsKey,
    lambdaTriggers: {
      preSignUp: props.preSignUpFn,
      customEmailSender: sender.fn,
    },
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
    refreshTokenValidity: cdk.Duration.days(365),
    enableTokenRevocation: true,
  });

  // CDK L2 doesn't expose USER_AUTH auth flow — override via L1
  (userPoolClient.node.defaultChild as cdk.CfnResource).addPropertyOverride(
    "ExplicitAuthFlows",
    ["ALLOW_USER_AUTH", "ALLOW_REFRESH_TOKEN_AUTH"],
  );

  return {
    userPool,
    userPoolClient,
    customEmailSenderFn: sender.fn,
  };
}
