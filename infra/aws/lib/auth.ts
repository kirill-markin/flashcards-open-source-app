import * as cdk from "aws-cdk-lib";
import * as cognito from "aws-cdk-lib/aws-cognito";
import * as lambda from "aws-cdk-lib/aws-lambda";
import { Construct } from "constructs";
import { customEmailSender } from "./custom-email-sender";

export interface AuthProps {
  preSignUpFn: lambda.Function;
  nativeProofChallengeFn: lambda.Function;
  resendApiKeySecretArn: string | undefined;
  resendSenderEmail: string | undefined;
  sentryDsnSecretArn: string | undefined;
  sentryEnvironment: string | undefined;
  sentryRelease: string | undefined;
  sentryTracesSampleRate: string | undefined;
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
    sentryDsnSecretArn: props.sentryDsnSecretArn,
    sentryEnvironment: props.sentryEnvironment,
    sentryRelease: props.sentryRelease,
    sentryTracesSampleRate: props.sentryTracesSampleRate,
  });

  const userPool = new cognito.UserPool(scope, "UserPool", {
    userPoolName: "flashcards-users",
    selfSignUpEnabled: false,
    signInAliases: { email: true },
    autoVerify: { email: true },
    customSenderKmsKey: sender.kmsKey,
    lambdaTriggers: {
      preSignUp: props.preSignUpFn,
      customEmailSender: sender.fn,
      defineAuthChallenge: props.nativeProofChallengeFn,
      createAuthChallenge: props.nativeProofChallengeFn,
      verifyAuthChallengeResponse: props.nativeProofChallengeFn,
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
    // Email is the account identity, so access tokens must not rewrite it or other attributes. An empty
    // list means all writable, hence the unused `locale`. Server-side Admin* calls ignore this list,
    // so a server-driven email change stays possible.
    writeAttributes: new cognito.ClientAttributes().withStandardAttributes({ locale: true }),
  });

  // CDK L2 doesn't expose USER_AUTH auth flow — override via L1.
  // Refresh-token rotation (refreshTokenRotationGracePeriod 60s; requires dropping ALLOW_REFRESH_TOKEN_AUTH,
  // keeping ALLOW_USER_AUTH and ALLOW_CUSTOM_AUTH) stays off until active iOS/Android installs older than the
  // first releases that store a rotated `refreshToken` from /api/refresh-token are negligible by app version:
  // they keep the original token and would be signed out after their next refresh.
  (userPoolClient.node.defaultChild as cdk.CfnResource).addPropertyOverride(
    "ExplicitAuthFlows",
    ["ALLOW_USER_AUTH", "ALLOW_REFRESH_TOKEN_AUTH", "ALLOW_CUSTOM_AUTH"],
  );

  return {
    userPool,
    userPoolClient,
    customEmailSenderFn: sender.fn,
  };
}
