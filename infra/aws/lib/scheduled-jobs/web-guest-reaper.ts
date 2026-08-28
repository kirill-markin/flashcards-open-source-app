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

export interface WebGuestReaperProps {
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

export interface WebGuestReaperResult {
  reaperFunction: lambdaNodejs.NodejsFunction;
}

export const webGuestReaperScheduleHours = 24;
export const webGuestReaperScheduleExpression = "cron(30 4 * * ? *)";

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
  props: WebGuestReaperProps,
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
    "WebGuestReaperSentryDsnSecret",
    props.sentryDsnSecretArn,
  );
  secret.grantRead(fn);
  fn.addEnvironment("SENTRY_DSN", secret.secretValue.unsafeUnwrap());
  fn.addEnvironment("SENTRY_ENVIRONMENT", props.sentryEnvironment);
  fn.addEnvironment("SENTRY_RELEASE", props.sentryRelease);
  fn.addEnvironment("SENTRY_TRACES_SAMPLE_RATE", props.sentryTracesSampleRate);
}

/**
 * Daily removal of web guest identities that never became an account and have been inactive for 90
 * days. The candidate scan reads across every guest, which row level security only allows the
 * read-only reporting role, while the deletions run as the backend_app runtime role, so this job
 * needs both database secrets.
 */
export function webGuestReaper(scope: Construct, props: WebGuestReaperProps): WebGuestReaperResult {
  const reaperFunction = new lambdaNodejs.NodejsFunction(scope, "WebGuestReaperHandler", {
    entry: resolveFromRepoRoot("apps", "backend", "src", "entrypoints", "scheduledJobs", "lambda-web-guest-reaper.ts"),
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

  props.backendDbSecret.grantRead(reaperFunction);
  props.reportingDbSecret.grantRead(reaperFunction);
  addOptionalSentryEnvironment(scope, reaperFunction, props);

  // Pinned because the alternative cannot be ruled out here, not because the invocation type is
  // known: whether EventBridge Scheduler invokes a Lambda target asynchronously is not something
  // this repository can establish, and if it does, Lambda's own async retry configuration - two
  // extra attempts by default - is what replays a failed invocation, while the schedule's
  // retryPolicy below bounds only Scheduler's own delivery retries. This job turns a single failed
  // candidate into a Lambda error and permanently deletes production rows, so a poison candidate
  // must not be re-processed twice more on the day it fails, and pinning both is what guarantees
  // that either way. Under a synchronous invocation this EventInvokeConfig is simply never
  // consulted; it sets no maxEventAge and adds no destination or dead-letter queue, so pinning it
  // costs nothing. The failure is reported through WebGuestReaperLambdaErrorAlarm and the next
  // day's run picks the work up again.
  reaperFunction.configureAsyncInvoke({ retryAttempts: 0 });

  const schedulerInvokeRole = new iam.Role(scope, "WebGuestReaperSchedulerRole", {
    assumedBy: new iam.ServicePrincipal("scheduler.amazonaws.com"),
  });
  schedulerInvokeRole.addToPolicy(new iam.PolicyStatement({
    actions: ["lambda:InvokeFunction"],
    resources: [reaperFunction.functionArn],
  }));

  new scheduler.CfnSchedule(scope, "WebGuestReaperDailySchedule", {
    description: "Delete never-converted web guest identities inactive for 90 days, once a day",
    flexibleTimeWindow: { mode: "OFF" },
    scheduleExpression: webGuestReaperScheduleExpression,
    scheduleExpressionTimezone: "UTC",
    state: "ENABLED",
    target: {
      arn: reaperFunction.functionArn,
      input: "{}",
      roleArn: schedulerInvokeRole.roleArn,
      // Pinned rather than left to the EventBridge Scheduler default, which retries a failing
      // target many times inside the same day. This bounds Scheduler's own delivery retries only;
      // the function's async retry attempts are pinned to 0 above because the invocation type is
      // not established here, and only pinning both guarantees the one-invocation-per-day bound
      // this destructive job is designed around.
      retryPolicy: { maximumRetryAttempts: 0 },
    },
  });

  return {
    reaperFunction,
  };
}
