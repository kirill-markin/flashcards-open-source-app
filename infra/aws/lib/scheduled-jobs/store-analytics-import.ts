import { createCachedNodejsFunction } from "../lambda-input-cache";
import * as cdk from "aws-cdk-lib";
import * as ec2 from "aws-cdk-lib/aws-ec2";
import * as iam from "aws-cdk-lib/aws-iam";
import * as lambda from "aws-cdk-lib/aws-lambda";
import * as lambdaNodejs from "aws-cdk-lib/aws-lambda-nodejs";
import * as logs from "aws-cdk-lib/aws-logs";
import * as rds from "aws-cdk-lib/aws-rds";
import * as scheduler from "aws-cdk-lib/aws-scheduler";
import { Construct } from "constructs";
import { backendNodejsProjectPaths, resolveFromRepoRoot } from "../nodejs-project-paths";
import { backendStructuredLoggingProps } from "../backend-lambda-logging";
import { createSentrySourceMapInjectionCommand } from "../sentry-source-maps";
import { getLambdaSentryRelease } from "../lambda-sentry-release";
import { createRdsCaBundleCopyCommand, rdsCaBundlePath } from "../rds-ca-bundle";

export interface StoreAnalyticsImportProps {
  vpc: ec2.Vpc;
  lambdaSg: ec2.SecurityGroup;
  db: rds.DatabaseInstance;
  backendDbSecret: cdk.aws_secretsmanager.Secret;
  stripeBillingSecretArn: string | undefined;
  appleIapSecretArn: string | undefined;
  sentryDsnSecretArn: string | undefined;
  sentryEnvironment: string | undefined;
  sentryRelease: string | undefined;
  sentryTracesSampleRate: string | undefined;
  schedulerRole: iam.Role;
}

export interface StoreAnalyticsImportResult {
  importFunction: lambdaNodejs.NodejsFunction;
  importLogGroup: logs.ILogGroup;
}

export const storeAnalyticsImportScheduleHours = 1;
export const storeAnalyticsImportScheduleExpression = "cron(20 * * * ? *)";

// Created outside the stack; holds the read-only App Store Connect team key as
// {privateKey, keyId, issuerId, appId}.
const appStoreConnectReportsSecretName = "flashcards-open-source-app/app-store-connect-reports";
// Google Workload Identity Federation for the Play bulk reports trusts exactly this role name.
const storeReportsImportRoleName = "FlashcardsStoreReportsImportRole";

const lambdaBundling: lambdaNodejs.BundlingOptions = {
  minify: true,
  sourceMap: true,
  commandHooks: {
    beforeBundling: () => [],
    beforeInstall: () => [],
    afterBundling: (_inputDir: string, outputDir: string) => [
      createRdsCaBundleCopyCommand(outputDir, rdsCaBundlePath),
      createSentrySourceMapInjectionCommand(outputDir),
    ],
  },
};

function hasConfiguredValue(value: string | undefined): value is string {
  return value !== undefined && value !== "";
}

function addOptionalSentryEnvironment(
  scope: Construct,
  fn: lambdaNodejs.NodejsFunction,
  props: StoreAnalyticsImportProps,
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

  const secret = cdk.aws_secretsmanager.Secret.fromSecretCompleteArn(
    scope,
    "StoreAnalyticsImportSentryDsnSecret",
    props.sentryDsnSecretArn,
  );
  secret.grantRead(fn);
  fn.addEnvironment("SENTRY_DSN", secret.secretValue.unsafeUnwrap());
  fn.addEnvironment("SENTRY_ENVIRONMENT", props.sentryEnvironment);
  fn.addEnvironment("SENTRY_RELEASE", getLambdaSentryRelease(fn));
  fn.addEnvironment("SENTRY_TRACES_SAMPLE_RATE", props.sentryTracesSampleRate);
}

