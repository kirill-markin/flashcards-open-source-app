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

export interface DailyVisitorHashSaltExpiryProps {
  vpc: ec2.Vpc;
  lambdaSg: ec2.SecurityGroup;
  db: rds.DatabaseInstance;
  backendDbSecret: cdk.aws_secretsmanager.Secret;
  sentryDsnSecretArn: string | undefined;
  sentryEnvironment: string | undefined;
  sentryRelease: string | undefined;
  sentryTracesSampleRate: string | undefined;
}

export interface DailyVisitorHashSaltExpiryResult {
  expiryFunction: lambdaNodejs.NodejsFunction;
}

// 00:00 UTC, so a day's salt is deleted as that day ends rather than whenever the next cookieless
// event arrives; see db/migrations/0144_anonymous_client_daily_visitor_hash.sql.
export const dailyVisitorHashSaltExpiryScheduleHours = 24;
export const dailyVisitorHashSaltExpiryScheduleExpression = "cron(0 0 * * ? *)";

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
  props: DailyVisitorHashSaltExpiryProps,
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
    "DailyVisitorHashSaltExpirySentryDsnSecret",
    props.sentryDsnSecretArn,
  );
  secret.grantRead(fn);
  fn.addEnvironment("SENTRY_DSN", secret.secretValue.unsafeUnwrap());
  fn.addEnvironment("SENTRY_ENVIRONMENT", props.sentryEnvironment);
  fn.addEnvironment("SENTRY_RELEASE", props.sentryRelease);
  fn.addEnvironment("SENTRY_TRACES_SAMPLE_RATE", props.sentryTracesSampleRate);
}

export function dailyVisitorHashSaltExpiry(scope: Construct, props: DailyVisitorHashSaltExpiryProps): DailyVisitorHashSaltExpiryResult {
  const expiryFunction = new lambdaNodejs.NodejsFunction(scope, "DailyVisitorHashSaltExpiryHandler", {
    entry: resolveFromRepoRoot("apps", "backend", "src", "entrypoints", "scheduledJobs", "lambda-daily-visitor-hash-salt-expiry.ts"),
    handler: "handler",
    runtime: lambda.Runtime.NODEJS_24_X,
    timeout: cdk.Duration.minutes(1),
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
      DB_HOST: props.db.dbInstanceEndpointAddress,
      DB_NAME: "flashcards",
    },
  });

  props.backendDbSecret.grantRead(expiryFunction);
  addOptionalSentryEnvironment(scope, expiryFunction, props);

  // The delete is idempotent, and a failed run that is not retried keeps an ended day's salt until the
  // next midnight, so Lambda retries it.
  expiryFunction.configureAsyncInvoke({ retryAttempts: 2 });

  const schedulerInvokeRole = new iam.Role(scope, "DailyVisitorHashSaltExpirySchedulerRole", {
    assumedBy: new iam.ServicePrincipal("scheduler.amazonaws.com"),
  });
  schedulerInvokeRole.addToPolicy(new iam.PolicyStatement({
    actions: ["lambda:InvokeFunction"],
    resources: [expiryFunction.functionArn],
  }));

  new scheduler.CfnSchedule(scope, "DailyVisitorHashSaltExpiryDailySchedule", {
    description: "Delete daily visitor hash salts whose UTC day has ended",
    flexibleTimeWindow: { mode: "OFF" },
    scheduleExpression: dailyVisitorHashSaltExpiryScheduleExpression,
    scheduleExpressionTimezone: "UTC",
    state: "ENABLED",
    target: {
      arn: expiryFunction.functionArn,
      input: "{}",
      roleArn: schedulerInvokeRole.roleArn,
      retryPolicy: { maximumRetryAttempts: 0 },
    },
  });

  return {
    expiryFunction,
  };
}
