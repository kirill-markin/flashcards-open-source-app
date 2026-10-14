import * as cdk from "aws-cdk-lib";
import * as ec2 from "aws-cdk-lib/aws-ec2";
import * as lambda from "aws-cdk-lib/aws-lambda";
import * as lambdaNodejs from "aws-cdk-lib/aws-lambda-nodejs";
import { Construct } from "constructs";
import { createCachedNodejsFunction } from "./lambda-input-cache";
import { authNodejsProjectPaths, resolveFromRepoRoot } from "./nodejs-project-paths";
import { createRdsCaBundleCopyCommand, rdsCaBundlePath } from "./rds-ca-bundle";
import { databasePoolMaxConnectionsEnvName, databasePoolMaxConnectionsEnvValue, nativeProofGateReservedConcurrency } from "./lambda-database-capacity";
import { type NativeProofChallengeProps } from "./native-proof-challenge";

export interface NativeProofGateProps extends NativeProofChallengeProps {
  userPoolId: string;
  userPoolClientId: string;
  demoEmailDostip: string | undefined;
  demoPasswordSecretArn: string | undefined;
}

export function nativeProofGate(scope: Construct, props: NativeProofGateProps): lambdaNodejs.NodejsFunction {
  if (props.demoEmailDostip === undefined || props.demoEmailDostip === "" || props.demoPasswordSecretArn === undefined) {
    throw new Error("Native proof cloud gate requires the existing review account configuration");
  }
  const fn = createCachedNodejsFunction(scope, "NativeProofGate", {
    entry: resolveFromRepoRoot("apps", "auth", "src", "integration", "nativeProofGate.ts"),
    handler: "handler",
    runtime: lambda.Runtime.NODEJS_24_X,
    timeout: cdk.Duration.seconds(90),
    memorySize: 256,
    reservedConcurrentExecutions: nativeProofGateReservedConcurrency,
    vpc: props.vpc,
    vpcSubnets: { subnetType: ec2.SubnetType.PRIVATE_WITH_EGRESS },
    securityGroups: [props.lambdaSg],
    ...authNodejsProjectPaths,
    copiedAssetPaths: [rdsCaBundlePath],
    bundling: {
      minify: true,
      sourceMap: true,
      commandHooks: {
        beforeBundling: () => [], beforeInstall: () => [],
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
      COGNITO_USER_POOL_ID: props.userPoolId,
      COGNITO_CLIENT_ID: props.userPoolClientId,
      COGNITO_REGION: cdk.Stack.of(scope).region,
      DEMO_EMAIL_DOSTIP: props.demoEmailDostip,
      DEMO_PASSWORD_SECRET_ARN: props.demoPasswordSecretArn,
    },
  });
  props.authDbSecret.grantRead(fn);
  cdk.aws_secretsmanager.Secret.fromSecretCompleteArn(scope, "NativeProofGateDemoSecret", props.demoPasswordSecretArn).grantRead(fn);
  return fn;
}
