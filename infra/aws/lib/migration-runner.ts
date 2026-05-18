import * as cdk from "aws-cdk-lib";
import * as ec2 from "aws-cdk-lib/aws-ec2";
import * as lambda from "aws-cdk-lib/aws-lambda";
import * as lambdaNodejs from "aws-cdk-lib/aws-lambda-nodejs";
import * as rds from "aws-cdk-lib/aws-rds";
import { Construct } from "constructs";
import { backendNodejsProjectPaths, resolveFromRepoRoot } from "./nodejs-project-paths";
import { createSentrySourceMapUploadCommand } from "./sentry-source-maps";

export interface MigrationRunnerProps {
  vpc: ec2.Vpc;
  lambdaSg: ec2.SecurityGroup;
  db: rds.DatabaseInstance;
  dbOwnerSecret: cdk.aws_secretsmanager.ISecret;
  backendDbSecret: cdk.aws_secretsmanager.Secret;
  authDbSecret: cdk.aws_secretsmanager.Secret;
  reportingDbSecret: cdk.aws_secretsmanager.ISecret;
  adminEmails: string | undefined;
  sentryDsnSecretArn: string | undefined;
  sentryEnvironment: string | undefined;
  sentryRelease: string | undefined;
  sentryTracesSampleRate: string | undefined;
}

const dbAssetPaths = {
  migrations: resolveFromRepoRoot("db", "migrations"),
  views: resolveFromRepoRoot("db", "views"),
};

const lambdaBundling: lambdaNodejs.BundlingOptions = {
  minify: true,
  sourceMap: true,
  commandHooks: {
    beforeBundling: () => [],
    beforeInstall: () => [],
    afterBundling: (_inputDir: string, outputDir: string) => [
      `curl -sfo ${outputDir}/rds-global-bundle.pem https://truststore.pki.rds.amazonaws.com/global/global-bundle.pem`,
      `mkdir -p ${outputDir}/db/migrations`,
      `mkdir -p ${outputDir}/db/views`,
      `cp ${dbAssetPaths.migrations}/*.sql ${outputDir}/db/migrations/`,
      `cp ${dbAssetPaths.views}/*.sql ${outputDir}/db/views/`,
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
  props: MigrationRunnerProps,
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
    "MigrationRunnerSentryDsnSecret",
    props.sentryDsnSecretArn,
  );
  secret.grantRead(fn);
  fn.addEnvironment("SENTRY_DSN", secret.secretValue.unsafeUnwrap());
  fn.addEnvironment("SENTRY_ENVIRONMENT", props.sentryEnvironment);
  fn.addEnvironment("SENTRY_RELEASE", props.sentryRelease);
  fn.addEnvironment("SENTRY_TRACES_SAMPLE_RATE", props.sentryTracesSampleRate);
}

/**
 * Creates the migration Lambda that owns schema changes and runtime role
 * password configuration for the private application database.
 */
export function migrationRunner(scope: Construct, props: MigrationRunnerProps): lambdaNodejs.NodejsFunction {
  const migrationFn = new lambdaNodejs.NodejsFunction(scope, "DbMigrationHandler", {
    entry: resolveFromRepoRoot("apps", "backend", "src", "migrate-lambda.ts"),
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
      DB_OWNER_SECRET_ARN: props.dbOwnerSecret.secretArn,
      DB_BACKEND_SECRET_ARN: props.backendDbSecret.secretArn,
      DB_AUTH_SECRET_ARN: props.authDbSecret.secretArn,
      DB_REPORTING_SECRET_ARN: props.reportingDbSecret.secretArn,
      DB_HOST: props.db.dbInstanceEndpointAddress,
      DB_NAME: "flashcards",
      ADMIN_EMAILS: props.adminEmails ?? "",
    },
  });

  props.dbOwnerSecret.grantRead(migrationFn);
  props.backendDbSecret.grantRead(migrationFn);
  props.authDbSecret.grantRead(migrationFn);
  props.reportingDbSecret.grantRead(migrationFn);
  addOptionalSentryEnvironment(scope, migrationFn, props);

  return migrationFn;
}
