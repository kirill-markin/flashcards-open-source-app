import * as cdk from "aws-cdk-lib";
import * as ec2 from "aws-cdk-lib/aws-ec2";
import * as lambda from "aws-cdk-lib/aws-lambda";
import * as lambdaNodejs from "aws-cdk-lib/aws-lambda-nodejs";
import * as rds from "aws-cdk-lib/aws-rds";
import { Construct } from "constructs";
import * as path from "path";

export interface MigrationRunnerProps {
  vpc: ec2.Vpc;
  lambdaSg: ec2.SecurityGroup;
  db: rds.DatabaseInstance;
  dbOwnerSecret: cdk.aws_secretsmanager.ISecret;
  backendDbSecret: cdk.aws_secretsmanager.Secret;
  authDbSecret: cdk.aws_secretsmanager.Secret;
}

const dbAssetPaths = {
  migrations: path.join(__dirname, "../../../db/migrations"),
  views: path.join(__dirname, "../../../db/views"),
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
    ],
  },
};

export function migrationRunner(scope: Construct, props: MigrationRunnerProps): lambdaNodejs.NodejsFunction {
  const migrationFn = new lambdaNodejs.NodejsFunction(scope, "DbMigrationHandler", {
    entry: path.join(__dirname, "../../../apps/backend/src/migrate-lambda.ts"),
    handler: "handler",
    runtime: lambda.Runtime.NODEJS_24_X,
    timeout: cdk.Duration.minutes(5),
    memorySize: 512,
    vpc: props.vpc,
    vpcSubnets: { subnetType: ec2.SubnetType.PRIVATE_WITH_EGRESS },
    securityGroups: [props.lambdaSg],
    bundling: lambdaBundling,
    environment: {
      NODE_EXTRA_CA_CERTS: "/var/task/rds-global-bundle.pem",
      DB_OWNER_SECRET_ARN: props.dbOwnerSecret.secretArn,
      DB_BACKEND_SECRET_ARN: props.backendDbSecret.secretArn,
      DB_AUTH_SECRET_ARN: props.authDbSecret.secretArn,
      DB_HOST: props.db.dbInstanceEndpointAddress,
      DB_NAME: "flashcards",
    },
  });

  props.dbOwnerSecret.grantRead(migrationFn);
  props.backendDbSecret.grantRead(migrationFn);
  props.authDbSecret.grantRead(migrationFn);

  return migrationFn;
}
