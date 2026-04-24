import * as cdk from "aws-cdk-lib";
import * as ec2 from "aws-cdk-lib/aws-ec2";
import * as iam from "aws-cdk-lib/aws-iam";
import * as lambda from "aws-cdk-lib/aws-lambda";
import * as lambdaNodejs from "aws-cdk-lib/aws-lambda-nodejs";
import * as rds from "aws-cdk-lib/aws-rds";
import * as s3 from "aws-cdk-lib/aws-s3";
import * as scheduler from "aws-cdk-lib/aws-scheduler";
import { Construct } from "constructs";
import * as path from "path";
import { backendNodejsProjectPaths, infraAwsNodejsProjectPaths, resolveFromRepoRoot } from "./nodejs-project-paths";

export interface GlobalMetricsProps {
  vpc: ec2.Vpc;
  lambdaSg: ec2.SecurityGroup;
  db: rds.DatabaseInstance;
  reportingDbSecret: cdk.aws_secretsmanager.ISecret;
}

export interface GlobalMetricsResult {
  snapshotBucket: s3.Bucket;
  snapshotFunction: lambdaNodejs.NodejsFunction;
  snapshotFreshnessCheckerFunction: lambdaNodejs.NodejsFunction;
  snapshotObjectKey: string;
}

export const globalMetricsSnapshotObjectKey = "v1/global-snapshot.json";
export const globalMetricsSnapshotFreshnessMetricNamespace = "FlashcardsOpenSourceApp/GlobalMetrics";
export const globalMetricsSnapshotFreshnessMetricName = "GlobalMetricsSnapshotAgeHours";
export const globalMetricsSnapshotFreshnessMetricStackDimensionName = "StackName";
export const globalMetricsSnapshotFreshnessMaxAgeHours = 30;
export const globalMetricsSnapshotFreshnessCheckIntervalHours = 1;

const lambdaBundling: lambdaNodejs.BundlingOptions = {
  minify: true,
  sourceMap: true,
  commandHooks: {
    beforeBundling: () => [],
    beforeInstall: () => [],
    afterBundling: (_inputDir: string, outputDir: string) => [
      `curl -sfo ${outputDir}/rds-global-bundle.pem https://truststore.pki.rds.amazonaws.com/global/global-bundle.pem`,
    ],
  },
};

const freshnessCheckerBundling: lambdaNodejs.BundlingOptions = {
  minify: true,
  sourceMap: true,
};

