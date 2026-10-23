import * as cdk from "aws-cdk-lib";
import * as ec2 from "aws-cdk-lib/aws-ec2";
import * as lambda from "aws-cdk-lib/aws-lambda";
import * as lambdaNodejs from "aws-cdk-lib/aws-lambda-nodejs";
import * as rds from "aws-cdk-lib/aws-rds";
import { Construct } from "constructs";
import { createCachedNodejsFunction } from "./lambda-input-cache";
import { authNodejsProjectPaths, resolveFromRepoRoot } from "./nodejs-project-paths";
import { createRdsCaBundleCopyCommand, rdsCaBundlePath } from "./rds-ca-bundle";
import { databasePoolMaxConnectionsEnvName, databasePoolMaxConnectionsEnvValue, nativeProofChallengeReservedConcurrency } from "./lambda-database-capacity";

export interface NativeProofChallengeProps {
  vpc: ec2.Vpc;
  lambdaSg: ec2.SecurityGroup;
  db: rds.DatabaseInstance;
  authDbSecret: cdk.aws_secretsmanager.ISecret;
}

export function nativeProofChallenge(scope: Construct, props: NativeProofChallengeProps): lambdaNodejs.NodejsFunction {
  const fn = createCachedNodejsFunction(scope, "NativeProofChallenge", {
    entry: resolveFromRepoRoot("apps", "auth", "src", "triggers", "nativeProof.ts"),
    handler: "handler",
    runtime: lambda.Runtime.NODEJS_24_X,
    timeout: cdk.Duration.seconds(5),
    memorySize: 1024,
    reservedConcurrentExecutions: nativeProofChallengeReservedConcurrency,
    vpc: props.vpc,
    vpcSubnets: { subnetType: ec2.SubnetType.PRIVATE_WITH_EGRESS },
    securityGroups: [props.lambdaSg],
    ...authNodejsProjectPaths,
    copiedAssetPaths: [rdsCaBundlePath],
    bundling: {
      minify: true,
      sourceMap: true,
      commandHooks: {
        beforeBundling: () => [],
        beforeInstall: () => [],
        afterBundling: (_inputDir: string, outputDir: string) => [
          createRdsCaBundleCopyCommand(outputDir, rdsCaBundlePath),
        ],
      },
    },
    environment: {
      NODE_EXTRA_CA_CERTS: "/var/task/rds-global-bundle.pem",
      DB_SECRET_ARN: props.authDbSecret.secretArn,
      DB_HOST: props.db.dbInstanceEndpointAddress,
      DB_NAME: "flashcards",
      [databasePoolMaxConnectionsEnvName]: databasePoolMaxConnectionsEnvValue,
    },
  });
  props.authDbSecret.grantRead(fn);
  return fn;
}
