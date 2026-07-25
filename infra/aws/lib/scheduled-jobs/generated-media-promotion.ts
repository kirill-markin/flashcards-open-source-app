import * as cdk from "aws-cdk-lib";
import * as ec2 from "aws-cdk-lib/aws-ec2";
import * as iam from "aws-cdk-lib/aws-iam";
import * as lambda from "aws-cdk-lib/aws-lambda";
import * as lambdaNodejs from "aws-cdk-lib/aws-lambda-nodejs";
import * as rds from "aws-cdk-lib/aws-rds";
import * as s3 from "aws-cdk-lib/aws-s3";
import * as scheduler from "aws-cdk-lib/aws-scheduler";
import { Construct } from "constructs";
import { backendNodejsProjectPaths, resolveFromRepoRoot } from "../nodejs-project-paths";
import { createSentrySourceMapUploadCommand } from "../sentry-source-maps";
export interface GeneratedMediaPromotionProps {
  vpc: ec2.Vpc; lambdaSg: ec2.SecurityGroup; db: rds.DatabaseInstance;
  backendDbSecret: cdk.aws_secretsmanager.Secret; mediaAssetsBucket: s3.IBucket;
  sentryDsnSecretArn: string; sentryEnvironment: string; sentryRelease: string; sentryTracesSampleRate: string;
}
export interface GeneratedMediaPromotionResult { promotionFunction: lambdaNodejs.NodejsFunction }
export const generatedMediaPromotionScheduleExpression = "rate(1 minute)";
export function generatedMediaPromotion(
  scope: Construct, props: GeneratedMediaPromotionProps): GeneratedMediaPromotionResult {
  const promotionFunction = new lambdaNodejs.NodejsFunction(
    scope, "GeneratedMediaPromotionHandler", {
      entry: resolveFromRepoRoot(
        "apps", "backend", "src", "entrypoints", "scheduledJobs", "lambda-generated-media-promotion.ts",
      ),
      handler: "handler", runtime: lambda.Runtime.NODEJS_24_X,
      timeout: cdk.Duration.minutes(2), memorySize: 512,
      vpc: props.vpc, vpcSubnets: { subnetType: ec2.SubnetType.PRIVATE_WITH_EGRESS },
      securityGroups: [props.lambdaSg],
      ...backendNodejsProjectPaths,
      bundling: {
        minify: true, sourceMap: true,
        commandHooks: {
          beforeBundling: () => [], beforeInstall: () => [],
          afterBundling: (_inputDir: string, outputDir: string) => [
            `curl -sfo ${outputDir}/rds-global-bundle.pem https://truststore.pki.rds.amazonaws.com/global/global-bundle.pem`,
            createSentrySourceMapUploadCommand(outputDir),
          ],
        },
      },
      environment: {
        NODE_EXTRA_CA_CERTS: "/var/task/rds-global-bundle.pem",
        DB_SECRET_ARN: props.backendDbSecret.secretArn, DB_HOST: props.db.dbInstanceEndpointAddress,
        DB_NAME: "flashcards", MEDIA_ASSETS_S3_BUCKET_NAME: props.mediaAssetsBucket.bucketName,
        SENTRY_ENVIRONMENT: props.sentryEnvironment, SENTRY_RELEASE: props.sentryRelease,
        SENTRY_TRACES_SAMPLE_RATE: props.sentryTracesSampleRate,
      },
    },
  );
  props.backendDbSecret.grantRead(promotionFunction);
  const sentryDsnSecret = cdk.aws_secretsmanager.Secret.fromSecretCompleteArn(
    scope, "GeneratedMediaPromotionSentryDsnSecret", props.sentryDsnSecretArn);
  sentryDsnSecret.grantRead(promotionFunction);
  promotionFunction.addEnvironment("SENTRY_DSN", sentryDsnSecret.secretValue.unsafeUnwrap());
  promotionFunction.addToRolePolicy(new iam.PolicyStatement({
    actions: ["s3:GetObject"],
    resources: [props.mediaAssetsBucket.arnForObjects("media/uploads/*"),
      props.mediaAssetsBucket.arnForObjects("media/blobs/*")],
  }));
  promotionFunction.addToRolePolicy(new iam.PolicyStatement({
    actions: ["s3:PutObject"],
    resources: [props.mediaAssetsBucket.arnForObjects("media/blobs/*")],
  }));
  const schedulerRole = new iam.Role(scope, "GeneratedMediaPromotionSchedulerRole",
    { assumedBy: new iam.ServicePrincipal("scheduler.amazonaws.com") });
  schedulerRole.addToPolicy(new iam.PolicyStatement({
    actions: ["lambda:InvokeFunction"],
    resources: [promotionFunction.functionArn],
  }));
  new scheduler.CfnSchedule(scope, "GeneratedMediaPromotionSchedule", {
    description: "Reconcile durable generated-media promotion jobs", flexibleTimeWindow: { mode: "OFF" },
    scheduleExpression: generatedMediaPromotionScheduleExpression,
    scheduleExpressionTimezone: "UTC",
    state: "ENABLED", target: {
      arn: promotionFunction.functionArn, input: "{}", roleArn: schedulerRole.roleArn,
    },
  });
  return { promotionFunction };
}
