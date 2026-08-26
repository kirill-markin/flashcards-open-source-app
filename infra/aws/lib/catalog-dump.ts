import * as cdk from "aws-cdk-lib";
import * as cloudfront from "aws-cdk-lib/aws-cloudfront";
import * as origins from "aws-cdk-lib/aws-cloudfront-origins";
import * as ec2 from "aws-cdk-lib/aws-ec2";
import * as iam from "aws-cdk-lib/aws-iam";
import * as lambda from "aws-cdk-lib/aws-lambda";
import * as lambdaNodejs from "aws-cdk-lib/aws-lambda-nodejs";
import * as rds from "aws-cdk-lib/aws-rds";
import * as s3 from "aws-cdk-lib/aws-s3";
import { Construct } from "constructs";
import { backendNodejsProjectPaths, resolveFromRepoRoot } from "./nodejs-project-paths";
import { parsePublicOrigin } from "./public-origin";
import { createSentrySourceMapUploadCommand } from "./sentry-source-maps";

export interface CatalogDumpProps {
  vpc: ec2.Vpc;
  lambdaSg: ec2.SecurityGroup;
  db: rds.DatabaseInstance;
  backendDbSecret: cdk.aws_secretsmanager.Secret;
  baseDomain: string;
  sentryDsnSecretArn: string | undefined;
  sentryEnvironment: string | undefined;
  sentryRelease: string | undefined;
  sentryTracesSampleRate: string | undefined;
}

export interface CatalogDumpResult {
  bucket: s3.Bucket;
  distribution: cloudfront.Distribution;
  dumpFunction: lambdaNodejs.NodejsFunction;
  cdnBaseUrl: string;
}

// Must stay in sync with the object key prefix written by the backend dump storage.
const catalogDumpObjectKeyPrefix = "catalog";

/**
 * Alias object naming the current immutable artifact. `GET /v1/catalog` reads
 * only this one object, so the API handler is granted it on its own rather than
 * through the builder's write prefix.
 */
export const catalogDumpPointerObjectKey = `${catalogDumpObjectKeyPrefix}/pointer.json`;

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
  props: CatalogDumpProps,
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
    "CatalogDumpSentryDsnSecret",
    props.sentryDsnSecretArn,
  );
  secret.grantRead(fn);
  fn.addEnvironment("SENTRY_DSN", secret.secretValue.unsafeUnwrap());
  fn.addEnvironment("SENTRY_ENVIRONMENT", props.sentryEnvironment);
  fn.addEnvironment("SENTRY_RELEASE", props.sentryRelease);
  fn.addEnvironment("SENTRY_TRACES_SAMPLE_RATE", props.sentryTracesSampleRate);
}

/**
 * Public catalog dump artifact pipeline. The builder Lambda reads Postgres as the
 * backend_app runtime role, exactly like the API handler behind `GET /v1/catalog`,
 * and publishes the snapshot to a private bucket served through CloudFront.
 * Freshness is controlled per object by `Cache-Control`, so the distribution keeps
 * one cache-optimized behavior and no custom domain.
 */
export function catalogDump(scope: Construct, props: CatalogDumpProps): CatalogDumpResult {
  const bucket = new s3.Bucket(scope, "CatalogDumpBucket", {
    encryption: s3.BucketEncryption.S3_MANAGED,
    blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
    enforceSSL: true,
    removalPolicy: cdk.RemovalPolicy.RETAIN,
    autoDeleteObjects: false,
  });

  const distribution = new cloudfront.Distribution(scope, "CatalogDumpDistribution", {
    comment: "flashcards-open-source-app public catalog dump",
    defaultBehavior: {
      origin: origins.S3BucketOrigin.withOriginAccessControl(bucket),
      viewerProtocolPolicy: cloudfront.ViewerProtocolPolicy.REDIRECT_TO_HTTPS,
      cachePolicy: cloudfront.CachePolicy.CACHING_OPTIMIZED,
      compress: true,
    },
  });

  const cdnBaseUrl = `https://${distribution.distributionDomainName}`;

  const dumpFunction = new lambdaNodejs.NodejsFunction(scope, "CatalogDumpHandler", {
    entry: resolveFromRepoRoot("apps", "backend", "src", "entrypoints", "scheduledJobs", "lambda-catalog-dump.ts"),
    handler: "handler",
    runtime: lambda.Runtime.NODEJS_24_X,
    timeout: cdk.Duration.minutes(5),
    memorySize: 2048,
    // Admin operations trigger rebuilds, so runs can now overlap. Two overlapping
    // runs interleave the `latest.json` and `pointer.json` writes and can leave the
    // pointer naming one build while `latest.json` holds another. One reserved
    // execution serializes them without a lock: throttled asynchronous triggers stay
    // queued and are retried by Lambda, and the run that wins is the one that read
    // Postgres last.
    reservedConcurrentExecutions: 1,
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
      PUBLIC_API_BASE_URL: `https://api.${props.baseDomain}/v1`,
      PUBLIC_APP_BASE_URL: parsePublicOrigin(`https://app.${props.baseDomain}`, "appBaseUrl"),
      CATALOG_DUMP_S3_BUCKET_NAME: bucket.bucketName,
      CATALOG_DUMP_CDN_BASE_URL: cdnBaseUrl,
    },
  });

  props.backendDbSecret.grantRead(dumpFunction);
  addOptionalSentryEnvironment(scope, dumpFunction, props);
  dumpFunction.addToRolePolicy(new iam.PolicyStatement({
    actions: ["s3:PutObject"],
    resources: [bucket.arnForObjects(`${catalogDumpObjectKeyPrefix}/*`)],
  }));

  return {
    bucket,
    distribution,
    dumpFunction,
    cdnBaseUrl,
  };
}
