import * as cdk from "aws-cdk-lib";
import * as ec2 from "aws-cdk-lib/aws-ec2";
import * as iam from "aws-cdk-lib/aws-iam";
import * as lambda from "aws-cdk-lib/aws-lambda";
import * as lambdaNodejs from "aws-cdk-lib/aws-lambda-nodejs";
import * as rds from "aws-cdk-lib/aws-rds";
import * as scheduler from "aws-cdk-lib/aws-scheduler";
import { Construct } from "constructs";
import { backendNodejsProjectPaths, resolveFromRepoRoot } from "./nodejs-project-paths";
import { createSentrySourceMapUploadCommand } from "./sentry-source-maps";

export interface ProgressActiveDaysBackfillProps {
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

export interface ProgressActiveDaysBackfillResult {
  backfillFunction: lambdaNodejs.NodejsFunction;
}

export const progressActiveDaysBackfillScheduleHours = 1;
export const progressActiveDaysBackfillScheduleExpression = "cron(15 * * * ? *)";

const lambdaBundling: lambdaNodejs.BundlingOptions = {
  minify: true,
  sourceMap: true,
  commandHooks: {
    beforeBundling: () => [],
    beforeInstall: () => [],
    afterBundling: (_inputDir: string, outputDir: string) => [
      `curl -sfo ${outputDir}/rds-global-bundle.pem https://truststore.pki.rds.amazonaws.com/global/global-bundle.pem`,
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
  props: ProgressActiveDaysBackfillProps,
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
    "ProgressActiveDaysBackfillSentryDsnSecret",
    props.sentryDsnSecretArn,
  );
  secret.grantRead(fn);
  fn.addEnvironment("SENTRY_DSN", secret.secretValue.unsafeUnwrap());
  fn.addEnvironment("SENTRY_ENVIRONMENT", props.sentryEnvironment);
  fn.addEnvironment("SENTRY_RELEASE", props.sentryRelease);
  fn.addEnvironment("SENTRY_TRACES_SAMPLE_RATE", props.sentryTracesSampleRate);
}

export function progressActiveDaysBackfill(
  scope: Construct,
  props: ProgressActiveDaysBackfillProps,
): ProgressActiveDaysBackfillResult {
  const backfillFunction = new lambdaNodejs.NodejsFunction(scope, "ProgressActiveDaysBackfillHandler", {
    entry: resolveFromRepoRoot("apps", "backend", "src", "entrypoints", "lambda-progress-active-days-backfill.ts"),
    handler: "handler",
    runtime: lambda.Runtime.NODEJS_24_X,
    timeout: cdk.Duration.minutes(5),
    memorySize: 512,
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

  props.backendDbSecret.grantRead(backfillFunction);
  props.reportingDbSecret.grantRead(backfillFunction);
  addOptionalSentryEnvironment(scope, backfillFunction, props);

  const schedulerInvokeRole = new iam.Role(scope, "ProgressActiveDaysBackfillSchedulerRole", {
    assumedBy: new iam.ServicePrincipal("scheduler.amazonaws.com"),
  });
  schedulerInvokeRole.addToPolicy(new iam.PolicyStatement({
    actions: ["lambda:InvokeFunction"],
    resources: [backfillFunction.functionArn],
  }));

  new scheduler.CfnSchedule(scope, "ProgressActiveDaysBackfillHourlySchedule", {
    description: "Materialize missing Progress active review days every hour",
    flexibleTimeWindow: { mode: "OFF" },
    scheduleExpression: progressActiveDaysBackfillScheduleExpression,
    scheduleExpressionTimezone: "UTC",
    state: "ENABLED",
    target: {
      arn: backfillFunction.functionArn,
      input: "{}",
      roleArn: schedulerInvokeRole.roleArn,
    },
  });

  return {
    backfillFunction,
  };
}
