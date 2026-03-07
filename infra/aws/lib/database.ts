import * as cdk from "aws-cdk-lib";
import * as ec2 from "aws-cdk-lib/aws-ec2";
import * as rds from "aws-cdk-lib/aws-rds";
import { Construct } from "constructs";

export interface DatabaseProps {
  vpc: ec2.Vpc;
  dbSg: ec2.SecurityGroup;
}

export interface DatabaseResult {
  db: rds.DatabaseInstance;
  dbOwnerSecret: cdk.aws_secretsmanager.ISecret;
  appDbSecret: cdk.aws_secretsmanager.Secret;
}

export function database(scope: Construct, props: DatabaseProps): DatabaseResult {
  const dbCredentials = rds.Credentials.fromGeneratedSecret("flashcards_owner", {
    secretName: "flashcards-open-source-app/db-credentials",
    excludeCharacters: " %+~`#$&*()|[]{}:;<>?!/@\"\\",
  });

  const parameterGroup = new rds.ParameterGroup(scope, "DbParams", {
    engine: rds.DatabaseInstanceEngine.postgres({
      version: rds.PostgresEngineVersion.VER_18,
    }),
    parameters: {
      "log_connections": "all",
      "log_disconnections": "1",
      "rds.force_ssl": "1",
    },
  });

  const db = new rds.DatabaseInstance(scope, "Db", {
    engine: rds.DatabaseInstanceEngine.postgres({
      version: rds.PostgresEngineVersion.VER_18,
    }),
    instanceType: ec2.InstanceType.of(ec2.InstanceClass.T4G, ec2.InstanceSize.MICRO),
    vpc: props.vpc,
    vpcSubnets: { subnetType: ec2.SubnetType.PRIVATE_WITH_EGRESS },
    securityGroups: [props.dbSg],
    credentials: dbCredentials,
    databaseName: "flashcards",
    parameterGroup,
    allocatedStorage: 20,
    maxAllocatedStorage: 50,
    storageEncrypted: true,
    backupRetention: cdk.Duration.days(7),
    deletionProtection: true,
    removalPolicy: cdk.RemovalPolicy.SNAPSHOT,
  });

  const dbOwnerSecret = db.secret;
  if (dbOwnerSecret === undefined) {
    throw new Error("Database owner secret must be defined for generated credentials");
  }

  const appDbSecret = new cdk.aws_secretsmanager.Secret(scope, "AppDbSecret", {
    secretName: "flashcards-open-source-app/app-db-password",
    generateSecretString: {
      secretStringTemplate: JSON.stringify({ username: "app" }),
      generateStringKey: "password",
      excludePunctuation: true,
      passwordLength: 32,
    },
  });

  return { db, dbOwnerSecret, appDbSecret };
}
