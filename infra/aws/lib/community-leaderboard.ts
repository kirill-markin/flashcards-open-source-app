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

export interface CommunityLeaderboardProps {
  vpc: ec2.Vpc;
  lambdaSg: ec2.SecurityGroup;
  db: rds.DatabaseInstance;
  backendDbSecret: cdk.aws_secretsmanager.Secret;
  sentryDsnSecretArn: string | undefined;
  sentryEnvironment: string | undefined;
  sentryRelease: string | undefined;
  sentryTracesSampleRate: string | undefined;
}

export interface CommunityLeaderboardResult {
  snapshotFunction: lambdaNodejs.NodejsFunction;
}

export const communityLeaderboardSnapshotScheduleHours = 1;
export const communityLeaderboardSnapshotScheduleExpression = "cron(0 * * * ? *)";

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
  props: CommunityLeaderboardProps,
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
    "CommunityLeaderboardSnapshotSentryDsnSecret",
    props.sentryDsnSecretArn,
  );
  secret.grantRead(fn);
  fn.addEnvironment("SENTRY_DSN", secret.secretValue.unsafeUnwrap());
  fn.addEnvironment("SENTRY_ENVIRONMENT", props.sentryEnvironment);
  fn.addEnvironment("SENTRY_RELEASE", props.sentryRelease);
  fn.addEnvironment("SENTRY_TRACES_SAMPLE_RATE", props.sentryTracesSampleRate);
}

/**
 * Hourly community leaderboard snapshot generation. The Lambda connects to Postgres as
 * the backend_app runtime role (read-write) and calls the SECURITY DEFINER snapshot
 * function, so it needs the backend database secret rather than the read-only reporting
 * secret used by the global metrics snapshot.
 */
export function communityLeaderboard(scope: Construct, props: CommunityLeaderboardProps): CommunityLeaderboardResult {
  const snapshotFunction = new lambdaNodejs.NodejsFunction(scope, "CommunityLeaderboardSnapshotHandler", {
    entry: resolveFromRepoRoot("apps", "backend", "src", "entrypoints", "lambda-community-leaderboard-snapshot.ts"),
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
      DB_HOST: props.db.dbInstanceEndpointAddress,
      DB_NAME: "flashcards",
    },
  });

  props.backendDbSecret.grantRead(snapshotFunction);
  addOptionalSentryEnvironment(scope, snapshotFunction, props);

  const schedulerInvokeRole = new iam.Role(scope, "CommunityLeaderboardSnapshotSchedulerRole", {
    assumedBy: new iam.ServicePrincipal("scheduler.amazonaws.com"),
  });
  schedulerInvokeRole.addToPolicy(new iam.PolicyStatement({
    actions: ["lambda:InvokeFunction"],
    resources: [snapshotFunction.functionArn],
  }));

  new scheduler.CfnSchedule(scope, "CommunityLeaderboardSnapshotHourlySchedule", {
    description: "Generate the community leaderboard snapshots every hour",
    flexibleTimeWindow: { mode: "OFF" },
    scheduleExpression: communityLeaderboardSnapshotScheduleExpression,
    scheduleExpressionTimezone: "UTC",
    state: "ENABLED",
    target: {
      arn: snapshotFunction.functionArn,
      input: "{}",
      roleArn: schedulerInvokeRole.roleArn,
    },
  });

  return {
    snapshotFunction,
  };
}
