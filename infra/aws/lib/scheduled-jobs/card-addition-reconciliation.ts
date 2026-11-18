import { createCachedNodejsFunction } from "../lambda-input-cache";
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
import {
  cardAdditionReconciliationReservedConcurrency,
  databasePoolMaxConnectionsEnvName,
  databasePoolMaxConnectionsEnvValue,
} from "../lambda-database-capacity";
import { createSentrySourceMapInjectionCommand } from "../sentry-source-maps";
import { getLambdaSentryRelease } from "../lambda-sentry-release";
import { createRdsCaBundleCopyCommand, rdsCaBundlePath } from "../rds-ca-bundle";

export interface CardAdditionReconciliationProps {
  vpc: ec2.Vpc;
  lambdaSg: ec2.SecurityGroup;
  db: rds.DatabaseInstance;
  backendDbSecret: cdk.aws_secretsmanager.Secret;
  reportingDbSecret: cdk.aws_secretsmanager.ISecret;
  sentryDsnSecretArn: string;
  sentryEnvironment: string;
  sentryRelease: string;
  sentryTracesSampleRate: string;
  schedulerRole: iam.Role;
}

export interface CardAdditionReconciliationResult {
  reconciliationFunction: lambdaNodejs.NodejsFunction;
  reconciliationScheduleArn: string;
  reconciliationScheduleName: string;
}

export const cardAdditionReconciliationScheduleHours = 24;
export const cardAdditionReconciliationScheduleExpression = "cron(30 2 * * ? *)";

export function cardAdditionReconciliation(
  scope: Construct,
  props: CardAdditionReconciliationProps,
): CardAdditionReconciliationResult {
  const reconciliationFunction = createCachedNodejsFunction(scope, "CardAdditionReconciliationHandler", {
    entry: resolveFromRepoRoot("apps", "backend", "src", "entrypoints", "scheduledJobs", "lambda-card-addition-reconciliation.ts"),
    handler: "handler",
    runtime: lambda.Runtime.NODEJS_24_X,
    timeout: cdk.Duration.minutes(5),
    memorySize: 512,
    reservedConcurrentExecutions: cardAdditionReconciliationReservedConcurrency,
    ...backendStructuredLoggingProps,
    vpc: props.vpc,
    vpcSubnets: { subnetType: ec2.SubnetType.PRIVATE_WITH_EGRESS },
    securityGroups: [props.lambdaSg],
    ...backendNodejsProjectPaths,
    copiedAssetPaths: [rdsCaBundlePath],
    bundling: {
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
    },
    environment: {
      NODE_EXTRA_CA_CERTS: "/var/task/rds-global-bundle.pem",
      DB_SECRET_ARN: props.backendDbSecret.secretArn,
      REPORTING_DB_SECRET_ARN: props.reportingDbSecret.secretArn,
      DB_HOST: props.db.dbInstanceEndpointAddress,
      DB_NAME: "flashcards",
      [databasePoolMaxConnectionsEnvName]: databasePoolMaxConnectionsEnvValue,
      SENTRY_ENVIRONMENT: props.sentryEnvironment,
      SENTRY_TRACES_SAMPLE_RATE: props.sentryTracesSampleRate,
    },
  });
  reconciliationFunction.addEnvironment("SENTRY_RELEASE", getLambdaSentryRelease(reconciliationFunction));
  props.backendDbSecret.grantRead(reconciliationFunction);
  props.reportingDbSecret.grantRead(reconciliationFunction);
  const sentryDsnSecret = cdk.aws_secretsmanager.Secret.fromSecretCompleteArn(
    scope,
    "CardAdditionReconciliationSentryDsnSecret",
    props.sentryDsnSecretArn,
  );
  sentryDsnSecret.grantRead(reconciliationFunction);
  reconciliationFunction.addEnvironment("SENTRY_DSN", sentryDsnSecret.secretValue.unsafeUnwrap());
  reconciliationFunction.configureAsyncInvoke({
    retryAttempts: 2,
    maxEventAge: cdk.Duration.hours(1),
  });

  props.schedulerRole.addToPolicy(new iam.PolicyStatement({
    actions: ["lambda:InvokeFunction"],
    resources: [reconciliationFunction.functionArn],
  }));

  // Retire only after published-client adoption and offline catch-up; see docs/analytics-db-access.md.
  const schedule = new scheduler.CfnSchedule(scope, "CardAdditionReconciliationDailySchedule", {
    description: "Recover proven legacy card additions into durable analytics history",
    flexibleTimeWindow: { mode: "OFF" },
    scheduleExpression: cardAdditionReconciliationScheduleExpression,
    scheduleExpressionTimezone: "UTC",
    state: "ENABLED",
    target: {
      arn: reconciliationFunction.functionArn,
      input: "{}",
      roleArn: props.schedulerRole.roleArn,
      retryPolicy: { maximumRetryAttempts: 2, maximumEventAgeInSeconds: 3600 },
    },
  });

  return {
    reconciliationFunction,
    reconciliationScheduleArn: schedule.attrArn,
    reconciliationScheduleName: schedule.ref,
  };
}
