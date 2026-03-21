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
}

export interface CustomEmailSenderResult {
  fn: lambdaNodejs.NodejsFunction;
  kmsKey: kms.Key;
}

const bundling: lambdaNodejs.BundlingOptions = {
  minify: true,
  sourceMap: true,
};

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

  return {
    fn,
    kmsKey,
  };
}
