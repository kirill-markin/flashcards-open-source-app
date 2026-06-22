import * as cdk from "aws-cdk-lib";
import * as iam from "aws-cdk-lib/aws-iam";
import * as kms from "aws-cdk-lib/aws-kms";
import * as lambda from "aws-cdk-lib/aws-lambda";
import * as lambdaNodejs from "aws-cdk-lib/aws-lambda-nodejs";
import * as secretsmanager from "aws-cdk-lib/aws-secretsmanager";
import { Construct } from "constructs";
import * as path from "path";

export interface CustomEmailSenderProps {
  resendApiKeySecretArn: string;
  resendSenderEmail: string;
  sentryDsnSecretArn: string | undefined;
  sentryEnvironment: string | undefined;
  sentryRelease: string | undefined;
  sentryTracesSampleRate: string | undefined;
}

export interface CustomEmailSenderResult {
  fn: lambdaNodejs.NodejsFunction;
  kmsKey: kms.Key;
}

const bundling: lambdaNodejs.BundlingOptions = {
  minify: true,
  sourceMap: true,
};

function hasConfiguredValue(value: string | undefined): value is string {
  return value !== undefined && value !== "";
}

function addOptionalSentryEnvironment(
  scope: Construct,
  fn: lambdaNodejs.NodejsFunction,
  props: CustomEmailSenderProps,
): void {
  if (!hasConfiguredValue(props.sentryDsnSecretArn)) {
    return;
  }
  if (
    !hasConfiguredValue(props.sentryEnvironment) ||
    !hasConfiguredValue(props.sentryRelease) ||
    !hasConfiguredValue(props.sentryTracesSampleRate)
  ) {
    throw new Error("sentryEnvironment, sentryRelease, and sentryTracesSampleRate are required when sentryDsnSecretArn is configured");
  }

  const tracesSampleRate = Number(props.sentryTracesSampleRate);
  if (!Number.isFinite(tracesSampleRate) || tracesSampleRate < 0 || tracesSampleRate > 1) {
    throw new Error("sentryTracesSampleRate must be a number between 0 and 1");
  }

  const secret = secretsmanager.Secret.fromSecretCompleteArn(
    scope,
    "CustomEmailSenderSentryDsnSecret",
    props.sentryDsnSecretArn,
  );
  secret.grantRead(fn);
  fn.addEnvironment("SENTRY_DSN", secret.secretValue.unsafeUnwrap());
  fn.addEnvironment("SENTRY_ENVIRONMENT", props.sentryEnvironment);
  fn.addEnvironment("SENTRY_RELEASE", props.sentryRelease);
  fn.addEnvironment("SENTRY_TRACES_SAMPLE_RATE", props.sentryTracesSampleRate);
}

export function customEmailSender(
  scope: Construct,
  props: CustomEmailSenderProps,
): CustomEmailSenderResult {
  const kmsKey = new kms.Key(scope, "CustomEmailSenderKey", {
    alias: "flashcards-cognito-custom-email-sender",
    enableKeyRotation: true,
    removalPolicy: cdk.RemovalPolicy.RETAIN,
  });

  kmsKey.addToResourcePolicy(new iam.PolicyStatement({
    principals: [new iam.ServicePrincipal("cognito-idp.amazonaws.com")],
    actions: [
      "kms:CreateGrant",
      "kms:DescribeKey",
      "kms:Encrypt",
      "kms:GenerateDataKey",
    ],
    resources: ["*"],
  }));

  const fn = new lambdaNodejs.NodejsFunction(scope, "CustomEmailSenderFn", {
    entry: path.join(__dirname, "../lambda/custom-email-sender/index.ts"),
    handler: "handler",
    runtime: lambda.Runtime.NODEJS_24_X,
    timeout: cdk.Duration.seconds(30),
    memorySize: 256,
    bundling,
    environment: {
      KEY_ARN: kmsKey.keyArn,
      KEY_ID: kmsKey.keyId,
      RESEND_FROM_EMAIL: props.resendSenderEmail,
      RESEND_FROM_NAME: "Flashcards Open Source App",
    },
  });

  kmsKey.grantDecrypt(fn);

  const resendApiKeySecret = secretsmanager.Secret.fromSecretCompleteArn(
    scope,
    "ResendApiKeySecret",
    props.resendApiKeySecretArn,
  );
  resendApiKeySecret.grantRead(fn);
  fn.addEnvironment("RESEND_API_KEY", resendApiKeySecret.secretValue.unsafeUnwrap());

  addOptionalSentryEnvironment(scope, fn, props);

  return {
    fn,
    kmsKey,
  };
}
