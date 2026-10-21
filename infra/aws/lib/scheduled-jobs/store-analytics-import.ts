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
  sandboxFunction: lambdaNodejs.NodejsFunction;
  sandboxLogGroup: logs.ILogGroup;
  discoveryFunction: lambdaNodejs.NodejsFunction;
  discoveryLogGroup: logs.ILogGroup;
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
  idPrefix: string,
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
    `${idPrefix}SentryDsnSecret`,
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

  const sharedFunctionProps = {
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
  };
  const databaseEnvironment = {
    NODE_EXTRA_CA_CERTS: "/var/task/rds-global-bundle.pem",
    DB_SECRET_ARN: props.backendDbSecret.secretArn,
    DB_HOST: props.db.dbInstanceEndpointAddress,
    DB_NAME: "flashcards",
  };
  const importFunction = createCachedNodejsFunction(scope, "StoreAnalyticsImportHandler", {
    ...sharedFunctionProps,
    entry: resolveFromRepoRoot("apps", "backend", "src", "entrypoints", "scheduledJobs", "lambda-store-analytics-import.ts"),
    environment: {
      ...databaseEnvironment,
      APP_STORE_CONNECT_REPORTS_SECRET_ID: appStoreConnectReportsSecretName,
    },
  });
  const sandboxFunction = createCachedNodejsFunction(scope, "StoreSandboxImportHandler", {
    ...sharedFunctionProps,
    entry: resolveFromRepoRoot("apps", "backend", "src", "entrypoints", "scheduledJobs", "lambda-store-sandbox-import.ts"),
    environment: databaseEnvironment,
  });
  const discoveryFunction = createCachedNodejsFunction(scope, "GoogleBillingDiscoveryHandler", {
    ...sharedFunctionProps,
    entry: resolveFromRepoRoot("apps", "backend", "src", "entrypoints", "scheduledJobs", "lambda-google-billing-discovery.ts"),
    environment: databaseEnvironment,
  });

  props.backendDbSecret.grantRead(importFunction);
  props.backendDbSecret.grantRead(sandboxFunction);
  props.backendDbSecret.grantRead(discoveryFunction);
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
    appleIapSecret.grantRead(sandboxFunction);
    importFunction.addEnvironment("APPLE_IAP_SECRET_ARN", appleIapSecret.secretArn);
    sandboxFunction.addEnvironment("APPLE_IAP_SECRET_ARN", appleIapSecret.secretArn);
  }
  addOptionalSentryEnvironment(scope, "StoreAnalyticsImport", importFunction, props);
  addOptionalSentryEnvironment(scope, "StoreSandboxImport", sandboxFunction, { ...props, sentryEnvironment: "sandbox" });
  addOptionalSentryEnvironment(scope, "GoogleBillingDiscovery", discoveryFunction, { ...props, sentryEnvironment: "billing-discovery" });
  if (hasConfiguredValue(props.stripeBillingSecretArn)) {
    const stripeBillingSecret = cdk.aws_secretsmanager.Secret.fromSecretCompleteArn(
      scope, "StoreAnalyticsImportStripeBillingSecret", props.stripeBillingSecretArn,
    );
    stripeBillingSecret.grantRead(importFunction);
    stripeBillingSecret.grantRead(sandboxFunction);
    importFunction.addEnvironment("STRIPE_BILLING_SECRET_ARN", props.stripeBillingSecretArn);
    sandboxFunction.addEnvironment("STRIPE_BILLING_SECRET_ARN", props.stripeBillingSecretArn);
  }

  // No automatic retry: an instance or file left unimported is picked up by the next hourly run.
  for (const fn of [importFunction, sandboxFunction, discoveryFunction]) {
    fn.configureAsyncInvoke({ retryAttempts: 0 });
  }

  props.schedulerRole.addToPolicy(new iam.PolicyStatement({
    actions: ["lambda:InvokeFunction"],
    resources: [importFunction.functionArn, sandboxFunction.functionArn, discoveryFunction.functionArn],
  }));

  new scheduler.CfnSchedule(scope, "StoreAnalyticsImportHourlySchedule", {
    description: "Import real store reports and production Google, Apple and Stripe billing history every hour",
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

  for (const job of [
    { id: "GoogleBillingDiscoveryHourlySchedule", fn: discoveryFunction, minute: 0,
      description: "Classify Google notification tokens with an unknown billing environment" },
    { id: "StoreSandboxImportHourlySchedule", fn: sandboxFunction, minute: 40,
      description: "Reconcile sandbox Google, Apple and Stripe billing history" },
  ]) {
    new scheduler.CfnSchedule(scope, job.id, {
      description: job.description,
      flexibleTimeWindow: { mode: "OFF" },
      scheduleExpression: `cron(${job.minute} * * * ? *)`,
      scheduleExpressionTimezone: "UTC",
      state: "ENABLED",
      target: { arn: job.fn.functionArn, input: "{}", roleArn: props.schedulerRole.roleArn,
        retryPolicy: { maximumRetryAttempts: 0 } },
    });
  }

  return {
    importFunction,
    importLogGroup: importFunction.logGroup,
    sandboxFunction,
    sandboxLogGroup: sandboxFunction.logGroup,
    discoveryFunction,
    discoveryLogGroup: discoveryFunction.logGroup,
  };
}
