import * as cdk from "aws-cdk-lib";
import * as ec2 from "aws-cdk-lib/aws-ec2";
import * as iam from "aws-cdk-lib/aws-iam";
import * as lambda from "aws-cdk-lib/aws-lambda";
import * as lambdaNodejs from "aws-cdk-lib/aws-lambda-nodejs";
import * as rds from "aws-cdk-lib/aws-rds";
import * as scheduler from "aws-cdk-lib/aws-scheduler";
import { Construct } from "constructs";
import { backendNodejsProjectPaths, resolveFromRepoRoot } from "../nodejs-project-paths";
import { backendStructuredLoggingProps } from "../backend-lambda-logging";
import { createSentrySourceMapUploadCommand } from "../sentry-source-maps";
import { createRdsCaBundleDownloadCommand } from "../rds-ca-bundle";

export interface SyntheticActorDetectorProps {
  vpc: ec2.Vpc;
  lambdaSg: ec2.SecurityGroup;
  db: rds.DatabaseInstance;
  backendDbSecret: cdk.aws_secretsmanager.Secret;
  reportingDbSecret: cdk.aws_secretsmanager.ISecret;
  sentryDsnSecretArn: string | undefined;
  sentryEnvironment: string | undefined;
  sentryRelease: string | undefined;
  sentryTracesSampleRate: string | undefined;
}

export interface SyntheticActorDetectorResult {
  detectorFunction: lambdaNodejs.NodejsFunction;
}

export const syntheticActorDetectorScheduleHours = 24;
// 00:30 UTC, half an hour before the global metrics snapshot at 01:00 UTC, so the exclusions a day
// finds are in the table before the day's published figures are generated from it.
export const syntheticActorDetectorScheduleExpression = "cron(30 0 * * ? *)";

const lambdaBundling: lambdaNodejs.BundlingOptions = {
  minify: true,
  sourceMap: true,
  commandHooks: {
    beforeBundling: () => [],
    beforeInstall: () => [],
    afterBundling: (_inputDir: string, outputDir: string) => [
      createRdsCaBundleDownloadCommand(outputDir),
      createSentrySourceMapUploadCommand(outputDir),
    ],
  },
};

function hasConfiguredValue(value: string | undefined): value is string {
  return value !== undefined && value !== "";
}

function addOptionalSentryEnvironment(
  scope: Construct,
  fn: lambdaNodejs.NodejsFunction,
  props: SyntheticActorDetectorProps,
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
    "SyntheticActorDetectorSentryDsnSecret",
    props.sentryDsnSecretArn,
  );
  secret.grantRead(fn);
  fn.addEnvironment("SENTRY_DSN", secret.secretValue.unsafeUnwrap());
  fn.addEnvironment("SENTRY_ENVIRONMENT", props.sentryEnvironment);
  fn.addEnvironment("SENTRY_RELEASE", props.sentryRelease);
  fn.addEnvironment("SENTRY_TRACES_SAMPLE_RATE", props.sentryTracesSampleRate);
}

export function syntheticActorDetector(
  scope: Construct,
  props: SyntheticActorDetectorProps,
): SyntheticActorDetectorResult {
  // Two secrets: the candidate scan reads analytics.product_events_resolved, which only
  // reporting_readonly may select, while the insert into analytics.excluded_actors is a backend_app
  // privilege.
  const detectorFunction = new lambdaNodejs.NodejsFunction(scope, "SyntheticActorDetectorHandler", {
    entry: resolveFromRepoRoot("apps", "backend", "src", "entrypoints", "scheduledJobs", "lambda-synthetic-actor-detector.ts"),
    handler: "handler",
    runtime: lambda.Runtime.NODEJS_24_X,
    timeout: cdk.Duration.minutes(5),
    memorySize: 512,
    ...backendStructuredLoggingProps,
    vpc: props.vpc,
    vpcSubnets: { subnetType: ec2.SubnetType.PRIVATE_WITH_EGRESS },
    securityGroups: [props.lambdaSg],
    ...backendNodejsProjectPaths,
    bundling: lambdaBundling,
    environment: {
      NODE_EXTRA_CA_CERTS: "/var/task/rds-global-bundle.pem",
      DB_SECRET_ARN: props.backendDbSecret.secretArn,
      REPORTING_DB_SECRET_ARN: props.reportingDbSecret.secretArn,
      DB_HOST: props.db.dbInstanceEndpointAddress,
      DB_NAME: "flashcards",
    },
  });

  props.backendDbSecret.grantRead(detectorFunction);
  props.reportingDbSecret.grantRead(detectorFunction);
  addOptionalSentryEnvironment(scope, detectorFunction, props);

  // No automatic retry. The run is idempotent, so a retry would be harmless to the table, but it
  // would split one day's insertions across two invocations and make the large-run threshold read
  // lower than the run actually was. The next day's schedule is the retry.
  detectorFunction.configureAsyncInvoke({ retryAttempts: 0 });

  const schedulerInvokeRole = new iam.Role(scope, "SyntheticActorDetectorSchedulerRole", {
    assumedBy: new iam.ServicePrincipal("scheduler.amazonaws.com"),
  });
  schedulerInvokeRole.addToPolicy(new iam.PolicyStatement({
    actions: ["lambda:InvokeFunction"],
    resources: [detectorFunction.functionArn],
  }));

  new scheduler.CfnSchedule(scope, "SyntheticActorDetectorDailySchedule", {
    description: "Exclude newly detected synthetic actors from analytics daily",
    flexibleTimeWindow: { mode: "OFF" },
    scheduleExpression: syntheticActorDetectorScheduleExpression,
    scheduleExpressionTimezone: "UTC",
    state: "ENABLED",
    target: {
      arn: detectorFunction.functionArn,
      input: "{}",
      roleArn: schedulerInvokeRole.roleArn,
      retryPolicy: { maximumRetryAttempts: 0 },
    },
  });

  return {
    detectorFunction,
  };
}
