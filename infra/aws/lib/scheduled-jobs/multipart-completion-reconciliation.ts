import * as cdk from "aws-cdk-lib";
import * as ec2 from "aws-cdk-lib/aws-ec2";
import * as iam from "aws-cdk-lib/aws-iam";
import * as lambda from "aws-cdk-lib/aws-lambda";
import * as lambdaNodejs from "aws-cdk-lib/aws-lambda-nodejs";
import * as rds from "aws-cdk-lib/aws-rds";
import * as s3 from "aws-cdk-lib/aws-s3";
import * as scheduler from "aws-cdk-lib/aws-scheduler";
import { Construct } from "constructs";
import {
  backendNodejsProjectPaths,
  resolveFromRepoRoot,
} from "../nodejs-project-paths";
import { createSentrySourceMapUploadCommand } from "../sentry-source-maps";

export interface MultipartCompletionReconciliationProps {
  vpc: ec2.Vpc;
  lambdaSg: ec2.SecurityGroup;
  db: rds.DatabaseInstance;
  backendDbSecret: cdk.aws_secretsmanager.Secret;
  mediaAssetsBucket: s3.IBucket;
  sentryDsnSecretArn: string;
  sentryEnvironment: string;
  sentryRelease: string;
  sentryTracesSampleRate: string;
  scheduleState: MultipartCompletionReconciliationScheduleState;
}

export interface MultipartCompletionReconciliationResult {
  reconciliationFunction: lambdaNodejs.NodejsFunction;
  reconciliationScheduleArn: string;
  reconciliationScheduleName: string;
}

export type MultipartCompletionReconciliationScheduleState =
  | "DISABLED"
  | "ENABLED";

export const multipartCompletionReconciliationScheduleExpression =
  "rate(1 minute)";
export const multipartCompletionReconciliationScheduleName =
  "flashcards-open-source-app-multipart-completion-reconciliation";
const multipartCompletionReconciliationStagingListPrefix =
  "media/uploads/workspaces/*/assets/*/sessions/*";
const multipartCompletionReconciliationBlobListPrefix =
  "media/blobs/sha256/*";

export function createMultipartCompletionReconciliationListBucketStatement(
  bucketArn: string,
): iam.PolicyStatement {
  return new iam.PolicyStatement({
    sid: "ListMultipartCompletionReconciliationObjects",
    actions: ["s3:ListBucket"],
    resources: [bucketArn],
    conditions: {
      StringLike: {
        "s3:prefix": [
          multipartCompletionReconciliationStagingListPrefix,
          multipartCompletionReconciliationBlobListPrefix,
        ],
      },
    },
  });
}

export function multipartCompletionReconciliation(
  scope: Construct,
  props: MultipartCompletionReconciliationProps,
): MultipartCompletionReconciliationResult {
  const reconciliationFunction = new lambdaNodejs.NodejsFunction(
    scope,
    "MultipartCompletionReconciliationHandler",
    {
      entry: resolveFromRepoRoot(
        "apps",
        "backend",
        "src",
        "entrypoints",
        "scheduledJobs",
        "lambda-multipart-completion-reconciliation.ts",
      ),
      handler: "handler",
      runtime: lambda.Runtime.NODEJS_24_X,
      timeout: cdk.Duration.minutes(2),
      memorySize: 512,
      loggingFormat: lambda.LoggingFormat.JSON,
      applicationLogLevelV2: lambda.ApplicationLogLevel.INFO,
      systemLogLevelV2: lambda.SystemLogLevel.INFO,
      vpc: props.vpc,
      vpcSubnets: { subnetType: ec2.SubnetType.PRIVATE_WITH_EGRESS },
      securityGroups: [props.lambdaSg],
      ...backendNodejsProjectPaths,
      bundling: {
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
      },
      environment: {
        NODE_EXTRA_CA_CERTS: "/var/task/rds-global-bundle.pem",
        DB_SECRET_ARN: props.backendDbSecret.secretArn,
        DB_HOST: props.db.dbInstanceEndpointAddress,
        DB_NAME: "flashcards",
        MEDIA_ASSETS_S3_BUCKET_NAME: props.mediaAssetsBucket.bucketName,
        SENTRY_ENVIRONMENT: props.sentryEnvironment,
        SENTRY_RELEASE: props.sentryRelease,
        SENTRY_TRACES_SAMPLE_RATE: props.sentryTracesSampleRate,
      },
    },
  );
  props.backendDbSecret.grantRead(reconciliationFunction);
  const sentryDsnSecret = cdk.aws_secretsmanager.Secret.fromSecretCompleteArn(
    scope,
    "MultipartCompletionReconciliationSentryDsnSecret",
    props.sentryDsnSecretArn,
  );
  sentryDsnSecret.grantRead(reconciliationFunction);
  reconciliationFunction.addEnvironment(
    "SENTRY_DSN",
    sentryDsnSecret.secretValue.unsafeUnwrap(),
  );

  const stagingObjects = props.mediaAssetsBucket.arnForObjects(
    "media/uploads/workspaces/*/assets/*/sessions/*",
  );
  const blobObjects = props.mediaAssetsBucket.arnForObjects(
    "media/blobs/sha256/*",
  );
  reconciliationFunction.addToRolePolicy(new iam.PolicyStatement({
    actions: ["s3:GetObject"],
    resources: [stagingObjects, blobObjects],
  }));
  reconciliationFunction.addToRolePolicy(new iam.PolicyStatement({
    actions: ["s3:PutObject"],
    resources: [stagingObjects, blobObjects],
  }));
  reconciliationFunction.addToRolePolicy(new iam.PolicyStatement({
    actions: ["s3:ListMultipartUploadParts"],
    resources: [stagingObjects],
  }));
  reconciliationFunction.addToRolePolicy(
    createMultipartCompletionReconciliationListBucketStatement(
      props.mediaAssetsBucket.bucketArn,
    ),
  );

  const schedulerRole = new iam.Role(
    scope,
    "MultipartCompletionReconciliationSchedulerRole",
    { assumedBy: new iam.ServicePrincipal("scheduler.amazonaws.com") },
  );
  schedulerRole.addToPolicy(new iam.PolicyStatement({
    actions: ["lambda:InvokeFunction"],
    resources: [reconciliationFunction.functionArn],
  }));
  const reconciliationSchedule = new scheduler.CfnSchedule(
    scope,
    "MultipartCompletionReconciliationSchedule",
    {
      description: "Reconcile durable multipart upload completions",
      flexibleTimeWindow: { mode: "OFF" },
      name: multipartCompletionReconciliationScheduleName,
      scheduleExpression: multipartCompletionReconciliationScheduleExpression,
      scheduleExpressionTimezone: "UTC",
      state: props.scheduleState,
      target: {
        arn: reconciliationFunction.functionArn,
        input: "{}",
        roleArn: schedulerRole.roleArn,
      },
    },
  );
  return {
    reconciliationFunction,
    reconciliationScheduleArn: reconciliationSchedule.attrArn,
    reconciliationScheduleName:
      multipartCompletionReconciliationScheduleName,
  };
}
