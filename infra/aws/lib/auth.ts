import * as cdk from "aws-cdk-lib";
import * as cognito from "aws-cdk-lib/aws-cognito";
import * as lambda from "aws-cdk-lib/aws-lambda";
import * as ses from "aws-cdk-lib/aws-ses";
import { Construct } from "constructs";

export interface AuthProps {
  baseDomain: string;
  preSignUpFn: lambda.Function;
  sesSenderEmail: string | undefined;
}

export interface AuthResult {
  configurationSetName: string | undefined;
  userPool: cognito.UserPool;
  userPoolClient: cognito.UserPoolClient;
}

export function auth(scope: Construct, props: AuthProps): AuthResult {
  const sesEnabled = props.sesSenderEmail !== undefined;
  const configurationSet = sesEnabled
    ? new ses.CfnConfigurationSet(scope, "AuthOtpConfigurationSet", {
      name: "flashcards-auth-otp",
      reputationOptions: {
        reputationMetricsEnabled: true,
      },
      sendingOptions: {
        sendingEnabled: true,
      },
    })
    : undefined;

  if (configurationSet !== undefined) {
    new ses.CfnConfigurationSetEventDestination(scope, "AuthOtpCloudWatchDestination", {
      configurationSetName: configurationSet.ref,
      eventDestination: {
        cloudWatchDestination: {
          dimensionConfigurations: [
            {
              defaultDimensionValue: "flashcards-auth-otp",
              dimensionName: "configuration_set",
              dimensionValueSource: "messageTag",
            },
          ],
        },
        enabled: true,
        matchingEventTypes: ["SEND", "DELIVERY", "BOUNCE", "COMPLAINT", "REJECT"],
        name: "cloudwatch",
      },
    });
  }

  const emailConfiguration = configurationSet !== undefined
    ? cognito.UserPoolEmail.withSES({
      configurationSetName: configurationSet.ref,
      fromEmail: props.sesSenderEmail as string,
      fromName: "Flashcards Open Source App",
      sesRegion: cdk.Stack.of(scope).region,
      sesVerifiedDomain: props.baseDomain,
    })
    : cognito.UserPoolEmail.withCognito();

  const userPool = new cognito.UserPool(scope, "UserPool", {
    userPoolName: "flashcards-users",
    selfSignUpEnabled: true,
    signInAliases: { email: true },
    autoVerify: { email: true },
    email: emailConfiguration,
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
    refreshTokenValidity: cdk.Duration.days(365),
    enableTokenRevocation: true,
  });

  // CDK L2 doesn't expose USER_AUTH auth flow — override via L1
  (userPoolClient.node.defaultChild as cdk.CfnResource).addPropertyOverride(
    "ExplicitAuthFlows",
    ["ALLOW_USER_AUTH", "ALLOW_REFRESH_TOKEN_AUTH"],
  );

  return {
    configurationSetName: configurationSet?.ref,
    userPool,
    userPoolClient,
  };
}