export function storeAnalyticsImport(scope: Construct, props: StoreAnalyticsImportProps): StoreAnalyticsImportResult {
  const role = new iam.Role(scope, "StoreAnalyticsImportRole", {
    roleName: storeReportsImportRoleName,
    assumedBy: new iam.ServicePrincipal("lambda.amazonaws.com"),
    managedPolicies: [
      iam.ManagedPolicy.fromAwsManagedPolicyName("service-role/AWSLambdaBasicExecutionRole"),
      iam.ManagedPolicy.fromAwsManagedPolicyName("service-role/AWSLambdaVPCAccessExecutionRole"),
    ],
  });

  const importFunction = createCachedNodejsFunction(scope, "StoreAnalyticsImportHandler", {
    entry: resolveFromRepoRoot("apps", "backend", "src", "entrypoints", "scheduledJobs", "lambda-store-analytics-import.ts"),
    handler: "handler",
    runtime: lambda.Runtime.NODEJS_24_X,
    timeout: cdk.Duration.minutes(15),
    memorySize: 1024,
    role,
    ...backendStructuredLoggingProps,
    vpc: props.vpc,
    vpcSubnets: { subnetType: ec2.SubnetType.PRIVATE_WITH_EGRESS },
    securityGroups: [props.lambdaSg],
    ...backendNodejsProjectPaths,
    copiedAssetPaths: [rdsCaBundlePath],
    bundling: lambdaBundling,
    environment: {
      NODE_EXTRA_CA_CERTS: "/var/task/rds-global-bundle.pem",
      DB_SECRET_ARN: props.backendDbSecret.secretArn,
      DB_HOST: props.db.dbInstanceEndpointAddress,
      DB_NAME: "flashcards",
      APP_STORE_CONNECT_REPORTS_SECRET_ID: appStoreConnectReportsSecretName,
    },
  });

  props.backendDbSecret.grantRead(importFunction);
  cdk.aws_secretsmanager.Secret.fromSecretNameV2(
    scope,
    "AppStoreConnectReportsSecret",
    appStoreConnectReportsSecretName,
  ).grantRead(importFunction);
  if (hasConfiguredValue(props.appleIapSecretArn)) {
    const appleIapSecret = cdk.aws_secretsmanager.Secret.fromSecretCompleteArn(
      scope, "StoreAnalyticsImportAppleIapSecret", props.appleIapSecretArn,
    );
    appleIapSecret.grantRead(importFunction);
    importFunction.addEnvironment("APPLE_IAP_SECRET_ARN", appleIapSecret.secretArn);
  }
  addOptionalSentryEnvironment(scope, importFunction, props);
  if (hasConfiguredValue(props.stripeBillingSecretArn)) {
    cdk.aws_secretsmanager.Secret.fromSecretCompleteArn(
      scope, "StoreAnalyticsImportStripeBillingSecret", props.stripeBillingSecretArn,
    ).grantRead(importFunction);
    importFunction.addEnvironment("STRIPE_BILLING_SECRET_ARN", props.stripeBillingSecretArn);
  }

  // No automatic retry: an instance or file left unimported is picked up by the next hourly run.
  importFunction.configureAsyncInvoke({ retryAttempts: 0 });

  props.schedulerRole.addToPolicy(new iam.PolicyStatement({
    actions: ["lambda:InvokeFunction"],
    resources: [importFunction.functionArn],
  }));

  new scheduler.CfnSchedule(scope, "StoreAnalyticsImportHourlySchedule", {
    description: "Import store reports and reconcile Google, Apple and Stripe native billing history every hour",
    flexibleTimeWindow: { mode: "OFF" },
    scheduleExpression: storeAnalyticsImportScheduleExpression,
    scheduleExpressionTimezone: "UTC",
    state: "ENABLED",
    target: {
      arn: importFunction.functionArn,
      input: "{}",
      roleArn: props.schedulerRole.roleArn,
      retryPolicy: { maximumRetryAttempts: 0 },
    },
  });

  return {
    importFunction,
    importLogGroup: importFunction.logGroup,
  };
}