export function globalMetrics(scope: Construct, props: GlobalMetricsProps): GlobalMetricsResult {
  const snapshotBucket = new s3.Bucket(scope, "GlobalMetricsSnapshotBucket", {
    encryption: s3.BucketEncryption.S3_MANAGED,
    blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
    enforceSSL: true,
    removalPolicy: cdk.RemovalPolicy.RETAIN,
    autoDeleteObjects: false,
  });

  const snapshotFunction = new lambdaNodejs.NodejsFunction(scope, "GlobalMetricsSnapshotHandler", {
    entry: resolveFromRepoRoot("apps", "backend", "src", "lambda-global-metrics-snapshot.ts"),
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
      REPORTING_DB_SECRET_ARN: props.reportingDbSecret.secretArn,
      DB_HOST: props.db.dbInstanceEndpointAddress,
      DB_NAME: "flashcards",
      GLOBAL_METRICS_S3_BUCKET_NAME: snapshotBucket.bucketName,
      GLOBAL_METRICS_S3_OBJECT_KEY: globalMetricsSnapshotObjectKey,
    },
  });

  props.reportingDbSecret.grantRead(snapshotFunction);
  snapshotFunction.addToRolePolicy(new iam.PolicyStatement({
    actions: ["s3:PutObject"],
    resources: [snapshotBucket.arnForObjects(globalMetricsSnapshotObjectKey)],
  }));

  const schedulerInvokeRole = new iam.Role(scope, "GlobalMetricsSnapshotSchedulerRole", {
    assumedBy: new iam.ServicePrincipal("scheduler.amazonaws.com"),
  });
  schedulerInvokeRole.addToPolicy(new iam.PolicyStatement({
    actions: ["lambda:InvokeFunction"],
    resources: [snapshotFunction.functionArn],
  }));

  new scheduler.CfnSchedule(scope, "GlobalMetricsSnapshotDailySchedule", {
    description: "Generate the daily global metrics snapshot at 01:00 UTC",
    flexibleTimeWindow: { mode: "OFF" },
    scheduleExpression: "cron(0 1 * * ? *)",
    scheduleExpressionTimezone: "UTC",
    state: "ENABLED",
    target: {
      arn: snapshotFunction.functionArn,
      input: "{}",
      roleArn: schedulerInvokeRole.roleArn,
    },
  });

  const snapshotFreshnessCheckerFunction = new lambdaNodejs.NodejsFunction(
    scope,
    "GlobalMetricsSnapshotFreshnessCheckerHandler",
    {
      entry: path.join(__dirname, "../lambda/global-metrics-snapshot-freshness/index.ts"),
      handler: "handler",
      runtime: lambda.Runtime.NODEJS_24_X,
      timeout: cdk.Duration.seconds(30),
      memorySize: 256,
      bundling: freshnessCheckerBundling,
      environment: {
        GLOBAL_METRICS_S3_BUCKET_NAME: snapshotBucket.bucketName,
        GLOBAL_METRICS_S3_OBJECT_KEY: globalMetricsSnapshotObjectKey,
        GLOBAL_METRICS_FRESHNESS_METRIC_NAMESPACE: globalMetricsSnapshotFreshnessMetricNamespace,
        GLOBAL_METRICS_FRESHNESS_METRIC_NAME: globalMetricsSnapshotFreshnessMetricName,
        GLOBAL_METRICS_FRESHNESS_METRIC_STACK_DIMENSION_NAME:
          globalMetricsSnapshotFreshnessMetricStackDimensionName,
        GLOBAL_METRICS_FRESHNESS_METRIC_STACK_DIMENSION_VALUE: cdk.Stack.of(scope).stackName,
        GLOBAL_METRICS_FRESHNESS_MAX_AGE_HOURS: globalMetricsSnapshotFreshnessMaxAgeHours.toString(),
      },
      ...infraAwsNodejsProjectPaths,
    },
  );

  snapshotBucket.grantRead(snapshotFreshnessCheckerFunction);
  snapshotFreshnessCheckerFunction.addToRolePolicy(new iam.PolicyStatement({
    actions: ["cloudwatch:PutMetricData"],
    resources: ["*"],
  }));

  const freshnessCheckerInvokeRole = new iam.Role(scope, "GlobalMetricsSnapshotFreshnessSchedulerRole", {
    assumedBy: new iam.ServicePrincipal("scheduler.amazonaws.com"),
  });
  freshnessCheckerInvokeRole.addToPolicy(new iam.PolicyStatement({
    actions: ["lambda:InvokeFunction"],
    resources: [snapshotFreshnessCheckerFunction.functionArn],
  }));

  new scheduler.CfnSchedule(scope, "GlobalMetricsSnapshotFreshnessHourlySchedule", {
    description: "Check the global metrics snapshot freshness every hour",
    flexibleTimeWindow: { mode: "OFF" },
    scheduleExpression: "cron(0 * * * ? *)",
    scheduleExpressionTimezone: "UTC",
    state: "ENABLED",
    target: {
      arn: snapshotFreshnessCheckerFunction.functionArn,
      input: "{}",
      roleArn: freshnessCheckerInvokeRole.roleArn,
    },
  });

  return {
    snapshotBucket,
    snapshotFunction,
    snapshotFreshnessCheckerFunction,
    snapshotObjectKey: globalMetricsSnapshotObjectKey,
  };
}
