import * as cdk from "aws-cdk-lib";
import * as ec2 from "aws-cdk-lib/aws-ec2";
import * as rds from "aws-cdk-lib/aws-rds";
import * as lambda from "aws-cdk-lib/aws-lambda";
import * as lambdaNodejs from "aws-cdk-lib/aws-lambda-nodejs";
import * as events from "aws-cdk-lib/aws-events";
import * as eventsTargets from "aws-cdk-lib/aws-events-targets";
import { Construct } from "constructs";
import * as path from "path";

export interface ReviewWorkerProps {
  vpc: ec2.Vpc;
  lambdaSg: ec2.SecurityGroup;
  db: rds.DatabaseInstance;
  workerDbSecret: cdk.aws_secretsmanager.Secret;
}

export interface ReviewWorkerResult {
  workerFn: lambdaNodejs.NodejsFunction;
}

export function reviewWorker(scope: Construct, props: ReviewWorkerProps): ReviewWorkerResult {
  const workerFn = new lambdaNodejs.NodejsFunction(scope, "ReviewWorker", {
    entry: path.join(__dirname, "../../../apps/worker/src/lambda.ts"),
    handler: "handler",
    runtime: lambda.Runtime.NODEJS_24_X,
    timeout: cdk.Duration.minutes(2),
    memorySize: 256,
    vpc: props.vpc,
    vpcSubnets: { subnetType: ec2.SubnetType.PRIVATE_WITH_EGRESS },
    securityGroups: [props.lambdaSg],
    environment: {
      NODE_EXTRA_CA_CERTS: "/var/task/rds-global-bundle.pem",
      DB_SECRET_ARN: props.workerDbSecret.secretArn,
      DB_HOST: props.db.dbInstanceEndpointAddress,
      DB_NAME: "flashcards",
    },
    bundling: {
      minify: true,
      sourceMap: true,
      commandHooks: {
        beforeBundling: () => [],
        beforeInstall: () => [],
        afterBundling: (_inputDir: string, outputDir: string) => [
          `curl -sfo ${outputDir}/rds-global-bundle.pem https://truststore.pki.rds.amazonaws.com/global/global-bundle.pem`,
        ],
      },
    },
  });

  props.workerDbSecret.grantRead(workerFn);

  new events.Rule(scope, "ReviewWorkerSchedule", {
    schedule: events.Schedule.rate(cdk.Duration.minutes(15)),
    targets: [new eventsTargets.LambdaFunction(workerFn)],
  });

  return { workerFn };
}
